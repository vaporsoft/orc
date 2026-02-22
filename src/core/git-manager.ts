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
  private conflictStashPending = false;

  constructor(cwd: string, branch: string) {
    this.cwd = cwd;
    this.branch = branch;
  }

  /** Interactive rebase with autosquash against the base branch.
   *  Skips if there are no fixup/squash commits to fold. */
  async rebaseAutosquash(baseBranch: string): Promise<boolean> {
    // Check if there are any fixup!/squash! commits to autosquash
    try {
      const result = await this.git([
        "log",
        "--oneline",
        `${baseBranch}..HEAD`,
        "--grep=^fixup!",
        "--grep=^squash!",
        "--format=%s",
      ]);
      if (result.stdout.trim().length === 0) {
        logger.info("No fixup commits found, skipping autosquash rebase", this.branch);
        return true;
      }
    } catch {
      // If the log fails (e.g. baseBranch doesn't exist locally), skip rebase
      logger.info("Could not check for fixup commits, skipping autosquash rebase", this.branch);
      return true;
    }

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
    } catch (_err) {
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
        `HEAD:${this.branch}`,
      ]);
      return true;
    } catch (_err) {
      logger.warn(`Push rejected, fetching and retrying`, this.branch);

      try {
        await this.git(["fetch", "origin", this.branch]);
        await this.git([
          "push",
          "--force-with-lease",
          "origin",
          `HEAD:${this.branch}`,
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
      const [_ahead, behind] = result.stdout.trim().split("\t").map(Number);
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

  /** Stash any uncommitted changes. Returns true if something was stashed. */
  private async stash(): Promise<boolean> {
    const dirty = await this.hasUncommittedChanges();
    if (!dirty) return false;
    await this.git(["stash", "--include-untracked"]);
    logger.info("Stashed uncommitted changes before rebase", this.branch);
    return true;
  }

  /** Pop the stash, ignoring errors if the stash is empty or conflicts. */
  private async stashPop(): Promise<void> {
    try {
      await this.git(["stash", "pop"]);
    } catch {
      // Stash pop can fail if changes conflict with rebased result — drop it
      logger.warn("Stash pop failed, dropping stash", this.branch);
      await this.git(["stash", "drop"]).catch(() => {});
    }
  }

  /** Fetch and rebase onto remote branch (works with detached HEAD). */
  async pullRebase(targetBranch?: string): Promise<boolean> {
    const branch = targetBranch || this.branch;
    const stashed = await this.stash();
    try {
      await this.git(["fetch", "origin", branch]);
      await this.git(["rebase", `origin/${branch}`]);
      return true;
    } catch {
      logger.error(`Rebase onto origin/${branch} failed`, this.branch);
      await this.git(["rebase", "--abort"]).catch(() => {});
      return false;
    } finally {
      if (stashed) await this.stashPop();
    }
  }

  /**
   * Start a rebase that will conflict, leaving the worktree in conflict state.
   * Returns the list of conflicting files, or null if the rebase succeeded (no conflicts).
   */
  async startConflictingRebase(targetBranch: string): Promise<string[] | null> {
    const stashed = await this.stash();
    this.conflictStashPending = stashed;

    try {
      await this.git(["fetch", "origin", targetBranch]);

      try {
        await this.git(["rebase", `origin/${targetBranch}`]);
        // Rebase succeeded without conflicts
        if (stashed) await this.stashPop();
        this.conflictStashPending = false;
        return null;
      } catch {
        // Rebase stopped at a conflict — get the conflicting files
        const result = await this.git(["diff", "--name-only", "--diff-filter=U"]);
        const files = result.stdout.trim().split("\n").filter(Boolean);
        if (files.length === 0) {
          // Rebase failed for a non-conflict reason
          await this.git(["rebase", "--abort"]).catch(() => {});
          if (stashed) await this.stashPop();
          this.conflictStashPending = false;
          return [];
        }
        // Keep conflictStashPending = true, will be handled after rebase completes
        return files;
      }
    } catch (error) {
      // Error from fetch or inner catch - abort any in-progress rebase and clean up stash
      await this.git(["rebase", "--abort"]).catch(() => {});
      if (stashed) await this.stashPop();
      this.conflictStashPending = false;
      throw error;
    }
  }

  /** Stage all files and continue a paused rebase. Returns false if more conflicts arise. */
  async continueRebase(): Promise<boolean> {
    try {
      await this.git(["add", "."]);
      await this.git(["-c", "core.editor=true", "rebase", "--continue"]);
      // Rebase completed successfully - pop any pending stash
      if (this.conflictStashPending) {
        await this.stashPop();
        this.conflictStashPending = false;
      }
      return true;
    } catch {
      // More conflicts in subsequent commits — check if still rebasing
      const status = await this.git(["diff", "--name-only", "--diff-filter=U"]);
      if (status.stdout.trim().length > 0) {
        return false; // Still have conflicts
      }
      // Rebase failed completely - abort and clean up stash
      await this.git(["rebase", "--abort"]).catch(() => {});
      if (this.conflictStashPending) {
        await this.stashPop();
        this.conflictStashPending = false;
      }
      return false;
    }
  }

  /** Abort a rebase in progress. */
  async abortRebase(): Promise<void> {
    await this.git(["rebase", "--abort"]).catch(() => {});
    // Clean up any pending stash when aborting
    if (this.conflictStashPending) {
      await this.stashPop();
      this.conflictStashPending = false;
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
