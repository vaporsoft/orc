import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";

const MAX_BRANCH_BUFFER = 500;

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
 */
class Logger extends EventEmitter {
  private logFile: fs.WriteStream | null = null;
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
      this.logFile = fs.createWriteStream(logPath, { flags: "a" });
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

    // Write to log file
    this.logFile?.write(JSON.stringify(entry) + "\n");

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

  close(): void {
    this.logFile?.end();
  }
}

export const logger = new Logger();
