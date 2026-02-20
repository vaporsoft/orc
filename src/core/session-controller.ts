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
  CommentSummary,
  RepoPilotConfig,
  SessionMode,
} from "../types/index.js";
import type { Config } from "../types/config.js";
import { logger } from "../utils/logger.js";
import { sleep } from "../utils/retry.js";
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
  private mode: SessionMode;
  private state: BranchState;
  private prAuthor: string | null = null;
  private abortController: AbortController;
  private running = false;
  private startedAt = 0;

  constructor(branch: string, config: Config, cwd: string, mode: SessionMode = "once") {
    super();
    this.branch = branch;
    this.config = config;
    this.cwd = cwd;
    this.mode = mode;

    this.ghClient = new GHClient(cwd);
    this.categorizer = new CommentCategorizer(cwd, config.confidence);
    this.executor = new FixExecutor(config, cwd);
    this.gitManager = new GitManager(cwd, branch);
    this.abortController = new AbortController();

    this.state = {
      branch,
      prNumber: null,
      prUrl: null,
      status: "initializing",
      mode,
      commentsAddressed: 0,
      totalCostUsd: 0,
      error: null,
      unresolvedCount: 0,
      commentSummary: null,
      lastPushAt: null,
      claudeActivity: [],
      lastSessionId: null,
      workDir: cwd,
    };
  }

  getState(): BranchState {
    return { ...this.state };
  }

  async start(): Promise<void> {
    this.running = true;
    this.startedAt = Date.now();

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
      this.prAuthor = pr.author.login;

      const botLogin = await this.ghClient.getCurrentUser();
      this.fetcher = new CommentFetcher(this.ghClient, pr.number, botLogin, this.branch);
      this.responder = new ThreadResponder(this.ghClient, this.branch, pr.number);
      this.pilotConfig = await loadPilotConfig(this.cwd);

      logger.info(
        `Starting session for PR #${pr.number} (${pr.title})`,
        this.branch,
      );

      if (this.mode === "once") {
        await this.runCycle(pr.baseRefName);
        if (this.running) {
          this.setStatus("done");
          this.running = false;
        }
      } else {
        while (this.running) {
          await this.runCycle(pr.baseRefName);
        }
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

  private async runCycle(baseBranch: string): Promise<void> {

    // 1. FETCH — poll until comments appear
    this.setStatus("listening");
    const fetchedComments = await this.fetcher.fetch();

    if (fetchedComments.length === 0) {
      this.state.unresolvedCount = 0;

      if (this.mode === "once") {
        logger.info("No comments to address", this.branch);
        this.setStatus("done");
        this.running = false;
        return;
      }

      logger.info("No comments found — awaiting review feedback", this.branch);
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

      // Check session timeout even when no comments are found
      const elapsedHours = (Date.now() - this.startedAt) / (1000 * 60 * 60);
      if (elapsedHours >= this.config.sessionTimeout) {
        logger.info(
          `Session timeout reached (${this.config.sessionTimeout}h)`,
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
      verifyAndFix: categorized.filter((c) => c.category === "verify_and_fix").length,
      comments: categorized,
    };
    this.state.commentSummary = summary;
    this.emit("sessionUpdate", this.branch, this.getState());

    logger.info(
      `Categorized: ${summary.mustFix} must_fix, ${summary.shouldFix} should_fix, ${summary.niceToHave} nice_to_have, ${summary.falsePositive} false_positive, ${summary.verifyAndFix} verify_and_fix`,
      this.branch,
    );

    // 3. FILTER by pilotConfig.autoFix settings
    const actionable = categorized.filter((c) => {
      if (c.category === "verify_and_fix") return this.pilotConfig.autoFix.verify_and_fix;
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

    this.setStatus("fixing");
    this.state.claudeActivity = [];
    const headBefore = await this.gitManager.getHeadSha();

    const MAX_ACTIVITY_LINES = 10;
    const fixResult = await this.executor.execute(
      actionable,
      this.pilotConfig,
      this.abortController.signal,
      (line: string) => {
        this.state.claudeActivity.push(line);
        if (this.state.claudeActivity.length > MAX_ACTIVITY_LINES) {
          this.state.claudeActivity = this.state.claudeActivity.slice(-MAX_ACTIVITY_LINES);
        }
        this.emit("sessionUpdate", this.branch, this.getState());
      },
    );

    this.state.lastSessionId = fixResult.sessionId;

    // Clean uncommitted files (e.g. .orc-verify.json) left by Claude
    const postFixDirty = await this.gitManager.hasUncommittedChanges();
    if (postFixDirty) {
      logger.info("Cleaning uncommitted changes left by fix session", this.branch);
      await this.gitManager.discardChanges();
    }

    // Check if Claude actually made any commits
    const headAfter = await this.gitManager.getHeadSha();
    const madeCommits = headAfter !== headBefore;

    if (fixResult.isError) {
      logger.warn("Fix session had errors, skipping push", this.branch);
    } else if (madeCommits) {
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
          this.state.totalCostUsd += fixResult.costUsd;
          return;
        }
      }

      const rebased = await this.gitManager.rebaseAutosquash(baseBranch);
      if (!rebased) {
        logger.error("Rebase failed — manual intervention needed", this.branch);
        this.state.error = "Rebase conflict — manual intervention needed";
        this.setStatus("error");
        this.running = false;
        this.state.totalCostUsd += fixResult.costUsd;
        return;
      }

      const pushed = await this.gitManager.forcePushWithLease();
      if (pushed) {
        this.state.lastPushAt = new Date().toISOString();
        this.emit("pushed", this.branch);
      } else {
        logger.error("Push failed", this.branch);
      }
    } else {
      logger.info("No commits made — skipping push", this.branch);
    }

    // 7. REPLY — always reply, even when no commits (e.g. verify_and_fix → not_applicable)
    this.setStatus("replying");

    // Get the current SHA after rebase/push to ensure replies link to the correct commit
    const currentSha = madeCommits ? await this.gitManager.getHeadSha() : undefined;

    const verifyComments = actionable.filter((c) => c.category === "verify_and_fix");
    const regularComments = actionable.filter((c) => c.category !== "verify_and_fix");

    // Only reply to regular comments if fixes were successfully applied
    if (regularComments.length > 0 && !fixResult.isError && madeCommits) {
      await this.responder.replyToAddressed(regularComments, currentSha);
    }
    if (verifyComments.length > 0) {
      await this.responder.replyToVerified(verifyComments, fixResult.verifyResults, currentSha);
    }

    // 8. RE-REQUEST review (exclude the PR author — GitHub rejects that)
    if (this.state.prNumber && madeCommits) {
      const uniqueAuthors = [...new Set(actionable.map((c) => c.author))]
        .filter((a) => a !== this.prAuthor);
      if (uniqueAuthors.length > 0) {
        await this.ghClient.requestReviewers(this.state.prNumber, uniqueAuthors);
      }
    }

    // Update running totals
    if (!fixResult.isError) {
      this.state.commentsAddressed += actionable.length;
    }
    this.state.totalCostUsd += fixResult.costUsd;
    this.state.commentSummary = null;
    this.state.claudeActivity = [];

    logger.info(
      `Cycle complete: ${actionable.length} fixed, ${skipped.length} skipped, $${fixResult.costUsd.toFixed(4)} cost`,
      this.branch,
    );

    // Check session timeout
    const elapsedHours = (Date.now() - this.startedAt) / (1000 * 60 * 60);
    if (elapsedHours >= this.config.sessionTimeout) {
      logger.info(
        `Session timeout reached (${this.config.sessionTimeout}h)`,
        this.branch,
      );
      this.setStatus("done");
      this.running = false;
      return;
    }

    // Wait before next cycle to let GitHub propagate replies (only in watch mode)
    if (this.mode === "watch") {
      await sleep(this.config.pollInterval * 1000);
    }
  }

  private setStatus(status: BranchStatus): void {
    this.state.status = status;
    this.emit("statusChange", this.branch, status);
  }
}
