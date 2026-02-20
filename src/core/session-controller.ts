/**
 * Main orchestration loop for a single branch.
 *
 * Coordinates: polling → debouncing → analyzing → fixing → pushing → replying.
 * Emits events for the UI/TUI layer to consume.
 */

import { EventEmitter } from "node:events";
import { GHClient } from "../github/gh-client.js";
import { PRMonitor } from "./pr-monitor.js";
import { EventDebouncer } from "./event-debouncer.js";
import { CommentAnalyzer } from "./comment-analyzer.js";
import { FixExecutor } from "./fix-executor.js";
import { GitManager } from "./git-manager.js";
import { ThreadResponder } from "./thread-responder.js";
import type {
  BranchState,
  BranchStatus,
  IterationSummary,
  PREvent,
} from "../types/index.js";
import type { Config } from "../types/config.js";
import { logger } from "../utils/logger.js";
import { sleep } from "../utils/retry.js";
import { notify } from "../utils/notify.js";

export class SessionController extends EventEmitter {
  private config: Config;
  private branch: string;
  private cwd: string;
  private ghClient: GHClient;
  private monitor!: PRMonitor;
  private debouncer: EventDebouncer;
  private analyzer: CommentAnalyzer;
  private executor: FixExecutor;
  private gitManager: GitManager;
  private responder: ThreadResponder;
  private state: BranchState;
  private abortController: AbortController;
  private running = false;

  constructor(branch: string, config: Config, cwd: string) {
    super();
    this.branch = branch;
    this.config = config;
    this.cwd = cwd;

    this.ghClient = new GHClient(cwd);
    this.debouncer = new EventDebouncer(
      config.debounce * 1000,
      branch,
    );
    this.analyzer = new CommentAnalyzer();
    this.executor = new FixExecutor(config, cwd);
    this.gitManager = new GitManager(cwd, branch);
    this.responder = new ThreadResponder(this.ghClient, branch);
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
      seenThreadIds: new Set(),
      seenCheckIds: new Set(),
    };
  }

  /** Get the current branch state (for UI). */
  getState(): BranchState {
    return { ...this.state };
  }

  /** Start the orchestration loop. */
  async start(): Promise<void> {
    this.running = true;

    try {
      // Validate prerequisites
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
      this.monitor = new PRMonitor(this.ghClient, pr.number, this.branch);

      logger.info(
        `Starting session for PR #${pr.number} (${pr.title})`,
        this.branch,
      );

      // Main loop
      while (
        this.running &&
        this.state.currentIteration < this.state.maxIterations
      ) {
        await this.runIteration(pr.baseRefName);
      }

      // Finished all iterations
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

  /** Stop the loop gracefully. */
  stop(): void {
    this.running = false;
    this.abortController.abort();
    this.debouncer.cancel();
    logger.info("Stopping session", this.branch);
  }

  /** Extend the max iterations. */
  extendLoops(n: number): void {
    this.state.maxIterations += n;
    logger.info(
      `Extended max iterations to ${this.state.maxIterations}`,
      this.branch,
    );
    // Resume if paused
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

    // 1. Poll for new events
    this.setStatus("polling");
    let eventsCollected: PREvent[] = [];

    // Poll loop: keep polling until we get events, then debounce
    while (this.running && eventsCollected.length === 0) {
      const pollResult = await this.monitor.poll(
        this.state.seenThreadIds,
        this.state.seenCheckIds,
      );

      if (pollResult.newEvents.length > 0) {
        this.debouncer.add(pollResult.newEvents);
        this.setStatus("debouncing");

        // Start debounce — keep polling during debounce window
        const debouncePromise = this.debouncer.waitForFlush();

        // Poll once more during debounce to catch late-arriving events
        const debounceCheck = async () => {
          await sleep(this.config.pollInterval * 1000 / 2);
          if (!this.running) return;
          const morePoll = await this.monitor.poll(
            this.state.seenThreadIds,
            this.state.seenCheckIds,
          );
          if (morePoll.newEvents.length > 0) {
            this.debouncer.add(morePoll.newEvents);
          }
        };

        // Run debounce check in parallel with the debounce timer
        debounceCheck().catch(() => {});
        eventsCollected = await debouncePromise;
      } else {
        // No new events, sleep and poll again
        if (!this.running) return;
        await sleep(this.config.pollInterval * 1000);
      }

      // Check if PR was closed/merged
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
    }

    if (!this.running || eventsCollected.length === 0) return;

    // 2. Fetch CI logs for failures
    for (const event of eventsCollected) {
      if (event.type === "ci_failure" && event.ciCheck?.runId) {
        event.ciLog = await this.monitor.fetchCILog(event.ciCheck.runId);
      }
    }

    // 3. Analyze comments
    this.setStatus("analyzing");
    const analyses = await this.analyzer.analyze(eventsCollected);

    // Split into actionable vs skipped
    const actionable = eventsCollected.filter((event) => {
      if (event.type === "ci_failure") return true;
      const analysis = analyses.find(
        (a) => a.threadId === event.thread?.threadId,
      );
      return (
        analysis &&
        analysis.confidence >= this.config.confidence &&
        analysis.category !== "false_positive"
      );
    });

    const skipped = eventsCollected.filter(
      (e) => !actionable.includes(e),
    );

    logger.info(
      `${actionable.length} actionable, ${skipped.length} skipped`,
      this.branch,
    );

    // Mark all events as seen
    for (const event of eventsCollected) {
      if (event.type === "review_comment" && event.thread) {
        this.state.seenThreadIds.add(event.key);
      } else if (event.type === "ci_failure") {
        this.state.seenCheckIds.add(event.key);
      }
    }

    // Reply to skipped comments
    if (skipped.length > 0 && !this.config.dryRun) {
      await this.responder.replyToSkipped(
        skipped,
        analyses,
        this.config.confidence,
      );
    }

    if (actionable.length === 0) {
      logger.info("No actionable events, continuing to poll", this.branch);
      return;
    }

    // 4. Fix
    if (this.config.dryRun) {
      logger.info("[DRY RUN] Would fix the following events:", this.branch);
      for (const e of actionable) {
        logger.info(
          `  - ${e.type}: ${e.thread?.path ?? e.ciCheck?.name ?? e.key}`,
          this.branch,
        );
      }
      return;
    }

    this.setStatus("fixing");
    const headBefore = await this.gitManager.getHeadSha();

    const fixResult = await this.executor.execute(
      actionable,
      analyses.filter((a) =>
        actionable.some(
          (e) =>
            e.thread?.threadId === a.threadId || e.key === a.threadId,
        ),
      ),
      this.abortController.signal,
    );

    if (fixResult.isError) {
      logger.warn("Fix session had errors, discarding changes", this.branch);
      await this.gitManager.discardChanges();
    } else {
      // 5. Rebase + push
      this.setStatus("pushing");

      // Check for divergence first
      const diverged = await this.gitManager.checkDivergence();
      if (diverged) {
        const pulled = await this.gitManager.pullRebase();
        if (!pulled) {
          logger.error(
            "Could not pull --rebase, skipping push",
            this.branch,
          );
          const summary = this.buildSummary(
            iterNum,
            iterationStart,
            eventsCollected,
            actionable,
            skipped,
            fixResult.costUsd,
            ["Rebase after divergence failed"],
          );
          this.state.iterations.push(summary);
          this.emit("iterationComplete", this.branch, summary);
          return;
        }
      }

      const rebased = await this.gitManager.rebaseAutosquash(baseBranch);
      if (!rebased) {
        logger.error(
          "Rebase failed — manual intervention needed",
          this.branch,
        );
        this.state.error = "Rebase conflict — manual intervention needed";
        this.setStatus("error");
        this.running = false;
        return;
      }

      const pushed = await this.gitManager.forcePushWithLease();
      if (!pushed) {
        logger.error("Push failed", this.branch);
      }

      // 6. Reply to addressed threads
      await this.responder.replyToAddressed(
        actionable,
        analyses,
      );
    }

    // Record iteration summary
    const changedFiles = fixResult.isError
      ? []
      : await this.gitManager
          .getChangedFilesSince(headBefore)
          .catch(() => [] as string[]);

    const summary = this.buildSummary(
      iterNum,
      iterationStart,
      eventsCollected,
      actionable,
      skipped,
      fixResult.costUsd,
      fixResult.errors,
    );
    summary.changes = changedFiles;

    this.state.iterations.push(summary);
    this.state.totalCostUsd += fixResult.costUsd;
    this.emit("iterationComplete", this.branch, summary);

    logger.info(
      `Iteration ${iterNum} complete: ${actionable.length} fixed, ${skipped.length} skipped, $${fixResult.costUsd.toFixed(4)} cost`,
      this.branch,
    );
  }

  private buildSummary(
    iteration: number,
    startTime: number,
    allEvents: PREvent[],
    actionable: PREvent[],
    skipped: PREvent[],
    costUsd: number,
    errors: string[],
  ): IterationSummary {
    return {
      iteration,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
      eventsDetected: allEvents.length,
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
