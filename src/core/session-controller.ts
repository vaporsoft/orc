/**
 * Main orchestration loop for a single branch.
 *
 * Pipeline: fetch → categorize → filter → fix → verify → push → reply → re-request review.
 * Emits events for the UI/TUI layer to consume.
 */

import { EventEmitter } from "node:events";
import { GHClient } from "../github/gh-client.js";
import { CommentFetcher } from "./comment-fetcher.js";
import { CommentCategorizer } from "./comment-categorizer.js";
import { FixExecutor } from "./fix-executor.js";
import { GitManager } from "./git-manager.js";
import { ThreadResponder } from "./thread-responder.js";
import { loadPilotConfig } from "./pilot-config.js";
import type {
  BranchState,
  BranchStatus,
  CategorizedComment,
  CommentSummary,
  IterationSummary,
  RepoPilotConfig,
} from "../types/index.js";
import type { Config } from "../types/config.js";
import { logger } from "../utils/logger.js";
import { sleep } from "../utils/retry.js";
import { notify } from "../utils/notify.js";
import { exec } from "../utils/process.js";

export class SessionController extends EventEmitter {
  private config: Config;
  private branch: string;
  private cwd: string;
  private ghClient: GHClient;
  private fetcher!: CommentFetcher;
  private categorizer: CommentCategorizer;
  private executor: FixExecutor;
  private gitManager: GitManager;
  private responder!: ThreadResponder;
  private pilotConfig!: RepoPilotConfig;
  private state: BranchState;
  private abortController: AbortController;
  private running = false;

  constructor(branch: string, config: Config, cwd: string) {
    super();
    this.branch = branch;
    this.config = config;
    this.cwd = cwd;

    this.ghClient = new GHClient(cwd);
    this.categorizer = new CommentCategorizer(cwd);
    this.executor = new FixExecutor(config, cwd);
    this.gitManager = new GitManager(cwd, branch);
    this.abortController = new AbortController();

    this.state = {
      branch,
      prNumber: null,
      prUrl: null,
      status: "initializing",
      currentIteration: 0,
      maxIterations: config.maxLoops,
      iterations: [],
      totalCostUsd: 0,
      error: null,
      unresolvedCount: 0,
      commentSummary: null,
      lastPushAt: null,
    };
  }

  getState(): BranchState {
    return { ...this.state };
  }

  async start(): Promise<void> {
    this.running = true;

    try {
      this.setStatus("initializing");
      await this.ghClient.validateAuth();

      const pr = await this.ghClient.findPRForBranch(this.branch);
      if (!pr) {
        throw new Error(`No open PR found for branch "${this.branch}"`);
      }
      if (pr.state !== "OPEN") {
        throw new Error(`PR #${pr.number} is ${pr.state}, not OPEN`);
      }

      this.state.prNumber = pr.number;
      this.state.prUrl = pr.url;

      const botLogin = await this.ghClient.getCurrentUser();
      this.fetcher = new CommentFetcher(this.ghClient, pr.number, botLogin, this.branch);
      this.responder = new ThreadResponder(this.ghClient, this.branch, pr.number);
      this.pilotConfig = await loadPilotConfig(this.cwd);

      logger.info(
        `Starting session for PR #${pr.number} (${pr.title})`,
        this.branch,
      );

      while (
        this.running &&
        this.state.currentIteration < this.state.maxIterations
      ) {
        await this.runIteration(pr.baseRefName);
      }

      if (this.state.currentIteration >= this.state.maxIterations) {
        this.setStatus("paused");
        notify(
          "PR Pilot",
          `${this.branch}: reached max loops (${this.state.maxIterations}). Review needed.`,
        );
        logger.info(
          `Reached max iterations (${this.state.maxIterations})`,
          this.branch,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.state.error = message;
      this.setStatus("error");
      logger.error(message, this.branch);
    } finally {
      this.emit("done", this.branch, this.state);
    }
  }

  stop(): void {
    this.running = false;
    this.abortController.abort();
    logger.info("Stopping session", this.branch);
  }

  extendLoops(n: number): void {
    this.state.maxIterations += n;
    logger.info(
      `Extended max iterations to ${this.state.maxIterations}`,
      this.branch,
    );
    if (this.state.status === "paused") {
      this.start();
    }
  }

  private async runIteration(baseBranch: string): Promise<void> {
    const iterationStart = Date.now();
    this.state.currentIteration++;
    const iterNum = this.state.currentIteration;

    logger.info(
      `--- Iteration ${iterNum}/${this.state.maxIterations} ---`,
      this.branch,
    );

    // 1. FETCH — poll until comments appear
    this.setStatus("awaiting");
    const fetchedComments = await this.fetcher.fetch();

    if (fetchedComments.length === 0) {
      logger.info("No comments found — awaiting review feedback", this.branch);
      this.state.currentIteration--; // Don't count empty polls as iterations
      this.state.unresolvedCount = 0;
      if (!this.running) return;

      // Check if PR is still open
      const pr = await this.ghClient.findPRForBranch(this.branch);
      if (!pr || pr.state !== "OPEN") {
        logger.info(
          `PR is no longer open (${pr?.state ?? "not found"})`,
          this.branch,
        );
        this.setStatus("done");
        this.running = false;
        return;
      }

      await sleep(this.config.pollInterval * 1000);
      return;
    }

    this.state.unresolvedCount = fetchedComments.length;

    // 2. CATEGORIZE
    this.setStatus("categorizing");
    const categorized = await this.categorizer.categorize(fetchedComments);

    const summary: CommentSummary = {
      total: categorized.length,
      mustFix: categorized.filter((c) => c.category === "must_fix").length,
      shouldFix: categorized.filter((c) => c.category === "should_fix").length,
      niceToHave: categorized.filter((c) => c.category === "nice_to_have").length,
      falsePositive: categorized.filter((c) => c.category === "false_positive").length,
      comments: categorized,
    };
    this.state.commentSummary = summary;
    this.emit("sessionUpdate", this.branch, this.getState());

    logger.info(
      `Categorized: ${summary.mustFix} must_fix, ${summary.shouldFix} should_fix, ${summary.niceToHave} nice_to_have, ${summary.falsePositive} false_positive`,
      this.branch,
    );

    // 3. FILTER by pilotConfig.autoFix settings
    const actionable = categorized.filter((c) => {
      if (c.category === "false_positive") return false;
      if (c.category === "must_fix") return this.pilotConfig.autoFix.must_fix;
      if (c.category === "should_fix") return this.pilotConfig.autoFix.should_fix;
      if (c.category === "nice_to_have") return this.pilotConfig.autoFix.nice_to_have;
      return false;
    });

    const skipped = categorized.filter((c) => !actionable.includes(c));

    logger.info(
      `${actionable.length} actionable, ${skipped.length} skipped`,
      this.branch,
    );

    // Reply to skipped comments
    if (skipped.length > 0 && !this.config.dryRun) {
      await this.responder.replyToSkipped(skipped);
    }

    if (actionable.length === 0) {
      logger.info("No actionable comments after filtering", this.branch);
      const iterSummary = this.buildSummary(
        iterNum, iterationStart, categorized, actionable, skipped, 0, [],
      );
      this.state.iterations.push(iterSummary);
      this.emit("iterationComplete", this.branch, iterSummary);
      return;
    }

    // 4. FIX
    if (this.config.dryRun) {
      logger.info("[DRY RUN] Would fix the following comments:", this.branch);
      for (const c of actionable) {
        logger.info(`  - ${c.path}:${c.line ?? "?"} (${c.category})`, this.branch);
      }
      return;
    }

    // Stash any uncommitted work before making changes
    const didStash = await this.gitManager.stash();

    this.setStatus("fixing");
    const headBefore = await this.gitManager.getHeadSha();

    const fixResult = await this.executor.execute(
      actionable,
      this.pilotConfig,
      this.abortController.signal,
    );

    if (fixResult.isError) {
      logger.warn("Fix session had errors, discarding changes", this.branch);
      await this.gitManager.discardChanges();
    } else {
      // 5. VERIFY
      if (this.pilotConfig.verifyCommands.length > 0) {
        this.setStatus("verifying");
        for (const cmd of this.pilotConfig.verifyCommands) {
          try {
            const parts = cmd.split(/\s+/);
            await exec(parts[0], parts.slice(1), { cwd: this.cwd });
            logger.info(`Verify passed: ${cmd}`, this.branch);
          } catch (err) {
            logger.warn(`Verify failed: ${cmd}: ${err}`, this.branch);
          }
        }
      }

      // 6. PUSH
      this.setStatus("pushing");

      const diverged = await this.gitManager.checkDivergence();
      if (diverged) {
        const pulled = await this.gitManager.pullRebase();
        if (!pulled) {
          logger.error("Could not pull --rebase, skipping push", this.branch);
          if (didStash) await this.gitManager.stashPop();
          const iterSummary = this.buildSummary(
            iterNum, iterationStart, categorized, actionable, skipped,
            fixResult.costUsd, ["Rebase after divergence failed"],
          );
          this.state.iterations.push(iterSummary);
          this.emit("iterationComplete", this.branch, iterSummary);
          return;
        }
      }

      const rebased = await this.gitManager.rebaseAutosquash(baseBranch);
      if (!rebased) {
        logger.error("Rebase failed — manual intervention needed", this.branch);
        if (didStash) await this.gitManager.stashPop();
        this.state.error = "Rebase conflict — manual intervention needed";
        this.setStatus("error");
        this.running = false;
        return;
      }

      const pushed = await this.gitManager.forcePushWithLease();
      if (pushed) {
        this.state.lastPushAt = new Date().toISOString();
      } else {
        logger.error("Push failed", this.branch);
      }

      // 7. REPLY
      this.setStatus("replying");
      await this.responder.replyToAddressed(actionable);

      // 8. RE-REQUEST review
      if (this.state.prNumber) {
        const uniqueAuthors = [...new Set(actionable.map((c) => c.author))];
        await this.ghClient.requestReviewers(this.state.prNumber, uniqueAuthors);
      }
    }

    // Restore stashed changes
    if (didStash) await this.gitManager.stashPop();

    // Record iteration summary
    const changedFiles = fixResult.isError
      ? []
      : await this.gitManager
          .getChangedFilesSince(headBefore)
          .catch(() => [] as string[]);

    const iterSummary = this.buildSummary(
      iterNum, iterationStart, categorized, actionable, skipped,
      fixResult.costUsd, fixResult.errors,
    );
    iterSummary.changes = changedFiles;

    this.state.iterations.push(iterSummary);
    this.state.totalCostUsd += fixResult.costUsd;
    this.emit("iterationComplete", this.branch, iterSummary);

    logger.info(
      `Iteration ${iterNum} complete: ${actionable.length} fixed, ${skipped.length} skipped, $${fixResult.costUsd.toFixed(4)} cost`,
      this.branch,
    );
  }

  private buildSummary(
    iteration: number,
    startTime: number,
    allComments: CategorizedComment[],
    actionable: CategorizedComment[],
    skipped: CategorizedComment[],
    costUsd: number,
    errors: string[],
  ): IterationSummary {
    return {
      iteration,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
      eventsDetected: allComments.length,
      eventsFixed: actionable.length,
      eventsSkipped: skipped.length,
      costUsd,
      durationMs: Date.now() - startTime,
      changes: [],
      errors,
    };
  }

  private setStatus(status: BranchStatus): void {
    this.state.status = status;
    this.emit("statusChange", this.branch, status);
  }
}
