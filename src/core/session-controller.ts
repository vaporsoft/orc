/**
 * Main orchestration loop for a single branch.
 *
 * Pipeline: fetch → categorize → filter → fix → verify → push → reply → re-request review.
 * Emits events for the UI/TUI layer to consume.
 */

import { EventEmitter } from "node:events";
import * as path from "node:path";
import { GHClient } from "../github/gh-client.js";
import { CommentFetcher } from "./comment-fetcher.js";
import { CommentCategorizer } from "./comment-categorizer.js";
import { FixExecutor } from "./fix-executor.js";
import { GitManager } from "./git-manager.js";
import { ThreadResponder } from "./thread-responder.js";
import { loadRepoConfig } from "./repo-config.js";
import type { ProgressStore } from "./progress-store.js";
import type {
  BranchState,
  BranchStatus,
  CIStatus,
  CommentSummary,
  FailedCheck,
  RepoConfig,
  SessionMode,
} from "../types/index.js";
import type { Config } from "../types/config.js";
import { loadSettings, saveSettings } from "../utils/settings.js";
import { logger } from "../utils/logger.js";
import { exec } from "../utils/process.js";
import { RateLimitError } from "../utils/retry.js";
import { MAX_CI_FIX_ATTEMPTS } from "../constants.js";

/** Lockfiles that should be auto-resolved during rebase, not sent to Claude. */
const LOCKFILE_NAMES = new Set([
  "yarn.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "bun.lockb",
  "bun.lock",
]);

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
  private repoConfig!: RepoConfig;
  private mode: SessionMode;
  private state: BranchState;
  private progressStore: ProgressStore;
  private prAuthor: string | null = null;
  private abortController: AbortController;
  private running = false;
  private startedAt = 0;
  private conflictResolve: ((action: "resolve" | "dismiss") => void) | null = null;
  private pendingBaseBranch: string | null = null;

  constructor(branch: string, config: Config, cwd: string, mode: SessionMode = "once", progressStore: ProgressStore) {
    super();
    this.branch = branch;
    this.config = config;
    this.cwd = cwd;
    this.mode = mode;
    this.progressStore = progressStore;

    this.ghClient = new GHClient(cwd);
    this.categorizer = new CommentCategorizer(cwd, config.confidence);
    this.executor = new FixExecutor(config, cwd);
    this.gitManager = new GitManager(cwd, branch);
    this.abortController = new AbortController();

    const lifetime = progressStore.getLifetimeStats(branch);
    const totalCostUsd = lifetime.cycleHistory.reduce((sum, cycle) => sum + cycle.costUsd, 0);
    const totalInputTokens = lifetime.cycleHistory.reduce((sum, cycle) => sum + (cycle.inputTokens ?? 0), 0);
    const totalOutputTokens = lifetime.cycleHistory.reduce((sum, cycle) => sum + (cycle.outputTokens ?? 0), 0);

    this.state = {
      branch,
      prNumber: null,
      prUrl: null,
      status: "initializing",
      mode,
      commentsAddressed: 0,
      totalCostUsd,
      totalInputTokens,
      totalOutputTokens,
      error: null,
      unresolvedCount: 0,
      commentSummary: null,
      lastPushAt: null,
      claudeActivity: [],
      lastSessionId: null,
      workDir: cwd,
      sessionExpiresAt: null,
      ...lifetime,
      ciStatus: "unknown",
      failedChecks: [],
      ciFixAttempts: 0,
      conflicted: [],
      hasFixupCommits: false,
    };
  }

  updateConfig(config: Config): void {
    this.config = config;
    // Update dependent objects with new config
    this.categorizer = new CommentCategorizer(this.cwd, config.confidence);
    this.executor = new FixExecutor(config, this.cwd);
  }

  getState(): BranchState {
    return { ...this.state };
  }

  /** Update the conflicted paths (used by daemon to propagate merge conflict status). */
  setConflicted(paths: string[]): void {
    this.state.conflicted = paths;
    this.emit("sessionUpdate", this.branch, this.getState());
  }

  async start(): Promise<void> {
    this.running = true;
    this.startedAt = Date.now();
    if (this.mode === "watch" && this.config.sessionTimeout > 0) {
      this.state.sessionExpiresAt = this.startedAt + this.config.sessionTimeout * 60 * 60 * 1000;
    }

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
      this.repoConfig = await loadRepoConfig(this.cwd);

      logger.info(
        `Starting session for PR #${pr.number} (${pr.title})`,
        this.branch,
      );

      if (this.mode === "once") {
        await this.runCycle(pr.baseRefName);
        if (this.running) {
          this.setStatus("stopped");
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
      this.emit("ready", this.branch, this.state);
      try {
        const safeBranch = this.branch.replace(/[^a-zA-Z0-9_-]/g, "_");
        const logPath = path.join(process.cwd(), `.orc-session-${safeBranch}.txt`);
        logger.dumpBranchLogs(this.branch, logPath);
      } catch {}
    }
  }

  /** Rebase-only mode: rebase onto base, resolve conflicts if needed, push, then done. */
  async startRebase(): Promise<void> {
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
      this.repoConfig = await loadRepoConfig(this.cwd);

      logger.info(`Rebasing PR #${pr.number} onto ${pr.baseRefName}`, this.branch);

      // Rebase onto base branch
      const baseBranch = pr.baseRefName;
      logger.info("Rebasing onto base branch", this.branch);
      const rebasedOntoBase = await this.gitManager.pullRebase(baseBranch);
      if (!rebasedOntoBase) {
        const settings = loadSettings();
        if (settings?.autoResolveConflicts === "always" || settings?.autoResolveConflicts === true as unknown) {
          logger.info("Auto-resolving merge conflicts with Claude", this.branch);
          const resolved = await this.resolveConflicts(baseBranch);
          if (!resolved) {
            this.state.error = "Conflict resolution failed — manual intervention needed";
            this.setStatus("error");
            this.running = false;
            return;
          }
        } else if (settings?.autoResolveConflicts === "never") {
          // Immediately error out without prompting
          this.state.error = "Merge conflicts detected — auto-resolve disabled";
          this.setStatus("error");
          this.running = false;
          return;
        } else {
          // Pause and prompt user ("ask" or undefined)
          this.pendingBaseBranch = baseBranch;
          this.state.conflicted = await this.getConflictFiles(baseBranch);
          if (this.state.conflicted.length === 0) {
            this.state.conflicted = ["rebase conflict"];
          }
          this.setStatus("conflict_prompt");

          const action = await new Promise<"resolve" | "dismiss">((resolve) => {
            this.conflictResolve = resolve;
          });
          this.conflictResolve = null;
          this.pendingBaseBranch = null;

          if (action === "dismiss") {
            this.state.error = "Conflict resolution dismissed";
            this.setStatus("error");
            this.running = false;
            return;
          }

          const resolved = await this.resolveConflicts(baseBranch);
          if (!resolved) {
            this.state.error = "Conflict resolution failed — manual intervention needed";
            this.setStatus("error");
            this.running = false;
            return;
          }
        }
      }
      this.state.conflicted = [];

      // Autosquash any fixup commits before pushing
      const rebased = await this.gitManager.rebaseAutosquash(baseBranch);
      if (!rebased) {
        logger.warn("Autosquash rebase failed — pushing with unsquashed fixup commits", this.branch);
        this.state.hasFixupCommits = true;
      } else {
        this.state.hasFixupCommits = false;
      }

      // Push the rebased branch
      this.setStatus("pushing");
      const pushed = await this.gitManager.forcePushWithLease();
      if (pushed) {
        logger.info("Pushed rebased branch", this.branch);
        this.state.lastPushAt = new Date().toISOString();
        this.emit("pushed", this.branch);
      } else {
        logger.error("Push failed after rebase", this.branch);
      }

      this.setStatus("stopped");
      this.running = false;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.state.error = message;
      this.setStatus("error");
      logger.error(message, this.branch);
    } finally {
      this.emit("ready", this.branch, this.state);
      try {
        const safeBranch = this.branch.replace(/[^a-zA-Z0-9_-]/g, "_");
        const logPath = path.join(process.cwd(), `.orc-session-${safeBranch}.txt`);
        logger.dumpBranchLogs(this.branch, logPath);
      } catch {}
    }
  }

  stop(): void {
    this.running = false;
    this.abortController.abort();

    // Resolve any pending conflict resolution to avoid hanging
    if (this.conflictResolve) {
      this.conflictResolve("dismiss");
      this.conflictResolve = null;
    }

    logger.info("Stopping session", this.branch);
  }

  /** Sleep that resolves immediately when the abort signal fires. */
  private sleep(ms: number): Promise<void> {
    if (this.abortController.signal.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      this.abortController.signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private async runCycle(baseBranch: string): Promise<void> {
    // Track cycle start cost/tokens to include CI fix costs in cycle records
    const cycleStartCost = this.state.totalCostUsd;
    const cycleStartInputTokens = this.state.totalInputTokens;
    const cycleStartOutputTokens = this.state.totalOutputTokens;

    // 0. REBASE — proactively rebase onto base branch before starting
    let conflictsResolved = false;
    logger.info("Rebasing onto base branch before cycle", this.branch);
    const rebasedOntoBase = await this.gitManager.pullRebase(baseBranch);
    if (!rebasedOntoBase) {
      const settings = loadSettings();
      if (settings?.autoResolveConflicts === "always" || settings?.autoResolveConflicts === true as unknown) {
        logger.info("Auto-resolving merge conflicts with Claude", this.branch);
        const resolved = await this.resolveConflicts(baseBranch);
        if (!resolved) {
          this.state.error = "Auto-resolve failed — manual intervention needed";
          this.setStatus("error");
          this.running = false;
          return;
        }
        conflictsResolved = true;
      } else if (settings?.autoResolveConflicts === "never") {
        // Immediately error out without prompting
        this.state.error = "Merge conflicts detected — auto-resolve disabled";
        this.setStatus("error");
        this.running = false;
        return;
      } else {
        // Pause and wait for user decision via TUI prompt ("ask" or undefined)
        this.pendingBaseBranch = baseBranch;
        this.state.conflicted = await this.getConflictFiles(baseBranch);
        if (this.state.conflicted.length === 0) {
          this.state.conflicted = ["rebase conflict"];
        }
        this.setStatus("conflict_prompt");

        const action = await new Promise<"resolve" | "dismiss">((resolve) => {
          this.conflictResolve = resolve;
        });
        this.conflictResolve = null;
        this.pendingBaseBranch = null;

        if (action === "dismiss") {
          this.state.error = "Rebase conflict with base branch — manual intervention needed";
          this.setStatus("error");
          this.running = false;
          return;
        }

        // User chose to resolve
        const resolved = await this.resolveConflicts(baseBranch);
        if (!resolved) {
          this.state.error = "Conflict resolution failed — manual intervention needed";
          this.setStatus("error");
          this.running = false;
          return;
        }
        conflictsResolved = true;
      }
    }
    this.state.conflicted = [];

    // Push the rebased branch so the resolution persists on the remote
    if (conflictsResolved) {
      this.setStatus("pushing");
      const pushed = await this.gitManager.forcePushWithLease();
      if (pushed) {
        logger.info("Pushed rebased branch after conflict resolution", this.branch);
        this.state.lastPushAt = new Date().toISOString();
        this.emit("pushed", this.branch);
      } else {
        logger.error("Failed to push after conflict resolution", this.branch);
      }
    }

    // Reset CI fix attempts at the start of each cycle
    this.state.ciFixAttempts = 0;

    // 1. FETCH — poll until comments appear
    if (this.mode === "watch") this.setStatus("watching");
    const fetchedComments = await this.fetcher.fetch();

    if (fetchedComments.length === 0) {
      this.state.unresolvedCount = 0;

      // Check CI even when there are no comments to fix
      if (!this.config.dryRun) {
        if (this.mode === "watch") this.setStatus("watching");
        await this.checkAndFixCI(baseBranch);
      }

      if (this.mode === "once") {
        logger.info("No comments to address", this.branch);
        // Record a CI-only cycle (no comments seen, but we may have fixed CI)
        await this.progressStore.recordCycleStart(this.branch, this.state.prNumber!, []);
        const ciOnlyCycleCost = this.state.totalCostUsd - cycleStartCost;
        const ciOnlyCycleInput = this.state.totalInputTokens - cycleStartInputTokens;
        const ciOnlyCycleOutput = this.state.totalOutputTokens - cycleStartOutputTokens;
        await this.progressStore.recordCycleEnd(this.branch, 0, ciOnlyCycleCost, ciOnlyCycleInput, ciOnlyCycleOutput);
        this.syncLifetimeStats();
        this.setStatus("stopped");
        this.running = false;
        return;
      }

      // Record CI-only cycle costs for watch mode too (mirroring once mode above)
      const watchCiCycleCost = this.state.totalCostUsd - cycleStartCost;
      const watchCiCycleInput = this.state.totalInputTokens - cycleStartInputTokens;
      const watchCiCycleOutput = this.state.totalOutputTokens - cycleStartOutputTokens;
      if (watchCiCycleCost > 0 || watchCiCycleInput > 0 || watchCiCycleOutput > 0) {
        await this.progressStore.recordCycleStart(this.branch, this.state.prNumber!, []);
        await this.progressStore.recordCycleEnd(this.branch, 0, watchCiCycleCost, watchCiCycleInput, watchCiCycleOutput);
        this.syncLifetimeStats();
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
        this.setStatus("stopped");
        this.running = false;
        return;
      }

      // Check session timeout even when no comments are found (0 = unlimited)
      if (this.config.sessionTimeout > 0) {
        const elapsedHours = (Date.now() - this.startedAt) / (1000 * 60 * 60);
        if (elapsedHours >= this.config.sessionTimeout) {
          logger.info(
            `Session timeout reached (${this.config.sessionTimeout}h)`,
            this.branch,
          );
          this.setStatus("stopped");
          this.running = false;
          return;
        }
      }

      await this.sleep(this.config.pollInterval * 1000);
      return;
    }

    this.state.unresolvedCount = fetchedComments.length;

    // Record cycle start — registers thread IDs and opens a new cycle record
    const threadIds = fetchedComments.map((c) => c.thread.threadId);
    await this.progressStore.recordCycleStart(
      this.branch,
      this.state.prNumber!,
      threadIds,
    );
    this.syncLifetimeStats();

    // 2. CATEGORIZE
    this.setStatus("triaging");
    const {
      comments: categorized,
      costUsd: categorizationCost,
      inputTokens: catInputTokens,
      outputTokens: catOutputTokens,
    } = await this.categorizer.categorize(fetchedComments, this.abortController.signal);
    this.state.totalCostUsd += categorizationCost;
    this.state.totalInputTokens += catInputTokens;
    this.state.totalOutputTokens += catOutputTokens;
    if (!this.running) {
      const abortCycleCost = this.state.totalCostUsd - cycleStartCost;
      const abortCycleInput = this.state.totalInputTokens - cycleStartInputTokens;
      const abortCycleOutput = this.state.totalOutputTokens - cycleStartOutputTokens;
      await this.progressStore.recordCycleEnd(this.branch, 0, abortCycleCost, abortCycleInput, abortCycleOutput);
      this.syncLifetimeStats();
      return;
    }

    const summary: CommentSummary = {
      total: categorized.length,
      mustFix: categorized.filter((c) => c.category === "must_fix").length,
      shouldFix: categorized.filter((c) => c.category === "should_fix").length,
      niceToHave: categorized.filter((c) => c.category === "nice_to_have").length,
      falsePositive: categorized.filter((c) => c.category === "false_positive").length,
      verifyAndFix: categorized.filter((c) => c.category === "verify_and_fix").length,
      needsClarification: categorized.filter((c) => c.category === "needs_clarification").length,
      comments: categorized,
    };
    this.state.commentSummary = summary;
    this.emit("sessionUpdate", this.branch, this.getState());

    logger.info(
      `Categorized: ${summary.mustFix} must_fix, ${summary.shouldFix} should_fix, ${summary.niceToHave} nice_to_have, ${summary.falsePositive} false_positive, ${summary.verifyAndFix} verify_and_fix, ${summary.needsClarification} needs_clarification`,
      this.branch,
    );

    // 3. FILTER by repoConfig.autoFix settings
    // Separate needs_clarification — these go to the responder, not the fix executor
    const clarifications = categorized.filter(
      (c) => c.category === "needs_clarification" && this.repoConfig.autoFix.needs_clarification,
    );
    const actionable = categorized.filter((c) => {
      if (c.category === "needs_clarification") return false; // handled separately
      if (c.category === "verify_and_fix") return this.repoConfig.autoFix.verify_and_fix;
      if (c.category === "false_positive") return false;
      if (c.category === "must_fix") return this.repoConfig.autoFix.must_fix;
      if (c.category === "should_fix") return this.repoConfig.autoFix.should_fix;
      if (c.category === "nice_to_have") return this.repoConfig.autoFix.nice_to_have;
      return false;
    });

    const skipped = categorized.filter(
      (c) => !actionable.includes(c) && !clarifications.includes(c),
    );

    logger.info(
      `${actionable.length} actionable, ${clarifications.length} clarifications, ${skipped.length} skipped`,
      this.branch,
    );

    // Reply to skipped comments
    if (skipped.length > 0 && !this.config.dryRun) {
      await this.responder.replyToSkipped(skipped);
    }

    // Post clarification questions (one per thread, capped at 1 round)
    if (clarifications.length > 0 && !this.config.dryRun) {
      await this.responder.replyToClarifications(clarifications);
    }

    if (actionable.length === 0) {
      logger.info("No actionable comments after filtering", this.branch);

      // Check CI even when there are no actionable comments to fix
      if (!this.config.dryRun) {
        if (this.mode === "watch") this.setStatus("watching");
        await this.checkAndFixCI(baseBranch);
      }

      const noActionCycleCost = this.state.totalCostUsd - cycleStartCost;
      const noActionCycleInput = this.state.totalInputTokens - cycleStartInputTokens;
      const noActionCycleOutput = this.state.totalOutputTokens - cycleStartOutputTokens;
      await this.progressStore.recordCycleEnd(this.branch, 0, noActionCycleCost, noActionCycleInput, noActionCycleOutput);
      this.syncLifetimeStats();
      return;
    }

    // 4. FIX
    if (this.config.dryRun) {
      logger.info("[DRY RUN] Would fix the following comments:", this.branch);
      for (const c of actionable) {
        logger.info(`  - ${c.path}:${c.line ?? "?"} (${c.category})`, this.branch);
      }
      const dryRunCycleCost = this.state.totalCostUsd - cycleStartCost;
      const dryRunCycleInput = this.state.totalInputTokens - cycleStartInputTokens;
      const dryRunCycleOutput = this.state.totalOutputTokens - cycleStartOutputTokens;
      await this.progressStore.recordCycleEnd(this.branch, 0, dryRunCycleCost, dryRunCycleInput, dryRunCycleOutput);
      this.syncLifetimeStats();
      return;
    }

    this.setStatus("fixing");
    this.state.claudeActivity = [];
    const headBefore = await this.gitManager.getHeadSha();

    const MAX_ACTIVITY_LINES = 10;
    const fixResult = await this.executor.execute(
      actionable,
      this.repoConfig,
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

    let pushed = false;
    if (fixResult.isError) {
      logger.warn("Fix session had errors, skipping push", this.branch);
    } else if (madeCommits) {
      // 5. VERIFY
      if (this.repoConfig.verifyCommands.length > 0) {
        this.setStatus("verifying");
        for (const cmd of this.repoConfig.verifyCommands) {
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
      // We already rebased onto base at the top of the cycle, so divergence
      // from the remote branch is expected (rebase rewrites SHAs). Go straight
      // to autosquash + force-push-with-lease.
      this.setStatus("pushing");

      const rebased = await this.gitManager.rebaseAutosquash(baseBranch);
      if (!rebased) {
        logger.warn("Autosquash rebase failed — pushing with unsquashed fixup commits", this.branch);
        this.state.hasFixupCommits = true;
      } else {
        this.state.hasFixupCommits = false;
      }

      pushed = await this.gitManager.forcePushWithLease();
      if (pushed) {
        this.state.lastPushAt = new Date().toISOString();
        this.emit("pushed", this.branch);
      } else {
        logger.error("Push failed", this.branch);
      }
    } else {
      logger.info("No commits made — skipping push", this.branch);
    }

    // 7. REPLY — only after a successful push. If nothing was pushed (error,
    //    push failure, no commits) skip replies so the threads stay unresolved
    //    and will be retried on the next cycle or handled manually.
    const fixSucceeded = !fixResult.isError && madeCommits && pushed;

    if (fixSucceeded) {
      this.setStatus("replying");

      const currentSha = await this.gitManager.getHeadSha();
      const verifyComments = actionable.filter((c) => c.category === "verify_and_fix");
      const regularComments = actionable.filter((c) => c.category !== "verify_and_fix");

      if (regularComments.length > 0) {
        await this.responder.replyToAddressed(regularComments, currentSha, fixResult.fixSummaries);
      }
      if (verifyComments.length > 0) {
        await this.responder.replyToVerified(verifyComments, fixResult.verifyResults, currentSha);
      }
    }

    // 8. RE-REQUEST review and CI check only after successful push
    if (pushed) {
      if (this.state.prNumber && madeCommits) {
        const uniqueAuthors = [...new Set(actionable.map((c) => c.author))]
          .filter((a) => a !== this.prAuthor);
        if (uniqueAuthors.length > 0) {
          await this.ghClient.requestReviewers(this.state.prNumber, uniqueAuthors);
        }
      }

      // 8b. CI CHECK — poll checks after push and reply, auto-fix on failure
      if (this.mode === "watch") this.setStatus("watching");
      await this.checkAndFixCI(baseBranch);
    }

    // Update running totals - only count comments as fixed when commits are made and pushed successfully
    const fixedCount = (!fixResult.isError && madeCommits && pushed) ? actionable.length : 0;
    if (fixedCount > 0) {
      this.state.commentsAddressed += fixedCount;
    }

    // Calculate total cycle cost/tokens (including both review fixes and CI fixes)
    this.state.totalCostUsd += fixResult.costUsd;
    this.state.totalInputTokens += fixResult.inputTokens;
    this.state.totalOutputTokens += fixResult.outputTokens;
    const totalCycleCost = this.state.totalCostUsd - cycleStartCost;
    const totalCycleInput = this.state.totalInputTokens - cycleStartInputTokens;
    const totalCycleOutput = this.state.totalOutputTokens - cycleStartOutputTokens;

    // Persist cycle results with total cycle cost and tokens
    await this.progressStore.recordCycleEnd(this.branch, fixedCount, totalCycleCost, totalCycleInput, totalCycleOutput);
    this.syncLifetimeStats();
    this.state.commentSummary = null;
    this.state.claudeActivity = [];

    logger.info(
      `Cycle complete: ${fixedCount} fixed, ${skipped.length} skipped, $${totalCycleCost.toFixed(4)} cost`,
      this.branch,
    );

    // Check session timeout (0 = unlimited)
    if (this.config.sessionTimeout > 0) {
      const elapsedHours = (Date.now() - this.startedAt) / (1000 * 60 * 60);
      if (elapsedHours >= this.config.sessionTimeout) {
        logger.info(
          `Session timeout reached (${this.config.sessionTimeout}h)`,
          this.branch,
        );
        this.setStatus("stopped");
        this.running = false;
        return;
      }
    }

    // Wait before next cycle to let GitHub propagate replies (only in watch mode)
    if (this.mode === "watch") {
      await this.sleep(this.config.pollInterval * 1000);
    }
  }

  /** Called by the daemon when the TUI user presses R or A on a conflict prompt. */
  acceptConflictResolution(always: boolean): void {
    if (always) {
      saveSettings({ autoResolveConflicts: "always" });
      logger.info("Saved autoResolveConflicts=always to settings", this.branch);
    }
    if (this.conflictResolve) {
      this.conflictResolve("resolve");
    }
  }

  /** Called by the daemon when the TUI user presses Esc on a conflict prompt. */
  dismissConflictResolution(): void {
    if (this.conflictResolve) {
      this.conflictResolve("dismiss");
    }
  }

  /** Attempt to resolve conflicts by starting the rebase, letting Claude fix conflict markers, then continuing. */
  private async resolveConflicts(baseBranch: string): Promise<boolean> {
    this.setStatus("fixing");
    this.state.claudeActivity = [];

    // Start the rebase — this will stop at the first conflict
    logger.info("Starting rebase to expose conflict markers", this.branch);
    const conflictFiles = await this.gitManager.startConflictingRebase(baseBranch);

    if (conflictFiles === null) {
      logger.info("Rebase succeeded without conflicts", this.branch);
      return true;
    }

    if (conflictFiles.length === 0) {
      logger.error("Rebase failed for non-conflict reason", this.branch);
      return false;
    }

    // Loop: resolve conflicts at each rebase step
    const MAX_ROUNDS = 10;
    let round = 0;
    let currentFiles = conflictFiles;

    while (round < MAX_ROUNDS) {
      round++;
      logger.info(`Resolving conflicts (round ${round}): ${currentFiles.join(", ")}`, this.branch);

      // Auto-resolve lockfiles — never send these to Claude
      const lockfiles = currentFiles.filter((f) => LOCKFILE_NAMES.has(path.basename(f)));
      const codeFiles = currentFiles.filter((f) => !LOCKFILE_NAMES.has(path.basename(f)));

      if (lockfiles.length > 0) {
        logger.info(`Auto-resolving lockfiles: ${lockfiles.join(", ")}`, this.branch);
        for (const lf of lockfiles) {
          await exec("git", ["checkout", "--theirs", lf], { cwd: this.cwd });
          await exec("git", ["add", lf], { cwd: this.cwd });
        }
      }

      // If only lockfiles conflicted, skip Claude and just continue the rebase
      if (codeFiles.length === 0) {
        logger.info("Only lockfile conflicts — skipping Claude", this.branch);
      } else {
        const conflictContext = [
          "The rebase has paused with conflict markers in the following files.",
          "Resolve them by editing the files to remove all <<<<<<< / ======= / >>>>>>> markers,",
          "keeping the correct combined result.\n",
          "Conflicting files:",
          ...codeFiles.map((f) => `- ${f}`),
        ].join("\n");

        const MAX_ACTIVITY_LINES = 10;
        const fixResult = await this.executor.executeConflictFix(
          conflictContext,
          this.repoConfig,
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
        this.state.totalCostUsd += fixResult.costUsd;
        this.state.totalInputTokens += fixResult.inputTokens;
        this.state.totalOutputTokens += fixResult.outputTokens;
        this.state.claudeActivity = [];

        if (fixResult.isError) {
          logger.error("Conflict resolution session failed", this.branch);
          await this.gitManager.abortRebase();
          return false;
        }
      }

      // Stage resolved files and continue the rebase
      const continued = await this.gitManager.continueRebase();
      if (continued) {
        logger.info("Conflicts resolved successfully", this.branch);
        return true;
      }

      // More conflicts in the next commit — continueRebase returned false,
      // check if we still have unmerged files
      const { stdout } = await exec("git", ["diff", "--name-only", "--diff-filter=U"], {
        cwd: this.cwd,
        allowFailure: true,
      });
      currentFiles = stdout.trim().split("\n").filter(Boolean);
      if (currentFiles.length === 0) {
        logger.error("Rebase continue failed without conflict files", this.branch);
        await this.gitManager.abortRebase();
        return false;
      }
    }

    logger.error(`Gave up after ${MAX_ROUNDS} conflict resolution rounds`, this.branch);
    await this.gitManager.abortRebase();
    return false;
  }

  /** Get list of files that would conflict in a merge with the base branch. */
  private async getConflictFiles(baseBranch: string): Promise<string[]> {
    try {
      const { stdout, exitCode } = await exec("git", [
        "merge-tree", "--write-tree", "HEAD", `origin/${baseBranch}`,
      ], { cwd: this.cwd, allowFailure: true });

      if (exitCode === 0) return [];

      const conflictPaths: string[] = [];
      for (const line of stdout.split("\n")) {
        const match = line.match(/^CONFLICT \([^)]+\): Merge conflict in (.+)$/);
        if (match) {
          conflictPaths.push(match[1]);
        }
      }
      return conflictPaths;
    } catch {
      return [];
    }
  }

  /** Refresh in-memory lifetime stats from the persistent store. */
  private syncLifetimeStats(): void {
    const stats = this.progressStore.getLifetimeStats(this.branch);
    this.state.lifetimeAddressed = stats.lifetimeAddressed;
    this.state.lifetimeSeen = stats.lifetimeSeen;
    this.state.cycleCount = stats.cycleCount;
    this.state.cycleHistory = stats.cycleHistory;
  }

  /** Poll CI status after push and automatically attempt to fix failures. */
  private async checkAndFixCI(baseBranch: string): Promise<void> {
    if (!this.state.prNumber) return;

    // Keep retrying CI fixes up to MAX_CI_FIX_ATTEMPTS per cycle
    while (this.state.ciFixAttempts < MAX_CI_FIX_ATTEMPTS && this.running) {
      const ciResult = await this.pollCIStatus(this.state.ciFixAttempts > 0);
      this.state.ciStatus = ciResult.status;
      this.state.failedChecks = ciResult.failedChecks;
      this.emit("sessionUpdate", this.branch, this.getState());

      // Check if session was stopped during polling
      if (!this.running) return;

      // If CI is not failing, we're done
      if (ciResult.status !== "failing") return;

      this.state.ciFixAttempts++;
      logger.info(
        `CI failing, attempting auto-fix (attempt ${this.state.ciFixAttempts}/${MAX_CI_FIX_ATTEMPTS})`,
        this.branch,
      );

      const { context: ciContext, firstLogSnippet } = await this.buildCIContext(
        ciResult.failedChecks
      );

      // Set logSnippet on the first failed check for compatibility
      if (firstLogSnippet && this.state.failedChecks.length > 0 && !this.state.failedChecks[0].logSnippet) {
        this.state.failedChecks[0].logSnippet = firstLogSnippet;
      }

      this.setStatus("fixing");
      this.state.claudeActivity = [];
      const headBeforeCIFix = await this.gitManager.getHeadSha();

      const MAX_ACTIVITY_LINES = 10;
      const ciFixResult = await this.executor.executeCIFix(
        ciContext,
        this.repoConfig,
        this.abortController.signal,
        (line: string) => {
          this.state.claudeActivity.push(line);
          if (this.state.claudeActivity.length > MAX_ACTIVITY_LINES) {
            this.state.claudeActivity = this.state.claudeActivity.slice(-MAX_ACTIVITY_LINES);
          }
          this.emit("sessionUpdate", this.branch, this.getState());
        },
      );

      this.state.lastSessionId = ciFixResult.sessionId;
      this.state.totalCostUsd += ciFixResult.costUsd;
      this.state.totalInputTokens += ciFixResult.inputTokens;
      this.state.totalOutputTokens += ciFixResult.outputTokens;

      // Clean uncommitted files left by Claude
      const postCIDirty = await this.gitManager.hasUncommittedChanges();
      if (postCIDirty) {
        await this.gitManager.discardChanges();
      }

      const headAfterCIFix = await this.gitManager.getHeadSha();
      let pushSucceeded = true; // Track if push succeeded

      if (!ciFixResult.isError && headAfterCIFix !== headBeforeCIFix) {
        this.setStatus("pushing");
        const rebased = await this.gitManager.rebaseAutosquash(baseBranch);
        if (!rebased) {
          logger.warn("Autosquash rebase failed — pushing with unsquashed fixup commits", this.branch);
          this.state.hasFixupCommits = true;
        } else {
          this.state.hasFixupCommits = false;
        }
        const pushed = await this.gitManager.forcePushWithLease();
        if (pushed) {
          this.state.lastPushAt = new Date().toISOString();
          this.emit("pushed", this.branch);
        } else {
          pushSucceeded = false;
        }
      }

      this.state.claudeActivity = [];

      // If there was an error in the fix attempt, no changes were made, or push failed, break the loop
      if (ciFixResult.isError || headAfterCIFix === headBeforeCIFix || !pushSucceeded) {
        break;
      }

      // In once mode, do one fix attempt then return — daemon polls CI status
      if (this.mode === "once") {
        this.state.ciStatus = "pending";
        this.emit("sessionUpdate", this.branch, this.getState());
        return;
      }

      // Reset status before continuing to next CI polling cycle
      this.setStatus("watching");
    }

    // After exhausting all fix attempts (watch mode), poll once more to get
    // the final CI status. Without this, ciStatus stays "failing" from the
    // poll at the START of the last iteration.
    if (this.state.ciFixAttempts >= MAX_CI_FIX_ATTEMPTS && this.running) {
      const finalResult = await this.pollCIStatus(true);
      this.state.ciStatus = finalResult.status;
      this.state.failedChecks = finalResult.failedChecks;
      this.emit("sessionUpdate", this.branch, this.getState());

      if (finalResult.status === "failing") {
        logger.warn(
          `CI still failing after ${MAX_CI_FIX_ATTEMPTS} fix attempts, giving up`,
          this.branch,
        );
      }
    }
  }

  /** Wait for CI checks to complete, then return aggregated status.
   *  @param afterPush Whether we just pushed and need to wait for new checks to register. */
  private async pollCIStatus(afterPush = false): Promise<{ status: CIStatus; failedChecks: FailedCheck[] }> {
    if (!this.state.prNumber) return { status: "unknown", failedChecks: [] };

    // Wait for checks to start (GitHub needs time after push)
    if (afterPush) {
      this.state.ciStatus = "pending";
      this.emit("sessionUpdate", this.branch, this.getState());
      await this.sleep(10_000);
    }

    const maxWait = 10 * 60 * 1000; // 10 min max wait
    const pollInterval = 15_000;
    const start = Date.now();

    while (Date.now() - start < maxWait && this.running) {
      try {
        const checks = await this.ghClient.getCheckRuns(this.state.prNumber);
        if (checks.length === 0) {
          this.state.ciStatus = "pending";
          this.emit("sessionUpdate", this.branch, this.getState());
          await this.sleep(pollInterval);
          continue;
        }

        const allCompleted = checks.every((c) => c.status === "completed");
        const passing = new Set(["success", "neutral", "skipped"]);
        const completed = checks.filter((c) => c.status === "completed");
        const failed = completed.filter((c) => !passing.has(c.conclusion ?? ""));

        if (failed.length > 0) {
          // Report failures immediately, don't wait for remaining checks
          const failedChecks: FailedCheck[] = failed.map((c) => ({
            id: c.id,
            name: c.name,
            htmlUrl: c.html_url,
            logSnippet: null,
            appSlug: c.app?.slug ?? null,
          }));
          return { status: "failing", failedChecks };
        }

        if (allCompleted) {
          return { status: "passing", failedChecks: [] };
        }
      } catch (err) {
        if (err instanceof RateLimitError) {
          logger.warn("GitHub rate limit hit during CI polling, stopping", this.branch);
          return { status: "unknown", failedChecks: [] };
        }
        logger.debug(`CI poll error: ${err}`, this.branch);
      }

      this.state.ciStatus = "pending";
      this.emit("sessionUpdate", this.branch, this.getState());
      await this.sleep(pollInterval);
    }

    return { status: "unknown", failedChecks: [] };
  }

  /** Build context string describing CI failures for the fix executor. */
  private async buildCIContext(failedChecks: FailedCheck[]): Promise<{ context: string; firstLogSnippet?: string }> {
    if (!this.state.prNumber) return { context: "" };

    const sections: string[] = [];
    sections.push(`## Failing Checks (${failedChecks.length})\n`);

    // Get all failed workflow run logs for this commit
    const failedRunLogs: { name: string; log: string }[] = [];
    try {
      const runs = await this.ghClient.getWorkflowRuns(this.state.prNumber);
      for (const run of runs) {
        if (run.conclusion === "failure") {
          try {
            const log = await this.ghClient.getFailedRunLog(run.databaseId);
            if (log && log !== "(logs unavailable)") {
              failedRunLogs.push({ name: run.name, log });
            }
          } catch (err) {
            logger.debug(`Failed to get logs for run ${run.databaseId}: ${err}`, this.branch);
          }
        }
      }
    } catch (err) {
      logger.debug(`Failed to get workflow runs: ${err}`, this.branch);
    }

    for (const check of failedChecks) {
      sections.push(`### ${check.name}`);
      if (check.appSlug && check.appSlug !== "github-actions") {
        sections.push(`Provider: ${check.appSlug}`);
      }
      sections.push(`URL: ${check.htmlUrl}\n`);
    }

    // Add all failed workflow logs
    let firstLogSnippet: string | undefined;
    if (failedRunLogs.length > 0) {
      sections.push("## Failed Workflow Logs\n");
      for (const { name, log } of failedRunLogs) {
        sections.push(`### ${name}`);
        sections.push("```\n" + log + "\n```\n");
        // Capture the first log snippet for compatibility
        if (!firstLogSnippet) {
          firstLogSnippet = log.slice(0, 500);
        }
      }
    }

    return { context: sections.join("\n"), firstLogSnippet };
  }

  private setStatus(status: BranchStatus): void {
    this.state.status = status;
    this.emit("statusChange", this.branch, status);
  }
}
