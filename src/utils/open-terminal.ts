import { execFile } from "node:child_process";
import { loadSettings, type Terminal } from "./settings.js";
import { logger } from "./logger.js";

/**
 * Resolve which terminal to use.
 * Priority: explicit setting > TERM_PROGRAM detection > Terminal.app fallback.
 */
export function resolveTerminal(): Terminal {
  const settings = loadSettings();
  if (settings?.terminal) return settings.terminal;

  const termProgram = process.env.TERM_PROGRAM?.toLowerCase() ?? "";
  if (termProgram === "ghostty") return "ghostty";
  if (termProgram === "iterm.app" || termProgram === "iterm2") return "iterm2";
  if (termProgram === "kitty") return "kitty";
  if (termProgram === "wezterm") return "wezterm";
  if (termProgram === "alacritty") return "alacritty";

  return "terminal";
}

const userShell = process.env.SHELL ?? "/bin/sh";

/** Escape a string for safe inclusion in a single-quoted shell argument. */
export function shellEscape(s: string): string {
  // Replace every ' with '\'' (end quote, escaped quote, start quote)
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function escapeAppleScript(cmd: string): string {
  // Escape both backslashes and double quotes for AppleScript string literals
  return cmd.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function openGhostty(command: string): void {
  execFile(
    "open",
    ["-na", "Ghostty", "--args", "-e", userShell, "-c", `${command}; exec ${userShell}`],
    (err) => {
      if (err) logger.error(`Failed to open Ghostty: ${err.message}`);
    },
  );
}

function openITerm(command: string): void {
  execFile(
    "osascript",
    [
      "-e", `tell application "iTerm"`,
      "-e", `activate`,
      "-e", `tell current window`,
      "-e", `create tab with default profile command "${escapeAppleScript(command)}"`,
      "-e", `end tell`,
      "-e", `end tell`,
    ],
    (err) => {
      if (err) logger.error(`Failed to open iTerm: ${err.message}`);
    },
  );
}

function openTerminalApp(command: string): void {
  execFile(
    "osascript",
    [
      "-e", `tell application "Terminal"`,
      "-e", `activate`,
      "-e", `do script "${escapeAppleScript(command)}"`,
      "-e", `end tell`,
    ],
    (err) => {
      if (err) logger.error(`Failed to open Terminal: ${err.message}`);
    },
  );
}

function openKitty(command: string): void {
  execFile(
    "open",
    ["-na", "kitty", "--args", userShell, "-c", `${command}; exec ${userShell}`],
    (err) => {
      if (err) logger.error(`Failed to open kitty: ${err.message}`);
    },
  );
}

function openWezTerm(command: string): void {
  execFile(
    "open",
    ["-na", "WezTerm", "--args", "start", "--", userShell, "-c", `${command}; exec ${userShell}`],
    (err) => {
      if (err) logger.error(`Failed to open WezTerm: ${err.message}`);
    },
  );
}

function openAlacritty(command: string): void {
  execFile(
    "alacritty",
    ["-e", userShell, "-c", `${command}; exec ${userShell}`],
    (err) => {
      if (err) logger.error(`Failed to open Alacritty: ${err.message}`);
    },
  );
}

const launchers: Record<Terminal, (command: string) => void> = {
  ghostty: openGhostty,
  iterm2: openITerm,
  terminal: openTerminalApp,
  kitty: openKitty,
  wezterm: openWezTerm,
  alacritty: openAlacritty,
};

/**
 * Open a new terminal window and run a shell command.
 * Resolves the terminal from user settings, TERM_PROGRAM, or falls back to Terminal.app.
 */
export function openTerminal(command: string): void {
  const terminal = resolveTerminal();
  launchers[terminal](command);
}
