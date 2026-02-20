import { useState, useEffect, useRef } from "react";
import { logger, type LogEntry } from "../../utils/logger.js";

const MAX_PER_BRANCH = 200;
const THROTTLE_MS = 150;

/**
 * Buffers log entries keyed by branch name.
 * Returns the entries for a specific branch (or empty array if null).
 */
export function useBranchLogs(branch: string | null): LogEntry[] {
  const [logs, setLogs] = useState<Map<string, LogEntry[]>>(new Map());
  const bufferRef = useRef<LogEntry[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const flush = () => {
      timerRef.current = null;
      if (bufferRef.current.length === 0) return;
      const batch = bufferRef.current;
      bufferRef.current = [];
      setLogs((prev) => {
        const next = new Map(prev);
        for (const entry of batch) {
          if (!entry.branch) continue;
          const existing = next.get(entry.branch) ?? [];
          existing.push(entry);
          if (existing.length > MAX_PER_BRANCH) {
            next.set(entry.branch, existing.slice(existing.length - MAX_PER_BRANCH));
          } else {
            next.set(entry.branch, existing);
          }
        }
        return next;
      });
    };

    const onLog = (entry: LogEntry) => {
      if (!entry.branch) return;
      bufferRef.current.push(entry);
      if (!timerRef.current) {
        timerRef.current = setTimeout(flush, THROTTLE_MS);
      }
    };

    logger.on("log", onLog);
    return () => {
      logger.off("log", onLog);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  if (!branch) return [];
  return logs.get(branch) ?? [];
}
