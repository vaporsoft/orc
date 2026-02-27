/**
 * Always-on daemon that discovers open PRs authored by the current user.
 * PRs are discovered but not auto-started — the TUI controls which to run.
 * Also fetches unresolved comment counts for the TUI badge.
 */

import { EventEmitter } from "node:events";
import { SessionController } from "./session-controller.js";
import { CommentFetcher, type ThreadCounts } from "./comment-fetcher.js";
import { WorktreeManager } from "./worktree-manager.js";
import { ProgressStore } from "./progress-store.js";
import { GHClient } from "../github/gh-client.js";
import type { Config } from "../types/config.js";
import type { BranchState, BranchStatus, CIStatus, FailedCheck, ReviewThread, SessionMode, SessionScope } from "../types/index.js";
import type { GHPullRequest } from "../github/types.js";
import { logger } from "../utils/logger.js";
import { exec } from "../utils/process.js";
import { mapWithConcurrency } from "../utils/concurrency.js";
import { GitLock } from "./git-lock.js";
import { RateLimitError } from "../utils/retry.js";
import { loadSettings } from "../utils/settings.js";
import { notify } from "../utils/notify.js";
import { loadRepoConfig } from "./repo-config.js";

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
  private externalBranches = new Set<string>(); // Branches added via addExternalBranch (not authored by current user)
  private ciStatuses = new Map<string, CIStatus>();
  private ciFailedChecks = new Map<string, FailedCheck[]>();
  private conflictStatuses = new Map<string, string[]>();
  private conflictTreeHashes = new Map<string, string>();
  private reviewStates = new Map<string, { state: "approved" | "changes_requested" | "pending" | "unknown"; reviewers: string[] }>();
  /** Tracks resolved threads with ORC replies per branch for deleted-reply detection. */
  private orcResolvedThreads = new Map<string, Set<string>>();
  /** Guards against concurrent startBranch calls for the same branch (TOCTOU race). */
  private launching = new Set<string>();
  private running = false;
  private abortController = new AbortController();
  private botLogin: string | null = null;
  private defaultBranch: string = "main";
  private cachedNotificationSettings: boolean | null = null;
  private isInitialDiscovery = true;
  private nextCheckAt: number | null = null;
  private skipNextSleep = false;
  private gitLock: GitLock;

  constructor(config: Config, cwd: string) {
    super();
    this.config = config;
    this.cwd = cwd;
    this.ghClient = new GHClient(cwd);
    this.gitLock = new GitLock();
    this.worktreeManager = new WorktreeManager(cwd, this.gitLock);
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

  hasCompletedInitialDiscovery(): boolean {
    return !this.isInitialDiscovery;
  }

  getNextCheckAt(): number | null {
    return this.nextCheckAt;
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

  getCwd(): string {
    return this.cwd;
  }

  getDefaultBranch(): string {
    return this.defaultBranch;
  }

  getReviewStates(): Map<string, { state: "approved" | "changes_requested" | "pending" | "unknown"; reviewers: string[] }> {
    return new Map(this.reviewStates);
  }

  async getConflictContent(branch: string, filePath: string): Promise<string | null> {
    const treeHash = this.conflictTreeHashes.get(branch);
    if (!treeHash) return null;
    try {
      const { stdout } = await exec("git", [
        "-c", "gc.auto=0", "show", `${treeHash}:${filePath}`,
      ], { cwd: this.cwd, allowFailure: true });
      return stdout || null;
    } catch {
      return null;
    }
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

  getGHClient(): GHClient {
    return this.ghClient;
  }

  /** Add a branch (by PR) that wasn't authored by the current user. */
  async addExternalBranch(pr: GHPullRequest): Promise<void> {
    const branch = pr.headRefName;
    if (this.discoveredPRs.has(branch)) {
      logger.info(`Branch ${branch} already tracked`, branch);
      return;
    }

    logger.info(`Manually added PR #${pr.number}: ${pr.title}`, branch);
    this.discoveredPRs.set(branch, pr);
    this.externalBranches.add(branch); // Track as external so discover() won't remove it
    this.mergedPRs.delete(branch);
    this.emit("prDiscovered", branch, pr);

    // Fetch initial data for the new branch
    this.updateCIStatusesFromPRs([pr]);
    this.updateReviewStatesFromPRs([pr]);
    await Promise.all([
      this.updateCommentCounts([pr]),
      this.updateConflictStatuses([pr]),
    ]);
  }

  async run(): Promise<void> {
    this.running = true;
    await this.progressStore.load();
    // Purge stale worktrees in the background — don't block startup.
    // The git lock queue ensures this won't conflict with session worktree operations.
    this.worktreeManager.purgeStale().catch((err) => {
      logger.warn(`Failed to purge stale worktrees: ${err}`);
    });
    await this.ghClient.validateAuth();

    const user = await this.ghClient.getCurrentUser();
    this.botLogin = user;
    const { owner, repo, defaultBranch } = await this.ghClient.getRepoInfo();
    this.defaultBranch = defaultBranch;
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
      // Skip sleep if refreshNow() was called (during or before discover)
      if (this.skipNextSleep) {
        this.skipNextSleep = false;
      } else {
        this.nextCheckAt = Date.now() + this.config.pollInterval * 1000;
        this.emit("discoveryComplete");
        await this.cancellableSleep(this.config.pollInterval * 1000);
      }
    }
  }

  async refreshNow(): Promise<void> {
    logger.info("Manual refresh triggered");
    // Don't call discover() here — just wake the main loop and let it call discover().
    // This avoids redundant API calls when refreshNow() is called during sleep.
    this.skipNextSleep = true;
    this.abortController.abort();
    this.abortController = new AbortController();
  }

  async startBranch(branch: string, mode: SessionMode = "once", scope: SessionScope = "all"): Promise<void> {
    if (this.sessions.has(branch) || this.launching.has(branch)) return;
    const pr = this.discoveredPRs.get(branch);
    if (!pr) return;
    this.launching.add(branch);
    try {

    // Check concurrent session limit
    const settings = loadSettings();
    const maxConcurrentSessions = settings?.maxConcurrentSessions ?? 10;
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
    await this.launchSession(pr, mode, scope);

    } finally {
      this.launching.delete(branch);
    }
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

  async startAll(mode: SessionMode = "once", scope: SessionScope = "all"): Promise<void> {
    await this.stopAll();
    const branches = Array.from(this.discoveredPRs.keys());
    const settings = loadSettings();
    const rawMax = settings?.maxConcurrentSessions ?? 10;
    // Ensure valid concurrency: must be a positive integer
    const maxConcurrentSessions = Number.isFinite(rawMax) && rawMax >= 1 ? Math.floor(rawMax) : 10;
    await mapWithConcurrency(branches, maxConcurrentSessions, (branch) => this.startBranch(branch, mode, scope));
  }

  async watchBranch(branch: string): Promise<void> {
    await this.startBranch(branch, "watch");
  }

  async watchAll(): Promise<void> {
    await this.startAll("watch");
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
        // No notification for new PR discovery — we only notify on actionable state changes
      }
    }

    // Mark that initial discovery is complete
    if (this.isInitialDiscovery) {
      this.isInitialDiscovery = false;
      this.emit("initialDiscoveryComplete");
    }

    // Extract CI statuses and review states from PR data (no extra API calls)
    this.updateCIStatusesFromPRs(prs);
    this.updateReviewStatesFromPRs(prs);

    // Fetch comment counts and conflict statuses in parallel
    await Promise.all([
      this.updateCommentCounts(prs),
      this.updateConflictStatuses(prs),
    ]);

    // Handle PRs that are no longer open (closed or merged) before checking ready statuses,
    // so merged PRs are removed from discoveredPRs and don't briefly flicker to "ready"
    for (const branch of [...this.discoveredPRs.keys()]) {
      // External branches aren't returned by getMyOpenPRs(), so check them separately
      const isExternal = this.externalBranches.has(branch);
      const notInMyPRs = !activeBranches.has(branch);

      // For user's own PRs, removal from activeBranches means closed/merged
      // For external branches, we need to explicitly check if they're still open
      if (isExternal || notInMyPRs) {
        const pr = this.discoveredPRs.get(branch)!;

        // For external branches, check if PR is still open (state != CLOSED/MERGED)
        // For user's own PRs not in activeBranches, we know they're closed/merged
        let stillOpen = false;
        if (isExternal) {
          try {
            const prInfo = await this.ghClient.findPRForBranch(branch);
            stillOpen = prInfo !== null && prInfo.state === "OPEN";
          } catch {
            // If we can't determine, assume still open to avoid accidental removal
            stillOpen = true;
          }
        }

        // Skip if external branch is still open
        if (isExternal && stillOpen) continue;

        let wasMerged = false;
        try {
          wasMerged = await this.ghClient.isPRMerged(pr.number);
        } catch {
          // If we can't determine, treat as closed
        }

        if (wasMerged) {
          logger.info(`PR #${pr.number} merged`, branch);
          this.mergedPRs.set(branch, { pr, mergedAt: Date.now() });
        }

        // Now remove from discovered PRs and clean up
        this.discoveredPRs.delete(branch);
        this.externalBranches.delete(branch);
        this.commentCounts.delete(branch);
        this.commentThreads.delete(branch);
        this.threadCounts.delete(branch);
        this.orcResolvedThreads.delete(branch);
        this.ciStatuses.delete(branch);
        this.ciFailedChecks.delete(branch);
        this.conflictStatuses.delete(branch);
        this.conflictTreeHashes.delete(branch);
        this.reviewStates.delete(branch);
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
        const {
          comments: fetched,
          threadCounts,
          orcRepliedResolvedThreadIds,
          resolvedNoOrcReplyThreadIds,
          followUpResolvedThreadIds,
        } = await fetcher.fetchWithCounts();

        // Detect deleted ORC replies: threads that were previously resolved with
        // an ORC reply but are now resolved without one → unresolve them so the
        // TUI shows them as needing attention again.
        const prevOrcResolved = this.orcResolvedThreads.get(pr.headRefName);
        const failedUnresolveThreadIds: string[] = [];
        let unresolvedCount = 0;
        if (prevOrcResolved) {
          const resolvedNoOrcReply = new Set(resolvedNoOrcReplyThreadIds);
          for (const threadId of prevOrcResolved) {
            if (resolvedNoOrcReply.has(threadId)) {
              try {
                await this.ghClient.unresolveThread(threadId);
                logger.info(`Unresolved thread ${threadId} — ORC reply was deleted`, pr.headRefName);
                unresolvedCount++;
              } catch (err) {
                logger.warn(`Failed to unresolve thread ${threadId}: ${err}`, pr.headRefName);
                failedUnresolveThreadIds.push(threadId);
              }
            }
          }
        }

        // Detect follow-up comments: resolved threads where someone replied
        // after ORC's last reply — unresolve so ORC re-processes the feedback.
        for (const threadId of followUpResolvedThreadIds) {
          try {
            await this.ghClient.unresolveThread(threadId);
            logger.info(`Unresolved thread ${threadId} — follow-up comment after ORC reply`, pr.headRefName);
            unresolvedCount++;
          } catch (err) {
            logger.warn(`Failed to unresolve thread ${threadId}: ${err}`, pr.headRefName);
            failedUnresolveThreadIds.push(threadId);
          }
        }
        // Re-fetch if we unresolved any threads so TUI shows fresh state
        let finalFetched = fetched;
        let finalThreadCounts = threadCounts;
        let finalOrcRepliedResolvedThreadIds = orcRepliedResolvedThreadIds;
        if (unresolvedCount > 0) {
          const refreshed = await fetcher.fetchWithCounts();
          finalFetched = refreshed.comments;
          finalThreadCounts = refreshed.threadCounts;
          finalOrcRepliedResolvedThreadIds = refreshed.orcRepliedResolvedThreadIds;
        }

        // Preserve failed thread IDs so unresolve can be retried on the next cycle
        const updatedOrcResolved = new Set(finalOrcRepliedResolvedThreadIds);
        for (const threadId of failedUnresolveThreadIds) {
          updatedOrcResolved.add(threadId);
        }
        this.orcResolvedThreads.set(pr.headRefName, updatedOrcResolved);

        const count = finalFetched.length;
        const prev = this.commentCounts.get(pr.headRefName) ?? -1;
        this.commentCounts.set(pr.headRefName, count);
        this.threadCounts.set(pr.headRefName, finalThreadCounts);
        this.commentThreads.set(
          pr.headRefName,
          finalFetched.map((f) => f.thread),
        );

        if (count !== prev) {
          this.emit("commentCountUpdate", pr.headRefName, count);
          // Notify when new comments appear (prev >= 0 means we've fetched before)
          if (!this.isInitialDiscovery && prev >= 0 && count > prev) {
            const delta = count - prev;
            this.maybeNotify("New Comments", `${delta} new comment${delta > 1 ? "s" : ""} on #${pr.number}`);
          }
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

  private async launchSession(pr: GHPullRequest, mode: SessionMode = "once", scope: SessionScope = "all"): Promise<void> {
    const branch = pr.headRefName;

    if (this.config.dryRun) {
      logger.info(
        `[DRY RUN] Would start watching PR #${pr.number}`,
        branch,
      );
      return;
    }

    // Load repo config early so we can pass setup commands to the lazy setup callback
    const repoConfig = await loadRepoConfig(this.cwd);

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

    const setupFn = () => this.worktreeManager.ensureSetup(branch, repoConfig.setupCommands);
    const controller = new SessionController(branch, this.config, workDir, mode, this.progressStore, this.gitLock, setupFn, scope);

    controller.on("statusChange", (b: string, status: string) => {
      logger.info(`Status: ${status}`, b);
      this.emit("sessionUpdate", b, controller.getState());
    });

    controller.on("sessionUpdate", (b: string, state: BranchState) => {
      this.emit("sessionUpdate", b, state);
    });

    controller.on("pushed", (b: string) => {
      this.syncMainRepo(b).catch((err) => {
        logger.debug(`Main repo sync failed for ${b}: ${err}`);
      });
    });

    controller.on("commentsResolved", (b: string, resolvedThreadIds: string[]) => {
      this.applyOptimisticResolution(b, resolvedThreadIds);
    });

    controller.on("ready", (b: string) => {
      logger.info("Session finished.", b);
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

    // Refresh CI status for this branch since it was skipped during active session.
    // If the session pushed, the cached PR data is stale (old commit's checks) — set
    // to "pending" so the next poll cycle picks up the new commit's checks instead of
    // flashing the old failure status.
    const lastState = this.lastStates.get(branch);
    if (lastState?.lastPushAt) {
      this.updateCIStatus(branch, "pending", []);
    } else {
      const pr = this.discoveredPRs.get(branch);
      if (pr) {
        this.updateCIStatusesFromPRs([pr]);
      }
    }

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
      const { stdout } = await exec("git", ["-c", "gc.auto=0", "branch", "--show-current"], { cwd: this.cwd });
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
      const passing = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
      const completed = checks.filter((c) => c.status?.toUpperCase() === "COMPLETED");
      const failed = completed.filter((c) => !passing.has(c.conclusion?.toUpperCase() ?? ""));

      if (failed.length > 0) {
        // Report failures immediately, even if some checks are still running
        const failedChecks: FailedCheck[] = failed.map((c) => ({
          id: c.databaseId ?? 0,
          name: c.name!,
          htmlUrl: c.detailsUrl ?? "",
          logSnippet: null,
          appSlug: null,
        }));
        this.updateCIStatus(pr.headRefName, "failing", failedChecks);
      } else if (allCompleted) {
        this.updateCIStatus(pr.headRefName, "passing", []);
      } else {
        this.updateCIStatus(pr.headRefName, "pending", []);
      }
    }

  }

  private updateReviewStatesFromPRs(prs: GHPullRequest[]): void {
    for (const pr of prs) {
      const reviews = pr.latestReviews?.nodes ?? [];
      const reviewers = reviews.map((r) => r.author.login);

      let state: "approved" | "changes_requested" | "pending" | "unknown";
      if (reviews.length === 0) {
        state = "unknown";
      } else if (reviews.some((r) => r.state === "CHANGES_REQUESTED")) {
        state = "changes_requested";
      } else if (reviews.every((r) => r.state === "APPROVED")) {
        state = "approved";
      } else {
        state = "pending";
      }

      const prev = this.reviewStates.get(pr.headRefName);
      this.reviewStates.set(pr.headRefName, { state, reviewers });
      if (prev?.state !== state) {
        this.emit("reviewStateUpdate", pr.headRefName, state);
        // Notify on approval (only after initial discovery, when state actually changes)
        if (!this.isInitialDiscovery && prev && state === "approved") {
          this.maybeNotify("PR Approved", `#${pr.number} ${pr.title}`);
        }
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

  /**
   * Optimistically update comment/thread state after a session resolves threads.
   * The next poll cycle will overwrite with real data from GitHub.
   */
  private applyOptimisticResolution(branch: string, resolvedThreadIds: string[]): void {
    if (resolvedThreadIds.length === 0) return;
    const resolvedSet = new Set(resolvedThreadIds);
    const uniqueCount = resolvedSet.size;

    // Decrease unresolved comment count
    const currentCount = this.commentCounts.get(branch) ?? 0;
    const newCount = Math.max(0, currentCount - uniqueCount);
    this.commentCounts.set(branch, newCount);

    // Bump resolved count in thread counts
    const tc = this.threadCounts.get(branch);
    if (tc) {
      this.threadCounts.set(branch, {
        resolved: Math.min(tc.total, tc.resolved + uniqueCount),
        total: tc.total,
      });
    }

    // Remove resolved threads from the unresolved thread list
    const currentThreads = this.commentThreads.get(branch);
    if (currentThreads) {
      this.commentThreads.set(
        branch,
        currentThreads.filter((t) => !resolvedSet.has(t.threadId)),
      );
    }

    // Track as ORC-resolved for deleted-reply detection on next poll
    const orcResolved = this.orcResolvedThreads.get(branch) ?? new Set();
    for (const id of resolvedThreadIds) {
      orcResolved.add(id);
    }
    this.orcResolvedThreads.set(branch, orcResolved);

    this.emit("commentCountUpdate", branch, newCount);

    // Re-check ready status since unresolved count may now be 0
    this.updateReadyStatuses();
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
    if (prs.length === 0) return;

    // Batch unique refs to fetch only once to prevent git lock contention
    const allRefs = new Set<string>();
    for (const pr of prs) {
      allRefs.add(pr.baseRefName);
      allRefs.add(pr.headRefName);
    }

    // Perform a single fetch operation for all refs — through the lock since it writes to main repo
    try {
      await this.gitLock.run(() =>
        exec("git", ["-c", "gc.auto=0", "fetch", "origin", ...Array.from(allRefs)], {
          cwd: this.cwd,
          allowFailure: true,
        }),
      );
    } catch (err) {
      logger.debug(`Failed to fetch refs: ${err}`);
    }

    // Check conflicts for each PR (merge-tree is read-only, no lock needed)
    await Promise.all(prs.map(async (pr) => {
      try {
        const { stdout, exitCode } = await exec("git", ["-c", "gc.auto=0",
          "merge-tree", "--write-tree", `origin/${pr.headRefName}`, `origin/${pr.baseRefName}`,
        ], { cwd: this.cwd, allowFailure: true });

        const conflictPaths: string[] = [];
        if (exitCode !== 0) {
          const lines = stdout.split("\n");
          // First line is the tree hash (even with conflicts)
          const treeHash = lines[0]?.trim() ?? "";
          if (treeHash) {
            this.conflictTreeHashes.set(pr.headRefName, treeHash);
          }
          for (const line of lines) {
            const match = line.match(/^CONFLICT \([^)]+\): Merge conflict in (.+)$/);
            if (match) {
              conflictPaths.push(match[1]);
            }
          }
          if (conflictPaths.length === 0) {
            conflictPaths.push("(unknown)");
          }
        } else {
          this.conflictTreeHashes.delete(pr.headRefName);
        }

        const prev = this.conflictStatuses.get(pr.headRefName);
        this.conflictStatuses.set(pr.headRefName, conflictPaths);
        const changed = !prev || prev.length !== conflictPaths.length ||
          prev.some((p, i) => p !== conflictPaths[i]);

        // Propagate to active sessions in passive states (watching/stopped)
        // so the TUI picks up daemon-polled conflict data.
        // This must happen even when `changed` is false, since conflicts may have
        // been detected while the session was in an active state (fixing/pushing).
        const session = this.sessions.get(pr.headRefName);
        if (session?.controller) {
          const state = session.controller.getState();
          if (state.status === "watching" || state.status === "stopped") {
            const controllerConflicts = state.conflicted;
            const needsSync = controllerConflicts.length !== conflictPaths.length ||
              controllerConflicts.some((p, i) => p !== conflictPaths[i]);
            if (needsSync) {
              session.controller.setConflicted(conflictPaths);
            }
          }
        }

        if (changed) {
          this.emit("conflictStatusUpdate", pr.headRefName, conflictPaths);
          // Notify when conflicts appear (not on initial discovery or when conflicts clear)
          if (!this.isInitialDiscovery && conflictPaths.length > 0 && (!prev || prev.length === 0)) {
            this.maybeNotify("Merge Conflict", `#${pr.number} has ${conflictPaths.length} conflicting file${conflictPaths.length > 1 ? "s" : ""}`);
          }
        }
      } catch (err) {
        logger.debug(`Failed to check conflicts for ${pr.headRefName}: ${err}`);
      }
    }));
  }

  /** Fetch the pushed branch and update the local ref so git log stays current. */
  private async syncMainRepo(branch: string): Promise<void> {
    await this.gitLock.run(async () => {
      await exec("git", ["-c", "gc.auto=0", "fetch", "origin", branch], { cwd: this.cwd });

      // Update the local branch ref to match the remote
      // (safe because we block starting sessions for the checked-out branch)
      await exec("git", ["-c", "gc.auto=0", "branch", "-f", branch, `origin/${branch}`], {
        cwd: this.cwd,
        allowFailure: true,
      });
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
