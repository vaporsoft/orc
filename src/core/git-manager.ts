/**
 * Handles git operations for the orchestration loop:
 * - Rebase with autosquash
 * - Force-push with lease
 * - Discard partial changes on failure
 * - Detect divergence
 */

import { exec, type ExecResult } from "../utils/process.js";
import { logger } from "../utils/logger.js";

export class GitManager {
  private cwd: string;
  private branch: string;

  constructor(cwd: string, branch: string) {
    this.cwd = cwd;
    this.branch = branch;
  }

  /** Interactive rebase with autosquash against the base branch. */
  async rebaseAutosquash(baseBranch: string): Promise<boolean> {
    logger.info(`Rebasing ${this.branch} onto ${baseBranch} with autosquash`);

    try {
      await this.git([
        "-c",
        "sequence.editor=:",
        "rebase",
        "-i",
        "--autosquash",
        baseBranch,
      ]);
      return true;
    } catch (err) {
      logger.error(`Rebase failed, aborting`, this.branch);
      await this.git(["rebase", "--abort"]).catch(() => {});
      return false;
    }
  }

  /** Force-push with lease to protect against external changes. */
  async forcePushWithLease(): Promise<boolean> {
    logger.info(`Force-pushing ${this.branch} with lease`);

    try {
      await this.git([
        "push",
        "--force-with-lease",
        "origin",
        this.branch,
      ]);
      return true;
    } catch (err) {
      logger.warn(`Push rejected, fetching and retrying`, this.branch);

      try {
        await this.git(["fetch", "origin", this.branch]);
        await this.git([
          "push",
          "--force-with-lease",
          "origin",
          this.branch,
        ]);
        return true;
      } catch {
        logger.error(`Push failed after retry`, this.branch);
        return false;
      }
    }
  }

  /** Discard all uncommitted changes (used after a failed fix). */
  async discardChanges(): Promise<void> {
    logger.info("Discarding uncommitted changes", this.branch);
    await this.git(["checkout", "."]);
    await this.git(["clean", "-fd"]);
  }

  /** Check if there are uncommitted changes. */
  async hasUncommittedChanges(): Promise<boolean> {
    const result = await this.git(["status", "--porcelain"]);
    return result.stdout.trim().length > 0;
  }

  /** Get the current HEAD sha. */
  async getHeadSha(): Promise<string> {
    const result = await this.git(["rev-parse", "HEAD"]);
    return result.stdout.trim();
  }

  /** Get list of files changed since a given sha. */
  async getChangedFilesSince(sha: string): Promise<string[]> {
    const result = await this.git([
      "diff",
      "--name-only",
      sha,
      "HEAD",
    ]);
    return result.stdout.trim().split("\n").filter(Boolean);
  }

  /** Fetch the remote branch and check for divergence. */
  async checkDivergence(): Promise<boolean> {
    try {
      await this.git(["fetch", "origin", this.branch]);
      const result = await this.git([
        "rev-list",
        "--left-right",
        "--count",
        `HEAD...origin/${this.branch}`,
      ]);
      const [ahead, behind] = result.stdout.trim().split("\t").map(Number);
      if (behind > 0) {
        logger.warn(
          `Branch ${this.branch} is ${behind} commits behind remote`,
          this.branch,
        );
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /** Pull with rebase to handle external force-pushes. */
  async pullRebase(): Promise<boolean> {
    try {
      await this.git(["pull", "--rebase", "origin", this.branch]);
      return true;
    } catch {
      logger.error(`Pull --rebase failed`, this.branch);
      return false;
    }
  }

  /** Checkout the branch (ensuring we're on it). */
  async checkout(): Promise<void> {
    await this.git(["checkout", this.branch]);
  }

  private async git(args: string[]): Promise<ExecResult> {
    return exec("git", args, { cwd: this.cwd });
  }
}
