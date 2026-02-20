import { useState, useEffect } from "react";
import { logger, type LogEntry } from "../../utils/logger.js";

const MAX_PER_BRANCH = 200;

/**
 * Buffers log entries keyed by branch name.
 * Returns the entries for a specific branch (or empty array if null).
 */
export function useBranchLogs(branch: string | null): LogEntry[] {
  const [logs, setLogs] = useState<Map<string, LogEntry[]>>(new Map());

  useEffect(() => {
    const onLog = (entry: LogEntry) => {
      if (!entry.branch) return;
      setLogs((prev) => {
        const next = new Map(prev);
        const existing = next.get(entry.branch!) ?? [];
        const updated = [...existing, entry];
        next.set(
          entry.branch!,
          updated.length > MAX_PER_BRANCH
            ? updated.slice(updated.length - MAX_PER_BRANCH)
            : updated,
        );
        return next;
      });
    };

    logger.on("log", onLog);
    return () => {
      logger.off("log", onLog);
    };
  }, []);

  if (!branch) return [];
  return logs.get(branch) ?? [];
}
