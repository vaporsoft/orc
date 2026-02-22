import { useState, useEffect, useRef } from "react";
import { logger, type LogEntry } from "../../utils/logger.js";
import { processLogBatch } from "./logFlushUtils.js";

const MAX_ENTRIES = 200;
const THROTTLE_MS = 150;

export interface LogBufferState {
  entries: LogEntry[];
  lastTimestamp: string | null;
}

export function useLogBuffer(paused = false): LogBufferState {
  const [state, setState] = useState<LogBufferState>({
    entries: [],
    lastTimestamp: null,
  });

  const bufferRef = useRef<LogEntry[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const flush = () => {
      timerRef.current = null;
      if (pausedRef.current || bufferRef.current.length === 0) return;
      const batch = bufferRef.current;
      bufferRef.current = [];
      setState((prev) => processLogBatch(prev, batch, MAX_ENTRIES));
    };

    const onLog = (entry: LogEntry) => {
      bufferRef.current.push(entry);
      if (bufferRef.current.length > MAX_ENTRIES) {
        bufferRef.current = bufferRef.current.slice(-MAX_ENTRIES);
      }
      if (!pausedRef.current && !timerRef.current) {
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

  // Flush buffered entries when unpaused
  useEffect(() => {
    if (!paused && bufferRef.current.length > 0) {
      const batch = bufferRef.current;
      bufferRef.current = [];
      setState((prev) => processLogBatch(prev, batch, MAX_ENTRIES));
    }
  }, [paused]);

  return state;
}
