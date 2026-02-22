import type { LogEntry } from "../../utils/logger.js";

/**
 * Processes a batch of log entries for branch-based logging.
 * Returns an updated Map with entries grouped by branch.
 */
export function processBranchLogBatch(
  prev: Map<string, LogEntry[]>,
  batch: LogEntry[],
  maxPerBranch: number
): Map<string, LogEntry[]> {
  const next = new Map(prev);
  for (const entry of batch) {
    if (!entry.branch) continue;
    const existing = next.get(entry.branch) ?? [];
    existing.push(entry);
    if (existing.length > maxPerBranch) {
      next.set(entry.branch, existing.slice(existing.length - maxPerBranch));
    } else {
      next.set(entry.branch, existing);
    }
  }
  return next;
}

/**
 * Processes a batch of log entries for general logging.
 * Returns updated state with capped entries and latest timestamp.
 */
export function processLogBatch<T extends { entries: LogEntry[]; lastTimestamp: string | null }>(
  prev: T,
  batch: LogEntry[],
  maxEntries: number
): T {
  const next = [...prev.entries, ...batch];
  return {
    ...prev,
    entries: next.length > maxEntries ? next.slice(next.length - maxEntries) : next,
    lastTimestamp: batch.length > 0 ? batch[batch.length - 1].timestamp : prev.lastTimestamp,
  };
}