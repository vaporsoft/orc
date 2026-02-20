/**
 * Manages git worktrees for multi-branch support.
 * Each additional branch gets its own worktree at /tmp/orc/<branch-safe>.
 */

import * as crypto from "node:crypto";
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
    const suffix = crypto.randomBytes(3).toString("hex");
    const worktreePath = path.join(WORKTREE_BASE, `${safeName}_${suffix}`);

    fs.mkdirSync(WORKTREE_BASE, { recursive: true });

    logger.info(`Creating worktree at ${worktreePath}`, branch);

    await exec("git", ["worktree", "add", "--detach", worktreePath, branch], {
      cwd: this.cwd,
    });

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

  /** Remove all worktrees in WORKTREE_BASE from a previous run and prune git refs. */
  async purgeStale(): Promise<void> {
    try {
      await exec("git", ["worktree", "prune"], { cwd: this.cwd });
    } catch {
      // Best-effort
    }

    if (!fs.existsSync(WORKTREE_BASE)) return;

    const entries = fs.readdirSync(WORKTREE_BASE);
    for (const entry of entries) {
      const fullPath = path.join(WORKTREE_BASE, entry);
      try {
        await exec("git", ["worktree", "remove", fullPath, "--force"], {
          cwd: this.cwd,
        });
      } catch {
        // If git doesn't know about it, just rm it
        fs.rmSync(fullPath, { recursive: true, force: true });
      }
    }

    try {
      await exec("git", ["worktree", "prune"], { cwd: this.cwd });
    } catch {
      // Best-effort
    }

    logger.info("Purged stale worktrees");
  }

  /** Clean up all worktrees managed by this instance. */
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
