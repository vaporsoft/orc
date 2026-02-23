import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";

const MAX_BRANCH_BUFFER = 500;
const LOG_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes
const PRUNE_INTERVAL_MS = 60_000; // 1 minute

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
 * When a log path is provided (via --write-logs), each entry is appended to
 * disk immediately. Every 60 seconds, entries older than 10 minutes are pruned
 * and the file is rewritten with only the recent entries.
 */
class Logger extends EventEmitter {
  private logFile: fs.WriteStream | null = null;
  private logPath: string | null = null;
  private entries: LogEntry[] = [];
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
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
      if (dir !== ".") fs.mkdirSync(dir, { recursive: true });
      this.logPath = logPath;
      // Start fresh
      fs.writeFileSync(logPath, "");
      this.logFile = fs.createWriteStream(logPath, { flags: "a" });
      this.pruneTimer = setInterval(() => this.prune(), PRUNE_INTERVAL_MS);
      this.pruneTimer.unref();
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

    // Write to log file immediately
    if (this.logFile) {
      this.logFile.write(JSON.stringify(entry) + "\n");
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

  /** Prune entries older than 10 minutes and rewrite the log file. */
  private prune(reopen = true): void {
    if (!this.logPath) return;
    const cutoff = Date.now() - LOG_MAX_AGE_MS;
    this.entries = this.entries.filter(
      (e) => new Date(e.timestamp).getTime() >= cutoff,
    );
    // Destroy current stream synchronously (discards buffered data which is fine
    // since we're about to rewrite the file with the authoritative entries array)
    this.logFile?.destroy();
    this.logFile = null;
    const content =
      this.entries.length > 0
        ? this.entries.map((e) => JSON.stringify(e)).join("\n") + "\n"
        : "";
    fs.writeFileSync(this.logPath, content);
    if (reopen) {
      this.logFile = fs.createWriteStream(this.logPath, { flags: "a" });
    }
  }

  close(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
    this.prune(false);
  }
}

export const logger = new Logger();
