/**
 * Always-on daemon that discovers open PRs authored by the current user.
 * PRs are discovered but not auto-started — the TUI controls which to run.
 * Also fetches unresolved comment counts for the TUI badge.
 */

import { EventEmitter } from "node:events";
import { SessionController } from "./session-controller.js";
import { CommentFetcher, type ThreadCounts } from "./comment-fetcher.js";
import { GitManager } from "./git-manager.js";
import { WorktreeManager } from "./worktree-manager.js";
import { ProgressStore } from "./progress-store.js";
import { GHClient } from "../github/gh-client.js";
import type { Config } from "../types/config.js";
import type { BranchState, BranchStatus, CIStatus, FailedCheck, ReviewThread, SessionMode } from "../types/index.js";
import type { GHPullRequest } from "../github/types.js";
import { logger } from "../utils/logger.js";
import { exec } from "../utils/process.js";
import { mapWithConcurrency } from "../utils/concurrency.js";
import { RateLimitError } from "../utils/retry.js";
import { loadSettings } from "../utils/settings.js";
import { notify } from "../utils/notify.js";

interface ActiveSession {
  controller: SessionController | null;
  promise: Promise<void>;
}

export class Daemon extends EventEmitter {
  private config: Config;
  private cwd: string;
  private ghClient: GHClient;
  private worktreeManager: WorktreeManager;
  private progressStore: ProgressStore;
  private sessions = new Map<string, ActiveSession>();
  private discoveredPRs = new Map<string, GHPullRequest>();
  private commentCounts = new Map<string, number>();
  private commentThreads = new Map<string, ReviewThread[]>();
  private threadCounts = new Map<string, ThreadCounts>();
  private lastStates = new Map<string, BranchState>();
  private mergedPRs = new Map<string, { pr: GHPullRequest; mergedAt: number }>();
  private ciStatuses = new Map<string, CIStatus>();
  private ciFailedChecks = new Map<string, FailedCheck[]>();
  private conflictStatuses = new Map<string, string[]>();
  private running = false;
  private abortController = new AbortController();
  private botLogin: string | null = null;
  private cachedNotificationSettings: boolean | null = null;
  private isInitialDiscovery = true;

  constructor(config: Config, cwd: string) {
    super();
    this.config = config;
    this.cwd = cwd;
    this.ghClient = new GHClient(cwd);
    this.worktreeManager = new WorktreeManager(cwd);
    this.progressStore = new ProgressStore(cwd);
  }

  getProgressStore(): ProgressStore {
    return this.progressStore;
  }

  getSessions(): Map<string, SessionController> {
    const result = new Map<string, SessionController>();
    for (const [branch, session] of this.sessions) {
      if (session.controller) {
        result.set(branch, session.controller);
      }
    }
    return result;
  }

  getDiscoveredPRs(): Map<string, GHPullRequest> {
    return new Map(this.discoveredPRs);
  }

  getCommentCounts(): Map<string, number> {
    return new Map(this.commentCounts);
  }

  getCommentThreads(): Map<string, ReviewThread[]> {
    return new Map(this.commentThreads);
  }

  getThreadCounts(): Map<string, ThreadCounts> {
    return new Map(this.threadCounts);
  }

  getLastStates(): Map<string, BranchState> {
    return new Map(this.lastStates);
  }

  getMergedPRs(): Map<string, { pr: GHPullRequest; mergedAt: number }> {
    return new Map(this.mergedPRs);
  }

  clearMergedPRs(): void {
    this.mergedPRs.clear();
    this.emit("prUpdate", "__merged__");
  }

  getConfig(): Config {
    return { ...this.config };
  }

  updateConfig(partial: Partial<Config>): void {
    this.config = { ...this.config, ...partial };
    logger.info(`Config updated: ${JSON.stringify(partial)}`);

    // Propagate config updates to existing sessions
    for (const [, session] of this.sessions) {
      if (session.controller) {
        session.controller.updateConfig(this.config);
      }
    }

    this.emit("configUpdate", this.config);
  }

  getCIStatuses(): Map<string, CIStatus> {
    return new Map(this.ciStatuses);
  }

  getCIFailedChecks(): Map<string, FailedCheck[]> {
    return new Map(this.ciFailedChecks);
  }

  getConflictStatuses(): Map<string, string[]> {
    return new Map(this.conflictStatuses);
  }

  private maybeNotify(title: string, message: string): void {
    if (this.cachedNotificationSettings === null) {
      const settings = loadSettings();
      this.cachedNotificationSettings = settings?.notifications ?? true;
    }
    if (this.cachedNotificationSettings) {
      notify(title, message);
    }
  }

  refreshNotificationSettings(): void {
    this.cachedNotificationSettings = null;
  }

  isRunning(branch: string): boolean {
    return this.sessions.has(branch);
  }

  async run(): Promise<void> {
    this.running = true;
    await this.progressStore.load();
    await this.worktreeManager.purgeStale();
    await this.ghClient.validateAuth();

    const user = await this.ghClient.getCurrentUser();
    this.botLogin = user;
    const { owner, repo } = await this.ghClient.getRepoInfo();
    logger.info(
      `Watching ${owner}/${repo} for open PRs by ${user}`,
    );

    while (this.running) {
      try {
        await this.discover();
      } catch (err) {
        logger.error(`Discovery failed: ${err}`);
      }
      if (!this.running) break;
      await this.cancellableSleep(this.config.pollInterval * 1000);
    }
  }

  async refreshNow(): Promise<void> {
    logger.info("Manual refresh triggered");
    await this.discover();
  }

  async startBranch(branch: string, mode: SessionMode = "once"): Promise<void> {
    if (this.sessions.has(branch)) return;
    const pr = this.discoveredPRs.get(branch);
    if (!pr) return;

    // Check concurrent session limit
    const settings = loadSettings();
    const maxConcurrentSessions = settings?.maxConcurrentSessions ?? 4;
    const activeSessions = Array.from(this.sessions.values()).filter(s => s.controller !== null).length;

    if (activeSessions >= maxConcurrentSessions) {
      logger.warn(`Cannot start session — max concurrent sessions (${maxConcurrentSessions}) reached`, branch);
      const lifetime = this.progressStore.getLifetimeStats(branch);
      const totalCostUsd = lifetime.cycleHistory.reduce((sum, cycle) => sum + cycle.costUsd, 0);
      const totalInputTokens = lifetime.cycleHistory.reduce((sum, cycle) => sum + (cycle.inputTokens ?? 0), 0);
      const totalOutputTokens = lifetime.cycleHistory.reduce((sum, cycle) => sum + (cycle.outputTokens ?? 0), 0);
      this.lastStates.set(branch, {
        branch,
        prNumber: pr.number,
        prUrl: pr.url,
        status: "error",
        mode,
        commentsAddressed: 0,
        totalCostUsd,
        error: `Cannot start session — max concurrent sessions (${maxConcurrentSessions}) reached`,
        unresolvedCount: 0,
        commentSummary: null,
        lastPushAt: null,
        claudeActivity: [],
        lastSessionId: null,
        workDir: null,
        sessionExpiresAt: null,
        ...lifetime,
        totalInputTokens,
        totalOutputTokens,
        ciStatus: "unknown",
        failedChecks: [],
        ciFixAttempts: 0,
        conflicted: [],
        hasFixupCommits: false,
      });
      this.emit("prUpdate", branch);
      return;
    }

    this.setOptimisticStatus(branch, "initializing", mode);

    // Refuse to run on the branch that's currently checked out
    const currentBranch = await this.getCurrentBranch();
    if (currentBranch === branch) {
      logger.warn("Cannot start session — branch is checked out locally. Switch to main first.", branch);
      const lifetime = this.progressStore.getLifetimeStats(branch);
      const totalCostUsd = lifetime.cycleHistory.reduce((sum, cycle) => sum + cycle.costUsd, 0);
      const totalInputTokens = lifetime.cycleHistory.reduce((sum, cycle) => sum + (cycle.inputTokens ?? 0), 0);
      const totalOutputTokens = lifetime.cycleHistory.reduce((sum, cycle) => sum + (cycle.outputTokens ?? 0), 0);
      this.lastStates.set(branch, {
        branch,
        prNumber: pr.number,
        prUrl: pr.url,
        status: "error",
        mode,
        commentsAddressed: 0,
        totalCostUsd,
        totalInputTokens,
        totalOutputTokens,
        error: "Branch is checked out locally — switch to main first",
        unresolvedCount: 0,
        commentSummary: null,
        lastPushAt: null,
        claudeActivity: [],
        lastSessionId: null,
        workDir: null,
        sessionExpiresAt: null,
        ...lifetime,
        ciStatus: "unknown",
        failedChecks: [],
        ciFixAttempts: 0,
        conflicted: [],
        hasFixupCommits: false,
      });
      this.emit("prUpdate", branch);
      return;
    }

    // Clean up any worktree left from a previous errored session
    await this.worktreeManager.remove(branch);

    this.lastStates.delete(branch);
    await this.launchSession(pr, mode);
  }

  async stopBranch(branch: string): Promise<void> {
    this.setOptimisticStatus(branch, "stopped");
    await this.teardownSession(branch);
    // Cleanup saves the controller's final state (often "error" from abort),
    // so force it back to "stopped"
    const lastState = this.lastStates.get(branch);
    if (lastState && lastState.status !== "stopped") {
      lastState.status = "stopped";
      lastState.error = null;
    }
    if (this.discoveredPRs.has(branch)) {
      this.emit("prUpdate", branch);
    }
  }

  async startAll(mode: SessionMode = "once"): Promise<void> {
    for (const [branch] of this.discoveredPRs) {
      if (!this.sessions.has(branch)) {
        await this.startBranch(branch, mode);
      }
    }
  }

  async watchBranch(branch: string): Promise<void> {
    await this.startBranch(branch, "watch");
  }

  async watchAll(): Promise<void> {
    await this.startAll("watch");
  }

  async rebaseBranch(branch: string): Promise<void> {
    if (this.sessions.has(branch)) return;
    const pr = this.discoveredPRs.get(branch);
    if (!pr) return;

    this.setOptimisticStatus(branch, "initializing");

    const currentBranch = await this.getCurrentBranch();
    if (currentBranch === branch) {
      logger.warn("Cannot rebase — branch is checked out locally. Switch to main first.", branch);
      this.lastStates.set(branch, this.makeErrorState(branch, pr, "Cannot rebase — branch is checked out locally. Switch to main first.", "once"));
      this.emit("prUpdate", branch);
      return;
    }

    await this.worktreeManager.remove(branch);
    this.lastStates.delete(branch);

    let workDir: string;
    try {
      workDir = await this.worktreeManager.create(branch);
    } catch (err) {
      logger.error(`Failed to create worktree for ${branch}: ${err}`);
      this.lastStates.set(branch, this.makeErrorState(branch, pr, `Failed to create worktree: ${err}`, "once"));
      this.emit("prUpdate", branch);
      return;
    }

    const controller = new SessionController(branch, this.config, workDir, "once", this.progressStore);

    controller.on("statusChange", (b: string, status: string) => {
      logger.info(`Status: ${status}`, b);
      this.emit("sessionUpdate", b, controller.getState());
    });

    controller.on("pushed", (b: string) => {
      this.syncMainRepo(b).catch((err) => {
        logger.debug(`Main repo sync failed for ${b}: ${err}`);
      });
    });

    controller.on("ready", (b: string) => {
      logger.info("Rebase session finished.", b);
      const state = controller.getState();
      if (state.status === "error") {
        // Keep the worktree alive for manual intervention
        this.lastStates.set(b, state);
        this.sessions.delete(b);
        this.emit("prUpdate", b);
      } else {
        this.cleanupSession(b).catch((err) => {
          logger.warn(`Cleanup failed for ${b}: ${err}`);
        });
      }
    });

    const promise = controller.startRebase();
    this.sessions.set(branch, { controller, promise });
    this.emit("sessionUpdate", branch, controller.getState());
  }

  /** Plain git rebase — no Claude. Reports conflicts without resolving them. */
  async rebaseBranchPlain(branch: string): Promise<void> {
    if (this.sessions.has(branch)) return;
    const pr = this.discoveredPRs.get(branch);
    if (!pr) return;

    this.setOptimisticStatus(branch, "initializing");

    const currentBranch = await this.getCurrentBranch();
    if (currentBranch === branch) {
      logger.warn("Cannot rebase — branch is checked out locally. Switch to main first.", branch);
      this.lastStates.set(branch, this.makeErrorState(branch, pr, "Cannot rebase — branch is checked out locally. Switch to main first.", "once"));
      this.emit("prUpdate", branch);
      return;
    }

    await this.worktreeManager.remove(branch);

    let workDir: string;
    try {
      workDir = await this.worktreeManager.create(branch);
    } catch (err) {
      logger.error(`Failed to create worktree for ${branch}: ${err}`);
      this.lastStates.set(branch, this.makeErrorState(branch, pr, `Failed to create worktree: ${err}`, "once"));
      this.emit("prUpdate", branch);
      return;
    }

    // Register a placeholder session to prevent concurrent operations
    const placeholderPromise = (async () => {
      try {
        const gitManager = new GitManager(workDir, branch);
        logger.info(`Plain rebase of ${branch} onto ${pr.baseRefName}`, branch);
        const ok = await gitManager.pullRebase(pr.baseRefName);
        if (!ok) {
          logger.warn("Rebase has conflicts — use R to rebase with Claude", branch);
          // Temporarily remove session to allow conflict status update
          const session = this.sessions.get(branch);
          this.sessions.delete(branch);
          // Refresh conflict status so TUI shows them
          await this.updateConflictStatuses([pr]);
          // Restore session
          if (session) this.sessions.set(branch, session);
          this.emit("conflictStatusUpdate", branch);
          return;
        }

        const pushed = await gitManager.forcePushWithLease();
        if (pushed) {
          logger.info("Rebase complete, pushed", branch);
          this.syncMainRepo(branch).catch(() => {});
        } else {
          logger.error("Push failed after rebase", branch);
        }
      } catch (err) {
        logger.error(`Plain rebase failed: ${err}`, branch);
      } finally {
        await this.worktreeManager.remove(branch).catch(() => {});
        this.setOptimisticStatus(branch, "stopped");
        this.sessions.delete(branch);
      }
    })();

    this.sessions.set(branch, { controller: null, promise: placeholderPromise });
    await placeholderPromise;
  }

  resolveConflicts(branch: string, always: boolean): void {
    const session = this.sessions.get(branch);
    if (session) {
      session.controller?.acceptConflictResolution(always);
    }
  }

  dismissConflictResolution(branch: string): void {
    const session = this.sessions.get(branch);
    if (session) {
      session.controller?.dismissConflictResolution();
    }
  }

  async stopAll(): Promise<void> {
    for (const branch of [...this.sessions.keys()]) {
      await this.stopBranch(branch);
    }
  }

  private cancellableSleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const signal = this.abortController.signal;
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    this.abortController.abort();
    logger.info("Shutting down daemon...");
    const branches = [...this.sessions.keys()];
    for (const branch of branches) {
      await this.teardownSession(branch);
    }
    await this.worktreeManager.cleanup();
  }

  private async discover(): Promise<void> {
    let prs: GHPullRequest[];
    try {
      prs = await this.ghClient.getMyOpenPRs();
    } catch (err) {
      if (err instanceof RateLimitError) {
        logger.warn("GitHub rate limit hit during discovery, skipping this cycle");
      } else {
        logger.warn(`Failed to discover PRs: ${err}`);
      }
      return;
    }

    const activeBranches = new Set(prs.map((pr) => pr.headRefName));

    if (prs.length === 0 && this.discoveredPRs.size === 0) {
      logger.info("No open PRs found, waiting...");
    }

    for (const pr of prs) {
      if (!this.discoveredPRs.has(pr.headRefName)) {
        logger.info(`Discovered PR #${pr.number}: ${pr.title}`, pr.headRefName);
        this.discoveredPRs.set(pr.headRefName, pr);
        // Remove any stale merged entry for this branch to prevent conflicts
        this.mergedPRs.delete(pr.headRefName);
        this.emit("prDiscovered", pr.headRefName, pr);
        // Only notify for newly discovered PRs after initial discovery to avoid flooding
        if (!this.isInitialDiscovery) {
          this.maybeNotify("New PR Discovered", `Found pull request #${pr.number}: ${pr.title}`);
        }
      }
    }

    // Mark that initial discovery is complete
    this.isInitialDiscovery = false;

    // Extract CI statuses from PR data (no extra API calls)
    this.updateCIStatusesFromPRs(prs);

    // Fetch comment counts and conflict statuses in parallel
    await Promise.all([
      this.updateCommentCounts(prs),
      this.updateConflictStatuses(prs),
    ]);

    // Handle PRs that are no longer open (closed or merged) before checking ready statuses,
    // so merged PRs are removed from discoveredPRs and don't briefly flicker to "ready"
    for (const branch of [...this.discoveredPRs.keys()]) {
      if (!activeBranches.has(branch)) {
        const pr = this.discoveredPRs.get(branch)!;

        let wasMerged = false;
        try {
          wasMerged = await this.ghClient.isPRMerged(pr.number);
        } catch {
          // If we can't determine, treat as closed
        }

        if (wasMerged) {
          logger.info(`PR #${pr.number} merged`, branch);
          this.mergedPRs.set(branch, { pr, mergedAt: Date.now() });
          this.maybeNotify("PR Merged", `Pull request #${pr.number} (${pr.title}) has been merged!`);
        }

        // Now remove from discovered PRs and clean up
        this.discoveredPRs.delete(branch);
        this.commentCounts.delete(branch);
        this.commentThreads.delete(branch);
        this.threadCounts.delete(branch);
        this.ciStatuses.delete(branch);
        this.ciFailedChecks.delete(branch);
        this.conflictStatuses.delete(branch);
        try {
          await this.teardownSession(branch);
        } catch (err) {
          logger.warn(`Failed to teardown session for ${branch}: ${err}`);
        }

        // Emit appropriate event
        if (wasMerged) {
          this.emit("prMerged", branch);
        } else {
          logger.info(`PR closed, removing`, branch);
          this.emit("prRemoved", branch);
        }
      }
    }

    // Check ready statuses after merged PRs have been removed from discoveredPRs
    this.updateReadyStatuses();
  }

  private async updateCommentCounts(prs: GHPullRequest[]): Promise<void> {
    if (!this.botLogin) return;

    await mapWithConcurrency(prs, 3, async (pr) => {
      try {
        const fetcher = new CommentFetcher(
          this.ghClient, pr.number, this.botLogin!, pr.headRefName,
        );
        const { comments: fetched, threadCounts } = await fetcher.fetchWithCounts();
        const count = fetched.length;
        const prev = this.commentCounts.get(pr.headRefName) ?? -1;
        this.commentCounts.set(pr.headRefName, count);
        this.threadCounts.set(pr.headRefName, threadCounts);
        this.commentThreads.set(
          pr.headRefName,
          fetched.map((f) => f.thread),
        );

        if (count !== prev) {
          this.emit("commentCountUpdate", pr.headRefName, count);
        }
      } catch (err) {
        if (err instanceof RateLimitError) {
          logger.warn("GitHub rate limit hit while fetching comments, stopping comment updates");
          throw err;
        }
        logger.debug(`Failed to fetch comments for ${pr.headRefName}: ${err}`);
      }
    }).catch((err) => {
      if (err instanceof RateLimitError) return;
      throw err;
    });
  }

  private async launchSession(pr: GHPullRequest, mode: SessionMode = "once"): Promise<void> {
    const branch = pr.headRefName;

    if (this.config.dryRun) {
      logger.info(
        `[DRY RUN] Would start watching PR #${pr.number}`,
        branch,
      );
      return;
    }

    let workDir: string;
    try {
      workDir = await this.worktreeManager.create(branch);
    } catch (err) {
      logger.error(`Failed to create worktree for ${branch}: ${err}`);
      const lifetime = this.progressStore.getLifetimeStats(branch);
      const totalCostUsd = lifetime.cycleHistory.reduce((sum, cycle) => sum + cycle.costUsd, 0);
      const totalInputTokens = lifetime.cycleHistory.reduce((sum, cycle) => sum + (cycle.inputTokens ?? 0), 0);
      const totalOutputTokens = lifetime.cycleHistory.reduce((sum, cycle) => sum + (cycle.outputTokens ?? 0), 0);
      this.lastStates.set(branch, {
        branch,
        prNumber: pr.number,
        prUrl: pr.url,
        status: "error",
        mode,
        commentsAddressed: 0,
        totalCostUsd,
        totalInputTokens,
        totalOutputTokens,
        error: `Failed to create worktree: ${err}`,
        unresolvedCount: 0,
        commentSummary: null,
        lastPushAt: null,
        claudeActivity: [],
        lastSessionId: null,
        workDir: null,
        sessionExpiresAt: null,
        ...lifetime,
        ciStatus: "unknown",
        failedChecks: [],
        ciFixAttempts: 0,
        conflicted: [],
        hasFixupCommits: false,
      });
      this.emit("prUpdate", branch);
      return;
    }

    const controller = new SessionController(branch, this.config, workDir, mode, this.progressStore);

    controller.on("statusChange", (b: string, status: string) => {
      logger.info(`Status: ${status}`, b);
      this.emit("sessionUpdate", b, controller.getState());
    });

    controller.on("pushed", (b: string) => {
      this.syncMainRepo(b).catch((err) => {
        logger.debug(`Main repo sync failed for ${b}: ${err}`);
      });
    });

    controller.on("ready", (b: string) => {
      logger.info("Session finished.", b);
      const state = controller.getState();
      if (state.status === "error") {
        // Keep the worktree alive for manual intervention
        this.lastStates.set(b, state);
        this.sessions.delete(b);
        this.emit("prUpdate", b);
        this.maybeNotify("Session Failed", `Session for branch ${b} failed: ${state.error || "Unknown error"}`);
      } else {
        // Notify on successful completion
        const commentsAddressed = state.commentsAddressed || 0;
        if (commentsAddressed > 0) {
          this.maybeNotify("Session Complete", `Successfully addressed ${commentsAddressed} comment(s) on ${b}`);
        } else {
          this.maybeNotify("Session Complete", `Session completed for ${b}`);
        }
        this.cleanupSession(b).catch((err) => {
          logger.warn(`Cleanup failed for ${b}: ${err}`);
        });
      }
    });

    const promise = controller.start();
    this.sessions.set(branch, { controller, promise });
    this.emit("sessionUpdate", branch, controller.getState());
  }

  private async teardownSession(branch: string): Promise<void> {
    const session = this.sessions.get(branch);
    if (!session) return;

    session.controller?.stop();
    await session.promise.catch(() => {});
    await this.cleanupSession(branch);
  }

  private async cleanupSession(branch: string): Promise<void> {
    const session = this.sessions.get(branch);
    if (session) {
      if (session.controller) {
        this.lastStates.set(branch, session.controller.getState());
      }
    }
    this.sessions.delete(branch);
    await this.worktreeManager.remove(branch);

    // Check if this branch is now ready to merge
    this.updateReadyStatuses();

    if (this.discoveredPRs.has(branch)) {
      this.emit("prUpdate", branch);
    } else {
      this.emit("prRemoved", branch);
    }
  }

  private setOptimisticStatus(branch: string, status: BranchStatus, mode: SessionMode = "once"): void {
    const pr = this.discoveredPRs.get(branch);
    if (!pr) return;
    const lifetime = this.progressStore.getLifetimeStats(branch);
    const totalCostUsd = lifetime.cycleHistory.reduce((sum, c) => sum + c.costUsd, 0);
    const totalInputTokens = lifetime.cycleHistory.reduce((sum, c) => sum + (c.inputTokens ?? 0), 0);
    const totalOutputTokens = lifetime.cycleHistory.reduce((sum, c) => sum + (c.outputTokens ?? 0), 0);
    const prev = this.lastStates.get(branch);
    this.lastStates.set(branch, {
      branch,
      prNumber: pr.number,
      prUrl: pr.url,
      status,
      mode,
      commentsAddressed: prev?.commentsAddressed ?? 0,
      totalCostUsd,
      totalInputTokens,
      totalOutputTokens,
      error: null,
      unresolvedCount: prev?.unresolvedCount ?? 0,
      commentSummary: prev?.commentSummary ?? null,
      lastPushAt: prev?.lastPushAt ?? null,
      claudeActivity: [],
      lastSessionId: prev?.lastSessionId ?? null,
      workDir: prev?.workDir ?? null,
      ...lifetime,
      ciStatus: prev?.ciStatus ?? "unknown",
      failedChecks: prev?.failedChecks ?? [],
      ciFixAttempts: prev?.ciFixAttempts ?? 0,
      conflicted: prev?.conflicted ?? [],
      hasFixupCommits: prev?.hasFixupCommits ?? false,
      sessionExpiresAt: prev?.sessionExpiresAt ?? null,
    });
    this.emit("prUpdate", branch);
  }

  private makeErrorState(branch: string, pr: GHPullRequest, error: string, mode: SessionMode = "once"): BranchState {
    const lifetime = this.progressStore.getLifetimeStats(branch);
    const totalCostUsd = lifetime.cycleHistory.reduce((sum, c) => sum + c.costUsd, 0);
    const totalInputTokens = lifetime.cycleHistory.reduce((sum, c) => sum + (c.inputTokens ?? 0), 0);
    const totalOutputTokens = lifetime.cycleHistory.reduce((sum, c) => sum + (c.outputTokens ?? 0), 0);
    return {
      branch,
      prNumber: pr.number,
      prUrl: pr.url,
      status: "error",
      mode,
      commentsAddressed: 0,
      totalCostUsd,
      totalInputTokens,
      totalOutputTokens,
      error,
      unresolvedCount: 0,
      commentSummary: null,
      lastPushAt: null,
      claudeActivity: [],
      lastSessionId: null,
      workDir: this.cwd,
      ...lifetime,
      ciStatus: "unknown",
      failedChecks: [],
      ciFixAttempts: 0,
      conflicted: [],
      hasFixupCommits: false,
      sessionExpiresAt: null,
    };
  }

  private async getCurrentBranch(): Promise<string | null> {
    try {
      const { stdout } = await exec("git", ["branch", "--show-current"], { cwd: this.cwd });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  /** Extract CI check statuses from PR data (embedded in the discovery query). */
  private updateCIStatusesFromPRs(prs: GHPullRequest[]): void {
    for (const pr of prs) {
      const commitNode = pr.commits?.nodes?.[0];
      const rollup = commitNode?.commit?.statusCheckRollup;
      if (!rollup) {
        this.updateCIStatus(pr.headRefName, "unknown", []);
        continue;
      }

      const checks = rollup.contexts.nodes.filter((n) => n.name);
      if (checks.length === 0) {
        this.updateCIStatus(pr.headRefName, "unknown", []);
        continue;
      }

      const allCompleted = checks.every((c) => c.status?.toUpperCase() === "COMPLETED");
      if (!allCompleted) {
        this.updateCIStatus(pr.headRefName, "pending", []);
        continue;
      }

      const passing = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
      const failed = checks.filter((c) => !passing.has(c.conclusion?.toUpperCase() ?? ""));
      if (failed.length === 0) {
        this.updateCIStatus(pr.headRefName, "passing", []);
      } else {
        const failedChecks: FailedCheck[] = failed.map((c) => ({
          id: c.databaseId ?? 0,
          name: c.name!,
          htmlUrl: c.detailsUrl ?? "",
          logSnippet: null,
        }));
        this.updateCIStatus(pr.headRefName, "failing", failedChecks);
      }
    }

  }

  private updateCIStatus(branch: string, status: CIStatus, failedChecks: FailedCheck[]): void {
    const prev = this.ciStatuses.get(branch);

    this.ciStatuses.set(branch, status);
    this.ciFailedChecks.set(branch, failedChecks);
    if (status !== prev) {
      this.emit("ciStatusUpdate", branch, status, failedChecks);
    }
  }

  /** Set status to "ready" for branches with CI passing and 0 unresolved comments. */
  private updateReadyStatuses(): void {
    for (const [branch] of this.discoveredPRs) {
      if (this.sessions.has(branch)) continue;

      const ci = this.ciStatuses.get(branch);
      if (ci !== "passing") continue;

      const unresolvedCount = this.commentCounts.get(branch) ?? 0;
      if (unresolvedCount > 0) continue;

      const lastState = this.lastStates.get(branch);
      const currentStatus = lastState?.status;
      if (currentStatus !== "stopped" && currentStatus !== "watching") continue;

      lastState!.status = "ready";
      this.emit("prUpdate", branch);
    }
  }

  /** Detect merge conflicts with base branch for all discovered PRs not actively running. */
  private async updateConflictStatuses(prs: GHPullRequest[]): Promise<void> {
    const activePRs = prs.filter(pr => !this.sessions.has(pr.headRefName));
    if (activePRs.length === 0) return;

    // Batch unique refs to fetch only once to prevent git lock contention
    const allRefs = new Set<string>();
    for (const pr of activePRs) {
      allRefs.add(pr.baseRefName);
      allRefs.add(pr.headRefName);
    }

    // Perform a single fetch operation for all refs
    try {
      await exec("git", ["fetch", "origin", ...Array.from(allRefs)], {
        cwd: this.cwd,
        allowFailure: true,
      });
    } catch (err) {
      logger.debug(`Failed to fetch refs: ${err}`);
    }

    // Now check conflicts for each PR sequentially
    await Promise.all(activePRs.map(async (pr) => {
      try {
        const { stdout, exitCode } = await exec("git", [
          "merge-tree", "--write-tree", `origin/${pr.headRefName}`, `origin/${pr.baseRefName}`,
        ], { cwd: this.cwd, allowFailure: true });

        const conflictPaths: string[] = [];
        if (exitCode !== 0) {
          for (const line of stdout.split("\n")) {
            const match = line.match(/^CONFLICT \([^)]+\): Merge conflict in (.+)$/);
            if (match) {
              conflictPaths.push(match[1]);
            }
          }
          if (conflictPaths.length === 0) {
            conflictPaths.push("(unknown)");
          }
        }

        const prev = this.conflictStatuses.get(pr.headRefName);
        this.conflictStatuses.set(pr.headRefName, conflictPaths);
        const changed = !prev || prev.length !== conflictPaths.length ||
          prev.some((p, i) => p !== conflictPaths[i]);
        if (changed) {
          this.emit("conflictStatusUpdate", pr.headRefName, conflictPaths);
        }
      } catch (err) {
        logger.debug(`Failed to check conflicts for ${pr.headRefName}: ${err}`);
      }
    }));
  }

  /** Fetch the pushed branch and update the local ref so git log stays current. */
  private async syncMainRepo(branch: string): Promise<void> {
    await exec("git", ["fetch", "origin", branch], { cwd: this.cwd });

    // Update the local branch ref to match the remote
    // (safe because we block starting sessions for the checked-out branch)
    await exec("git", ["branch", "-f", branch, `origin/${branch}`], {
      cwd: this.cwd,
      allowFailure: true,
    });

    logger.info("Synced local branch ref with remote", branch);

    // Push implies conflicts are resolved — clear stale status immediately
    const prev = this.conflictStatuses.get(branch);
    if (prev && prev.length > 0) {
      this.conflictStatuses.set(branch, []);
      this.emit("conflictStatusUpdate", branch, []);
    }
  }
}
