import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";

const MAX_BRANCH_BUFFER = 500;
const LOG_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes
const FLUSH_INTERVAL_MS = 60_000; // 1 minute

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  branch: string | null;
  message: string;
  data?: unknown;
}

/**
 * Structured logger that writes to a file and emits events for the UI.
 *
 * When a log path is provided (via --write-logs), entries are buffered in
 * memory and periodically flushed to disk. Only the last 10 minutes of
 * entries are kept — older entries are pruned on each flush.
 */
class Logger extends EventEmitter {
  private logPath: string | null = null;
  private entries: LogEntry[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private verbose = false;
  private suppressConsole = false;
  private branchBuffers = new Map<string, LogEntry[]>();

  setSuppressConsole(v: boolean): void {
    this.suppressConsole = v;
  }

  init(logPath?: string, verbose = false): void {
    this.verbose = verbose;
    if (logPath) {
      const dir = path.dirname(logPath);
      fs.mkdirSync(dir, { recursive: true });
      this.logPath = logPath;
      // Write an empty file to start fresh
      fs.writeFileSync(logPath, "");
      this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
      this.flushTimer.unref();
    }
  }

  private log(
    level: LogLevel,
    message: string,
    branch: string | null = null,
    data?: unknown,
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      branch,
      message,
      data,
    };

    // Buffer entry for file logging
    if (this.logPath) {
      this.entries.push(entry);
    }

    // Buffer per-branch logs for dump
    if (branch) {
      let buf = this.branchBuffers.get(branch);
      if (!buf) { buf = []; this.branchBuffers.set(branch, buf); }
      buf.push(entry);
      if (buf.length > MAX_BRANCH_BUFFER) {
        buf.splice(0, buf.length - MAX_BRANCH_BUFFER);
      }
    }

    // Emit for UI consumption
    this.emit("log", entry);

    // Console output (suppressed when TUI is active)
    if (!this.suppressConsole && (this.verbose || level !== "debug")) {
      const prefix = branch ? `[${branch}]` : "";
      const levelTag = level.toUpperCase().padEnd(5);
      console.error(`${entry.timestamp} ${levelTag} ${prefix} ${message}`);
    }
  }

  debug(message: string, branch?: string, data?: unknown): void {
    this.log("debug", message, branch ?? null, data);
  }

  info(message: string, branch?: string, data?: unknown): void {
    this.log("info", message, branch ?? null, data);
  }

  warn(message: string, branch?: string, data?: unknown): void {
    this.log("warn", message, branch ?? null, data);
  }

  error(message: string, branch?: string, data?: unknown): void {
    this.log("error", message, branch ?? null, data);
  }

  dumpBranchLogs(branch: string, outputPath: string): void {
    const entries = this.branchBuffers.get(branch) ?? [];
    const lines = entries.map(e => {
      const level = e.level.toUpperCase().padEnd(5);
      return `${e.timestamp} ${level} ${e.message}`;
    });
    fs.writeFileSync(outputPath, lines.join("\n") + "\n");
  }

  /** Prune entries older than 10 minutes and write the rest to disk. */
  private flush(): void {
    if (!this.logPath) return;
    const cutoff = Date.now() - LOG_MAX_AGE_MS;
    this.entries = this.entries.filter(
      (e) => new Date(e.timestamp).getTime() >= cutoff,
    );
    const content = this.entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
    fs.writeFileSync(this.logPath, content);
  }

  close(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }
}

export const logger = new Logger();
