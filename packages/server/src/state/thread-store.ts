import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import type { ThreadDisposition, DispositionKind } from "../types";

/** Shape of the persisted JSON file */
interface PersistedData {
  /** Keyed by "pr:<number>" → threadId → disposition */
  prs: Record<string, Record<string, ThreadDisposition>>;
}

const DATA_DIR = join(
  process.env.HOME || process.env.USERPROFILE || "/tmp",
  ".orc"
);
const DATA_FILE = join(DATA_DIR, "thread-dispositions.json");

export class ThreadStore {
  private data: PersistedData = { prs: {} };

  constructor() {
    this.load();
  }

  /** Mark a thread as handled, incrementing attempts */
  markThread(
    prNumber: number,
    threadId: string,
    disposition: DispositionKind
  ): ThreadDisposition {
    const key = prKey(prNumber);
    if (!this.data.prs[key]) {
      this.data.prs[key] = {};
    }

    const existing = this.data.prs[key][threadId];
    const record: ThreadDisposition = {
      disposition,
      attempts: (existing?.attempts ?? 0) + 1,
      lastAttemptAt: new Date().toISOString(),
    };

    this.data.prs[key][threadId] = record;
    this.persist();
    return record;
  }

  /** Remove a disposition (un-mark a thread) */
  unmarkThread(prNumber: number, threadId: string): void {
    const key = prKey(prNumber);
    const threads = this.data.prs[key];
    if (threads) {
      delete threads[threadId];
      if (Object.keys(threads).length === 0) {
        delete this.data.prs[key];
      }
      this.persist();
    }
  }

  /** Get all dispositions for a PR */
  getDispositions(prNumber: number): Record<string, ThreadDisposition> {
    return this.data.prs[prKey(prNumber)] ?? {};
  }

  /** Check if a thread should be skipped based on disposition + comment timestamps */
  shouldSkip(
    prNumber: number,
    threadId: string,
    latestCommentAt?: string
  ): { skip: boolean; reason?: string } {
    const disp = this.data.prs[prKey(prNumber)]?.[threadId];
    if (!disp) return { skip: false };

    // Max attempts reached — skip unconditionally
    if (disp.attempts >= 2) {
      return { skip: true, reason: "max_attempts" };
    }

    // No new activity since last attempt — skip
    if (!latestCommentAt || latestCommentAt <= disp.lastAttemptAt) {
      return { skip: true, reason: "no_new_activity" };
    }

    // New follow-up exists — don't skip (include for re-processing)
    return { skip: false };
  }

  /** Clean up dispositions for PRs that are no longer open */
  pruneClosedPRs(openPRNumbers: number[]): void {
    const openKeys = new Set(openPRNumbers.map(prKey));
    let changed = false;
    for (const key of Object.keys(this.data.prs)) {
      if (!openKeys.has(key)) {
        delete this.data.prs[key];
        changed = true;
      }
    }
    if (changed) this.persist();
  }

  private load(): void {
    try {
      if (existsSync(DATA_FILE)) {
        const text = readFileSync(DATA_FILE, "utf-8");
        this.data = JSON.parse(text) as PersistedData;
        if (!this.data.prs) this.data.prs = {};
      }
    } catch {
      console.error("orc: failed to load thread dispositions, starting fresh");
      this.data = { prs: {} };
    }
  }

  private persist(): void {
    try {
      if (!existsSync(DATA_DIR)) {
        mkdirSync(DATA_DIR, { recursive: true });
      }
      writeFileSync(DATA_FILE, JSON.stringify(this.data, null, 2));
    } catch (err) {
      console.error("orc: failed to persist thread dispositions:", err);
    }
  }
}

function prKey(prNumber: number): string {
  return `pr:${prNumber}`;
}
