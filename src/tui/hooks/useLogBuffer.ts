import { useState, useEffect, useRef } from "react";
import { logger, type LogEntry } from "../../utils/logger.js";

const MAX_ENTRIES = 200;
const THROTTLE_MS = 150;

export interface LogBufferState {
  entries: LogEntry[];
  lastTimestamp: string | null;
}

export function useLogBuffer(): LogBufferState {
  const [state, setState] = useState<LogBufferState>({
    entries: [],
    lastTimestamp: null,
  });

  const bufferRef = useRef<LogEntry[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const flush = () => {
      timerRef.current = null;
      if (bufferRef.current.length === 0) return;
      const batch = bufferRef.current;
      bufferRef.current = [];
      setState((prev) => {
        const next = [...prev.entries, ...batch];
        return {
          entries: next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next,
          lastTimestamp: batch[batch.length - 1].timestamp,
        };
      });
    };

    const onLog = (entry: LogEntry) => {
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

  return state;
}
