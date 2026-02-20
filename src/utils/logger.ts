import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
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

    // Emit for UI consumption
    this.emit("log", entry);

    // Console output (Phase 1 — before TUI exists)
    if (this.verbose || level !== "debug") {
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

  close(): void {
    this.logFile?.end();
  }
}

export const logger = new Logger();
