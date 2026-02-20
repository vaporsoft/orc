import { useState, useEffect } from "react";
import { logger, type LogEntry } from "../../utils/logger.js";

const MAX_ENTRIES = 200;

export function useLogBuffer(): LogEntry[] {
  const [entries, setEntries] = useState<LogEntry[]>([]);

  useEffect(() => {
    const onLog = (entry: LogEntry) => {
      setEntries((prev) => {
        const next = [...prev, entry];
        if (next.length > MAX_ENTRIES) {
          return next.slice(next.length - MAX_ENTRIES);
        }
        return next;
      });
    };

    logger.on("log", onLog);
    return () => {
      logger.off("log", onLog);
    };
  }, []);

  return entries;
}
