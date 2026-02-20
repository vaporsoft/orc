/**
 * Manages git worktrees for multi-branch support.
 * Each additional branch gets its own worktree at /tmp/orc/<branch-safe>.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { exec } from "../utils/process.js";
import { logger } from "../utils/logger.js";
import { WORKTREE_BASE } from "../constants.js";

export class WorktreeManager {
  private cwd: string;
  private worktrees: Map<string, string> = new Map();

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  /**
   * Create a worktree for a branch. Returns the worktree path.
   * If a worktree already exists for this branch, returns its path.
   */
  async create(branch: string): Promise<string> {
    if (this.worktrees.has(branch)) {
      return this.worktrees.get(branch)!;
    }

    const safeName = branch.replace(/[^a-zA-Z0-9_-]/g, "_");
    const worktreePath = path.join(WORKTREE_BASE, safeName);

    fs.mkdirSync(WORKTREE_BASE, { recursive: true });

    logger.info(`Creating worktree at ${worktreePath}`, branch);

    try {
      await exec("git", ["worktree", "add", worktreePath, branch], {
        cwd: this.cwd,
      });
    } catch (err) {
      // Worktree might already exist from a previous run
      if (fs.existsSync(worktreePath)) {
        logger.warn(`Worktree already exists at ${worktreePath}`, branch);
      } else {
        throw err;
      }
    }

    // Detect package manager and install dependencies
    await this.installDependencies(worktreePath, branch);

    this.worktrees.set(branch, worktreePath);
    return worktreePath;
  }

  /** Remove a worktree for a branch. */
  async remove(branch: string): Promise<void> {
    const worktreePath = this.worktrees.get(branch);
    if (!worktreePath) return;

    logger.info(`Removing worktree at ${worktreePath}`, branch);

    try {
      await exec("git", ["worktree", "remove", worktreePath, "--force"], {
        cwd: this.cwd,
      });
    } catch (err) {
      logger.warn(`Failed to remove worktree: ${err}`, branch);
    }

    this.worktrees.delete(branch);
  }

  /** Clean up all worktrees. */
  async cleanup(): Promise<void> {
    for (const branch of this.worktrees.keys()) {
      await this.remove(branch);
    }
    // Prune stale worktree references
    try {
      await exec("git", ["worktree", "prune"], { cwd: this.cwd });
    } catch {
      // Best-effort
    }
  }

  /** Get the working directory for a branch (worktree or cwd). */
  getWorkDir(branch: string): string | null {
    return this.worktrees.get(branch) ?? null;
  }

  private async installDependencies(
    worktreePath: string,
    branch: string,
  ): Promise<void> {
    // Detect package manager
    const hasYarnLock = fs.existsSync(path.join(worktreePath, "yarn.lock"));
    const hasPnpmLock = fs.existsSync(
      path.join(worktreePath, "pnpm-lock.yaml"),
    );
    const hasPackageJson = fs.existsSync(
      path.join(worktreePath, "package.json"),
    );

    if (!hasPackageJson) return;

    const pm = hasPnpmLock ? "pnpm" : hasYarnLock ? "yarn" : "npm";
    logger.info(`Installing dependencies with ${pm}`, branch);

    try {
      await exec(pm, ["install"], {
        cwd: worktreePath,
        timeout: 120000,
      });
    } catch (err) {
      logger.warn(`Dependency installation failed: ${err}`, branch);
    }
  }
}
