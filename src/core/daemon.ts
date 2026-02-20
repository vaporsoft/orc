/**
 * Always-on daemon that discovers open PRs authored by the current user,
 * spins up SessionControllers for each, and cleans up when PRs close/merge.
 */

import { EventEmitter } from "node:events";
import { SessionController } from "./session-controller.js";
import { WorktreeManager } from "./worktree-manager.js";
import { GHClient } from "../github/gh-client.js";
import type { Config } from "../types/config.js";
import type { GHPullRequest } from "../github/types.js";
import { logger } from "../utils/logger.js";
import { sleep } from "../utils/retry.js";
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
  private running = false;
  /** Branch currently checked out in cwd — used instead of a worktree. */
  private cwdBranch: string | null = null;

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

  async run(): Promise<void> {
    this.running = true;
    await this.ghClient.validateAuth();

    const user = await this.ghClient.getCurrentUser();
    const { owner, repo } = await this.ghClient.getRepoInfo();
    logger.info(
      `Watching ${owner}/${repo} for open PRs by ${user}`,
    );

    // Detect the branch checked out in cwd so we can reuse it
    const { stdout } = await exec("git", ["branch", "--show-current"], {
      cwd: this.cwd,
    });
    const currentBranch = stdout.trim();

    while (this.running) {
      await this.discover(currentBranch);
      if (!this.running) break;
      await sleep(this.config.pollInterval * 1000);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    logger.info("Shutting down daemon...");
    const branches = [...this.sessions.keys()];
    for (const branch of branches) {
      await this.stopSession(branch);
    }
    await this.worktreeManager.cleanup();
  }

  private async discover(currentBranch: string): Promise<void> {
    let prs: GHPullRequest[];
    try {
      prs = await this.ghClient.getMyOpenPRs();
    } catch (err) {
      logger.warn(`Failed to discover PRs: ${err}`);
      return;
    }

    const activeBranches = new Set(prs.map((pr) => pr.headRefName));

    if (prs.length === 0 && this.sessions.size === 0) {
      logger.info("No open PRs found, waiting...");
    }

    // Start controllers for new PRs
    for (const pr of prs) {
      if (!this.sessions.has(pr.headRefName)) {
        await this.startSession(pr, currentBranch);
      }
    }

    // Stop controllers for closed/merged PRs
    for (const branch of this.sessions.keys()) {
      if (!activeBranches.has(branch)) {
        logger.info(`PR closed/merged, stopping`, branch);
        await this.stopSession(branch);
      }
    }
  }

  private async startSession(
    pr: GHPullRequest,
    currentBranch: string,
  ): Promise<void> {
    const branch = pr.headRefName;
    logger.info(`Discovered PR #${pr.number}: ${pr.title}`, branch);

    if (this.config.dryRun) {
      logger.info(
        `[DRY RUN] Would start watching PR #${pr.number}`,
        branch,
      );
      return;
    }

    let workDir: string;

    // Reuse cwd if the PR branch matches what's checked out
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
    this.emit("sessionAdded", branch, controller.getState());
  }

  private async stopSession(branch: string): Promise<void> {
    const session = this.sessions.get(branch);
    if (!session) return;

    session.controller.stop();
    await session.promise.catch(() => {});
    await this.cleanupSession(branch);
  }

  private async cleanupSession(branch: string): Promise<void> {
    this.sessions.delete(branch);
    this.emit("sessionRemoved", branch);

    if (branch === this.cwdBranch) {
      this.cwdBranch = null;
    } else {
      await this.worktreeManager.remove(branch);
    }
  }
}
