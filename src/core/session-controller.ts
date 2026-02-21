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
import { sleep } from "../utils/retry.js";
import { exec } from "../utils/process.js";
import { MAX_CI_FIX_ATTEMPTS } from "../constants.js";

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

    this.state = {
      branch,
      prNumber: null,
      prUrl: null,
      status: "initializing",
      mode,
      commentsAddressed: 0,
      totalCostUsd,
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
    };
  }

  getState(): BranchState {
    return { ...this.state };
  }

  async start(): Promise<void> {
    this.running = true;
    this.startedAt = Date.now();
    if (this.mode === "watch") {
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
          this.setStatus("ready");
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
        if (settings?.autoResolveConflicts) {
          logger.info("Auto-resolving merge conflicts with Claude", this.branch);
          const resolved = await this.resolveConflicts(baseBranch);
          if (!resolved) {
            this.state.error = "Conflict resolution failed — manual intervention needed";
            this.setStatus("error");
            this.running = false;
            return;
          }
        } else {
          // Pause and prompt user
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

      this.setStatus("ready");
      this.running = false;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.state.error = message;
      this.setStatus("error");
      logger.error(message, this.branch);
    } finally {
      this.emit("ready", this.branch, this.state);
    }
  }

  stop(): void {
    this.running = false;
    this.abortController.abort();
    logger.info("Stopping session", this.branch);
  }

  private async runCycle(baseBranch: string): Promise<void> {

    // 0. REBASE — proactively rebase onto base branch before starting
    let conflictsResolved = false;
    logger.info("Rebasing onto base branch before cycle", this.branch);
    const rebasedOntoBase = await this.gitManager.pullRebase(baseBranch);
    if (!rebasedOntoBase) {
      const settings = loadSettings();
      if (settings?.autoResolveConflicts) {
        logger.info("Auto-resolving merge conflicts with Claude", this.branch);
        const resolved = await this.resolveConflicts(baseBranch);
        if (!resolved) {
          this.state.error = "Auto-resolve failed — manual intervention needed";
          this.setStatus("error");
          this.running = false;
          return;
        }
        conflictsResolved = true;
      } else {
        // Pause and wait for user decision via TUI prompt
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
    this.setStatus("listening");
    const fetchedComments = await this.fetcher.fetch();

    if (fetchedComments.length === 0) {
      this.state.unresolvedCount = 0;

      if (this.mode === "once") {
        logger.info("No comments to address", this.branch);
        this.setStatus("ready");
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
        this.setStatus("ready");
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
        this.setStatus("ready");
        this.running = false;
        return;
      }

      await sleep(this.config.pollInterval * 1000);
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

    // 3. FILTER by repoConfig.autoFix settings
    const actionable = categorized.filter((c) => {
      if (c.category === "verify_and_fix") return this.repoConfig.autoFix.verify_and_fix;
      if (c.category === "false_positive") return false;
      if (c.category === "must_fix") return this.repoConfig.autoFix.must_fix;
      if (c.category === "should_fix") return this.repoConfig.autoFix.should_fix;
      if (c.category === "nice_to_have") return this.repoConfig.autoFix.nice_to_have;
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
      await this.progressStore.recordCycleEnd(this.branch, 0, 0);
      this.syncLifetimeStats();
      return;
    }

    // 4. FIX
    if (this.config.dryRun) {
      logger.info("[DRY RUN] Would fix the following comments:", this.branch);
      for (const c of actionable) {
        logger.info(`  - ${c.path}:${c.line ?? "?"} (${c.category})`, this.branch);
      }
      await this.progressStore.recordCycleEnd(this.branch, 0, 0);
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
      this.setStatus("pushing");

      const diverged = await this.gitManager.checkDivergence();
      if (diverged) {
        const pulled = await this.gitManager.pullRebase();
        if (!pulled) {
          logger.error("Could not pull --rebase, skipping push", this.branch);
          this.state.totalCostUsd += fixResult.costUsd;
          await this.progressStore.recordCycleEnd(this.branch, 0, fixResult.costUsd);
          this.syncLifetimeStats();
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
        await this.progressStore.recordCycleEnd(this.branch, 0, fixResult.costUsd);
        this.syncLifetimeStats();
        return;
      }

      pushed = await this.gitManager.forcePushWithLease();
      if (pushed) {
        this.state.lastPushAt = new Date().toISOString();
        this.emit("pushed", this.branch);
        this.setStatus("listening");

        // 6b. CI CHECK — poll checks after push, auto-fix on failure
        await this.checkAndFixCI(baseBranch);
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

    // Update running totals - only count comments as fixed when commits are made and pushed successfully
    const fixedCount = (!fixResult.isError && madeCommits && pushed) ? actionable.length : 0;
    if (fixedCount > 0) {
      this.state.commentsAddressed += fixedCount;
    }
    this.state.totalCostUsd += fixResult.costUsd;

    // Persist cycle results
    await this.progressStore.recordCycleEnd(this.branch, fixedCount, fixResult.costUsd);
    this.syncLifetimeStats();
    this.state.commentSummary = null;
    this.state.claudeActivity = [];

    logger.info(
      `Cycle complete: ${fixedCount} fixed, ${skipped.length} skipped, $${fixResult.costUsd.toFixed(4)} cost`,
      this.branch,
    );

    // Check session timeout
    const elapsedHours = (Date.now() - this.startedAt) / (1000 * 60 * 60);
    if (elapsedHours >= this.config.sessionTimeout) {
      logger.info(
        `Session timeout reached (${this.config.sessionTimeout}h)`,
        this.branch,
      );
      this.setStatus("ready");
      this.running = false;
      return;
    }

    // Wait before next cycle to let GitHub propagate replies (only in watch mode)
    if (this.mode === "watch") {
      await sleep(this.config.pollInterval * 1000);
    }
  }

  /** Called by the daemon when the TUI user presses R or A on a conflict prompt. */
  acceptConflictResolution(always: boolean): void {
    if (always) {
      saveSettings({ autoResolveConflicts: true });
      logger.info("Saved autoResolveConflicts=true to settings", this.branch);
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

      const conflictContext = [
        "The rebase has paused with conflict markers in the following files.",
        "Resolve them by editing the files to remove all <<<<<<< / ======= / >>>>>>> markers,",
        "keeping the correct combined result.\n",
        "Conflicting files:",
        ...currentFiles.map((f) => `- ${f}`),
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
      this.state.claudeActivity = [];

      if (fixResult.isError) {
        logger.error("Conflict resolution session failed", this.branch);
        await this.gitManager.abortRebase();
        return false;
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
      const ciResult = await this.pollCIStatus();
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

      const ciContext = await this.buildCIContext(
        ciResult.failedChecks
      );

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

      // Clean uncommitted files left by Claude
      const postCIDirty = await this.gitManager.hasUncommittedChanges();
      if (postCIDirty) {
        await this.gitManager.discardChanges();
      }

      const headAfterCIFix = await this.gitManager.getHeadSha();
      let pushSucceeded = true; // Track if push succeeded

      if (!ciFixResult.isError && headAfterCIFix !== headBeforeCIFix) {
        this.setStatus("pushing");
        const diverged = await this.gitManager.checkDivergence();
        if (diverged) {
          const pulled = await this.gitManager.pullRebase();
          if (!pulled) {
            logger.error("Could not pull --rebase during CI fix, skipping push", this.branch);
            pushSucceeded = false;
          }
        }
        if (pushSucceeded) {
          const rebased = await this.gitManager.rebaseAutosquash(baseBranch);
          if (rebased) {
            const pushed = await this.gitManager.forcePushWithLease();
            if (pushed) {
              this.state.lastPushAt = new Date().toISOString();
              this.emit("pushed", this.branch);
            } else {
              pushSucceeded = false;
            }
          } else {
            pushSucceeded = false;
          }
        }
      }

      this.state.claudeActivity = [];

      // If there was an error in the fix attempt, no changes were made, or push failed, break the loop
      if (ciFixResult.isError || headAfterCIFix === headBeforeCIFix || !pushSucceeded) {
        break;
      }

      // Reset status before continuing to next CI polling cycle
      this.setStatus("listening");
    }

    // Log if we've exhausted all attempts
    if (this.state.ciFixAttempts >= MAX_CI_FIX_ATTEMPTS && this.running) {
      logger.warn(
        `CI still failing after ${MAX_CI_FIX_ATTEMPTS} fix attempts, giving up`,
        this.branch,
      );
    }
  }

  /** Wait for CI checks to complete, then return aggregated status. */
  private async pollCIStatus(): Promise<{ status: CIStatus; failedChecks: FailedCheck[] }> {
    if (!this.state.prNumber) return { status: "unknown", failedChecks: [] };

    // Wait for checks to start (GitHub needs time after push)
    this.state.ciStatus = "pending";
    this.emit("sessionUpdate", this.branch, this.getState());
    await sleep(15_000);

    const maxWait = 10 * 60 * 1000; // 10 min max wait
    const pollInterval = 30_000;
    const start = Date.now();

    while (Date.now() - start < maxWait && this.running) {
      try {
        const checks = await this.ghClient.getCheckRuns(this.state.prNumber);
        if (checks.length === 0) {
          this.state.ciStatus = "pending";
          this.emit("sessionUpdate", this.branch, this.getState());
          await sleep(pollInterval);
          continue;
        }

        const allCompleted = checks.every((c) => c.status === "completed");
        if (allCompleted) {
          const failed = checks.filter((c) => c.conclusion === "failure");
          if (failed.length === 0) {
            return { status: "passing", failedChecks: [] };
          }

          const failedChecks: FailedCheck[] = failed.map((c) => ({
            id: c.id,
            name: c.name,
            htmlUrl: c.html_url,
            logSnippet: null,
          }));
          return { status: "failing", failedChecks };
        }
      } catch (err) {
        logger.debug(`CI poll error: ${err}`, this.branch);
      }

      this.state.ciStatus = "pending";
      this.emit("sessionUpdate", this.branch, this.getState());
      await sleep(pollInterval);
    }

    return { status: "unknown", failedChecks: [] };
  }

  /** Build context string describing CI failures for the fix executor. */
  private async buildCIContext(failedChecks: FailedCheck[]): Promise<string> {
    if (!this.state.prNumber) return "";

    const sections: string[] = [];
    sections.push(`## Failing Checks (${failedChecks.length})\n`);

    // Get all failed workflow run logs for this commit
    let failedRunLogs: Array<{ name: string; log: string }> = [];
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
      sections.push(`URL: ${check.htmlUrl}\n`);
    }

    // Add all failed workflow logs
    if (failedRunLogs.length > 0) {
      sections.push("## Failed Workflow Logs\n");
      for (const { name, log } of failedRunLogs) {
        sections.push(`### ${name}`);
        sections.push("```\n" + log + "\n```\n");
        // Set logSnippet on the first failed check for compatibility
        if (failedChecks.length > 0 && !failedChecks[0].logSnippet) {
          failedChecks[0].logSnippet = log.slice(0, 500);
        }
      }
    }

    return sections.join("\n");
  }

  private setStatus(status: BranchStatus): void {
    this.state.status = status;
    this.emit("statusChange", this.branch, status);
  }
}
