/**
 * Persists review progress to disk so lifetime comment counts
 * survive across sessions and daemon restarts.
 *
 * Stores `orc-progress.json` in the repo working directory
 * (same location pattern as `orc.log`).
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CycleRecord } from "../types/index.js";
import { logger } from "../utils/logger.js";

interface PRProgress {
  prNumber: number;
  branch: string;
  /** Unique thread IDs ever encountered (for deduped totalSeen count). */
  seenThreadIds: string[];
  cycles: CycleRecord[];
}

interface ProgressData {
  version: 1;
  prs: Record<string, PRProgress>;
}

export class ProgressStore {
  private filePath: string;
  private data: ProgressData = { version: 1, prs: {} };

  constructor(cwd: string) {
    this.filePath = join(cwd, "orc-progress.json");
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      this.data = JSON.parse(raw) as ProgressData;
    } catch {
      // File doesn't exist yet or is corrupt — start fresh
      this.data = { version: 1, prs: {} };
    }
  }

  private async save(): Promise<void> {
    try {
      await writeFile(this.filePath, JSON.stringify(this.data, null, 2) + "\n");
    } catch (err) {
      logger.warn(`Failed to save progress: ${err}`);
    }
  }

  getLifetimeStats(branch: string): {
    lifetimeSeen: number;
    lifetimeAddressed: number;
    cycleCount: number;
    cycleHistory: CycleRecord[];
  } {
    const pr = this.data.prs[branch];
    if (!pr) {
      return { lifetimeSeen: 0, lifetimeAddressed: 0, cycleCount: 0, cycleHistory: [] };
    }

    // Calculate lifetimeAddressed from cycle history to ensure it can never exceed lifetimeSeen
    const lifetimeAddressed = pr.cycles.reduce((sum, cycle) => sum + (cycle.commentsFixed || 0), 0);

    return {
      lifetimeSeen: pr.seenThreadIds.length,
      lifetimeAddressed,
      cycleCount: pr.cycles.length,
      cycleHistory: pr.cycles,
    };
  }

  /**
   * Called at the start of each fix cycle.
   * Registers newly-seen thread IDs and opens a new cycle record.
   */
  async recordCycleStart(
    branch: string,
    prNumber: number,
    threadIds: string[],
  ): Promise<void> {
    let pr = this.data.prs[branch];
    if (!pr) {
      pr = {
        prNumber,
        branch,
        seenThreadIds: [],
        cycles: [],
      };
      this.data.prs[branch] = pr;
    }

    // Merge new thread IDs (dedup)
    const existing = new Set(pr.seenThreadIds);
    for (const id of threadIds) {
      if (!existing.has(id)) {
        pr.seenThreadIds.push(id);
      }
    }

    pr.cycles.push({
      startedAt: new Date().toISOString(),
      completedAt: null,
      commentsSeen: threadIds.length,
      commentsFixed: 0,
      costUsd: 0,
    });

    await this.save();
  }

  /**
   * Called at the end of each fix cycle.
   * Completes the latest cycle record with results.
   */
  async recordCycleEnd(
    branch: string,
    commentsFixed: number,
    costUsd: number,
  ): Promise<void> {
    const pr = this.data.prs[branch];
    if (!pr || pr.cycles.length === 0) return;

    const cycle = pr.cycles[pr.cycles.length - 1];
    cycle.completedAt = new Date().toISOString();
    cycle.commentsFixed = commentsFixed;
    cycle.costUsd = costUsd;

    await this.save();
  }
}
