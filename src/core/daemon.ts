/**
 * Always-on daemon that discovers open PRs authored by the current user.
 * PRs are discovered but not auto-started — the TUI controls which to run.
 * Also fetches unresolved comment counts for the TUI badge.
 */

import { EventEmitter } from "node:events";
import { SessionController } from "./session-controller.js";
import { CommentFetcher } from "./comment-fetcher.js";
import { WorktreeManager } from "./worktree-manager.js";
import { GHClient } from "../github/gh-client.js";
import type { Config } from "../types/config.js";
import type { GHPullRequest } from "../github/types.js";
import { logger } from "../utils/logger.js";
import { exec } from "../utils/process.js";

interface ActiveSession {
  controller: SessionController;
  promise: Promise<void>;
}

export class Daemon extends EventEmitter {
  private config: Config;
  private cwd: string;
  private ghClient: GHClient;
  private worktreeManager: WorktreeManager;
  private sessions = new Map<string, ActiveSession>();
  private discoveredPRs = new Map<string, GHPullRequest>();
  private commentCounts = new Map<string, number>();
  private running = false;
  private cwdBranch: string | null = null;
  private currentBranch: string | null = null;
  private abortController = new AbortController();
  private botLogin: string | null = null;

  constructor(config: Config, cwd: string) {
    super();
    this.config = config;
    this.cwd = cwd;
    this.ghClient = new GHClient(cwd);
    this.worktreeManager = new WorktreeManager(cwd);
  }

  getSessions(): Map<string, SessionController> {
    const result = new Map<string, SessionController>();
    for (const [branch, session] of this.sessions) {
      result.set(branch, session.controller);
    }
    return result;
  }

  getDiscoveredPRs(): Map<string, GHPullRequest> {
    return new Map(this.discoveredPRs);
  }

  getCommentCounts(): Map<string, number> {
    return new Map(this.commentCounts);
  }

  isRunning(branch: string): boolean {
    return this.sessions.has(branch);
  }

  async run(): Promise<void> {
    this.running = true;
    await this.ghClient.validateAuth();

    const user = await this.ghClient.getCurrentUser();
    this.botLogin = user;
    const { owner, repo } = await this.ghClient.getRepoInfo();
    logger.info(
      `Watching ${owner}/${repo} for open PRs by ${user}`,
    );

    const { stdout } = await exec("git", ["branch", "--show-current"], {
      cwd: this.cwd,
    });
    this.currentBranch = stdout.trim();

    while (this.running) {
      await this.discover();
      if (!this.running) break;
      await this.cancellableSleep(this.config.pollInterval * 1000);
    }
  }

  async refreshNow(): Promise<void> {
    logger.info("Manual refresh triggered");
    await this.discover();
  }

  async startBranch(branch: string): Promise<void> {
    if (this.sessions.has(branch)) return;
    const pr = this.discoveredPRs.get(branch);
    if (!pr) return;
    await this.launchSession(pr);
  }

  async stopBranch(branch: string): Promise<void> {
    await this.teardownSession(branch);
    if (this.discoveredPRs.has(branch)) {
      this.emit("prUpdate", branch);
    }
  }

  async startAll(): Promise<void> {
    for (const [branch] of this.discoveredPRs) {
      if (!this.sessions.has(branch)) {
        await this.startBranch(branch);
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const branch of [...this.sessions.keys()]) {
      await this.stopBranch(branch);
    }
  }

  private cancellableSleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      this.abortController.signal.addEventListener("abort", onAbort, { once: true });
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
      logger.warn(`Failed to discover PRs: ${err}`);
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
        this.emit("prDiscovered", pr.headRefName, pr);
      }
    }

    // Fetch comment counts for all discovered PRs
    await this.updateCommentCounts(prs);

    // Remove PRs that were closed/merged
    for (const branch of [...this.discoveredPRs.keys()]) {
      if (!activeBranches.has(branch)) {
        logger.info(`PR closed/merged, removing`, branch);
        this.discoveredPRs.delete(branch);
        this.commentCounts.delete(branch);
        await this.teardownSession(branch);
        this.emit("prRemoved", branch);
      }
    }
  }

  private async updateCommentCounts(prs: GHPullRequest[]): Promise<void> {
    if (!this.botLogin) return;

    for (const pr of prs) {
      try {
        const fetcher = new CommentFetcher(
          this.ghClient, pr.number, this.botLogin, pr.headRefName,
        );
        const count = await fetcher.countUnresolved();
        const prev = this.commentCounts.get(pr.headRefName) ?? -1;
        this.commentCounts.set(pr.headRefName, count);

        if (count !== prev) {
          this.emit("commentCountUpdate", pr.headRefName, count);
        }
      } catch (err) {
        logger.debug(`Failed to count comments for ${pr.headRefName}: ${err}`);
      }
    }
  }

  private async launchSession(pr: GHPullRequest): Promise<void> {
    const branch = pr.headRefName;

    if (this.config.dryRun) {
      logger.info(
        `[DRY RUN] Would start watching PR #${pr.number}`,
        branch,
      );
      return;
    }

    const currentBranch = this.currentBranch ?? "";
    let workDir: string;

    if (branch === currentBranch && !this.cwdBranch) {
      workDir = this.cwd;
      this.cwdBranch = branch;
    } else {
      try {
        workDir = await this.worktreeManager.create(branch);
      } catch (err) {
        logger.error(`Failed to create worktree for ${branch}: ${err}`);
        return;
      }
    }

    const controller = new SessionController(branch, this.config, workDir);

    controller.on("statusChange", (b: string, status: string) => {
      logger.info(`Status: ${status}`, b);
      this.emit("sessionUpdate", b, controller.getState());
    });

    controller.on("iterationComplete", (b: string, summary: unknown) => {
      logger.info(
        `Iteration complete: ${JSON.stringify(summary)}`,
        b,
      );
      this.emit("sessionUpdate", b, controller.getState());
    });

    controller.on("done", (b: string) => {
      logger.info("Session finished.", b);
      this.cleanupSession(b).catch((err) => {
        logger.warn(`Cleanup failed for ${b}: ${err}`);
      });
    });

    const promise = controller.start();
    this.sessions.set(branch, { controller, promise });
    this.emit("sessionUpdate", branch, controller.getState());
  }

  private async teardownSession(branch: string): Promise<void> {
    const session = this.sessions.get(branch);
    if (!session) return;

    session.controller.stop();
    await session.promise.catch(() => {});
    await this.cleanupSession(branch);
  }

  private async cleanupSession(branch: string): Promise<void> {
    this.sessions.delete(branch);

    if (branch === this.cwdBranch) {
      this.cwdBranch = null;
    } else {
      await this.worktreeManager.remove(branch);
    }

    if (this.discoveredPRs.has(branch)) {
      this.emit("prUpdate", branch);
    } else {
      this.emit("prRemoved", branch);
    }
  }
}
