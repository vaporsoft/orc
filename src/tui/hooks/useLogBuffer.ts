import { useState, useEffect } from "react";
import { logger, type LogEntry } from "../../utils/logger.js";

const MAX_ENTRIES = 200;

export interface LogBufferState {
  entries: LogEntry[];
  lastTimestamp: string | null;
}

export function useLogBuffer(): LogBufferState {
  const [state, setState] = useState<LogBufferState>({
    entries: [],
    lastTimestamp: null,
  });

  useEffect(() => {
    const onLog = (entry: LogEntry) => {
      setState((prev) => {
        const next = [...prev.entries, entry];
        return {
          entries: next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next,
          lastTimestamp: entry.timestamp,
        };
      });
    };

    logger.on("log", onLog);
    return () => {
      logger.off("log", onLog);
    };
  }, []);

  return state;
}
