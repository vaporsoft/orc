import { execFile } from "node:child_process";
import { logger } from "./logger.js";

/**
 * Open a new terminal window and run a shell command.
 * Detects the user's terminal from TERM_PROGRAM.
 */
export function openTerminal(command: string): void {
  const term = process.env.TERM_PROGRAM?.toLowerCase() ?? "";

  if (term === "ghostty") {
    execFile("ghostty", ["-e", "bash", "-c", `${command}; exec bash`], (err) => {
      if (err) logger.error(`Failed to open Ghostty: ${err.message}`);
    });
  } else if (term === "iterm.app" || term === "iterm2") {
    execFile("osascript", [
      "-e", `tell application "iTerm"`,
      "-e", `activate`,
      "-e", `tell current window`,
      "-e", `create tab with default profile command "${command.replace(/"/g, '\\"')}"`,
      "-e", `end tell`,
      "-e", `end tell`,
    ], (err) => {
      if (err) logger.error(`Failed to open iTerm: ${err.message}`);
    });
  } else {
    // Default: macOS Terminal.app
    execFile("osascript", [
      "-e", `tell application "Terminal"`,
      "-e", `activate`,
      "-e", `do script "${command.replace(/"/g, '\\"')}"`,
      "-e", `end tell`,
    ], (err) => {
      if (err) logger.error(`Failed to open Terminal: ${err.message}`);
    });
  }
}
