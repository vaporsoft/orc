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
  private worktrees = new Map<string, string>();

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  /**
   * Create a worktree for a branch. Returns the worktree path.
   * If a worktree already exists for this branch, returns its path.
   * When setupCommands are provided (from ORC.md), they replace the default dependency install.
   */
  async create(branch: string, setupCommands?: string[]): Promise<string> {
    if (this.worktrees.has(branch)) {
      return this.worktrees.get(branch)!;
    }

    const safeName = branch.replace(/[^a-zA-Z0-9_-]/g, "_");
    const suffix = crypto.randomBytes(3).toString("hex");
    const worktreePath = path.join(WORKTREE_BASE, `${safeName}_${suffix}`);

    fs.mkdirSync(WORKTREE_BASE, { recursive: true });

    // Fetch the branch from origin so the ref exists locally
    // (needed for branches created remotely, e.g. by Claude web agent)
    try {
      await exec("git", ["fetch", "origin", branch], { cwd: this.cwd });
    } catch {
      // Branch may already exist locally; continue and let worktree add fail if truly missing
    }

    logger.info(`Creating worktree at ${worktreePath}`, branch);

    await exec("git", ["worktree", "add", "--detach", worktreePath, `origin/${branch}`], {
      cwd: this.cwd,
    });

    // Run setup: use explicit commands from ORC.md, or fall back to auto-detected dependency install
    if (setupCommands && setupCommands.length > 0) {
      await this.runSetupCommands(worktreePath, branch, setupCommands);
    } else {
      await this.installDependencies(worktreePath, branch);
    }

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

    // Get list of worktrees that git knows about for this repo
    const knownWorktrees = new Set<string>();
    try {
      const result = await exec("git", ["worktree", "list", "--porcelain"], {
        cwd: this.cwd,
      });
      const worktreeLines = result.stdout.split("\n");
      for (const line of worktreeLines) {
        if (line.startsWith("worktree ")) {
          knownWorktrees.add(line.substring(9));
        }
      }
    } catch {
      // If we can't get worktree list, be conservative and don't delete anything
      logger.warn("Could not get worktree list, skipping purge for safety");
      return;
    }

    const entries = fs.readdirSync(WORKTREE_BASE);
    for (const entry of entries) {
      const fullPath = path.join(WORKTREE_BASE, entry);

      // Only try to remove if git knows about this worktree
      if (knownWorktrees.has(fullPath)) {
        try {
          await exec("git", ["worktree", "remove", fullPath, "--force"], {
            cwd: this.cwd,
          });
        } catch (err) {
          logger.warn(`Could not remove known worktree ${fullPath}: ${err}`);
        }
      } else {
        // Verify this is actually a git worktree directory before deleting
        const gitDirPath = path.join(fullPath, ".git");
        if (fs.existsSync(gitDirPath)) {
          try {
            // Check if this is a worktree by reading .git file
            const gitContent = fs.readFileSync(gitDirPath, "utf8");
            if (gitContent.startsWith("gitdir:")) {
              // This looks like a worktree, but git doesn't know about it
              logger.info(`Removing orphaned worktree: ${fullPath}`);
              fs.rmSync(fullPath, { recursive: true, force: true });
            }
          } catch (err) {
            logger.warn(`Could not verify worktree ${fullPath}: ${err}`);
          }
        }
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

  private async runSetupCommands(
    worktreePath: string,
    branch: string,
    commands: string[],
  ): Promise<void> {
    for (const cmd of commands) {
      logger.info(`Running setup: ${cmd}`, branch);
      try {
        const parts = cmd.trim().split(/\s+/);
        await exec(parts[0], parts.slice(1), {
          cwd: worktreePath,
          timeout: 120000,
        });
      } catch (err) {
        logger.warn(`Setup command failed: ${cmd}: ${err}`, branch);
      }
    }
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
