/**
 * Entry point for the daemon — discovers and watches all open PRs
 * authored by the current user.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import React, { useState } from "react";
import { render, Box, Text, useInput } from "ink";
import { Daemon } from "../core/daemon.js";
import { ConfigSchema, type Config } from "../types/config.js";
import { logger } from "../utils/logger.js";
import { loadSettings, saveSettings } from "../utils/settings.js";
import { App } from "../tui/App.js";
import { ThemeProvider } from "../tui/theme.js";

export interface StartOptions {
  pollInterval?: number;
  confidence?: number;
  model?: string;
  sessionTimeout?: number;
  claudeTimeout?: number;
  dryRun?: boolean;
  verbose?: boolean;
  writeLogs?: boolean;
  theme?: "dark" | "light";
}

function ThemePicker({ onPick }: { onPick: (theme: "dark" | "light") => void }) {
  const [selected, setSelected] = useState<0 | 1>(0);

  useInput((input, key) => {
    if (key.upArrow || input === "k") setSelected(0);
    if (key.downArrow || input === "j") setSelected(1);
    if (key.return) onPick(selected === 0 ? "dark" : "light");
  });

  const options: { label: string; index: 0 | 1 }[] = [
    { label: "dark", index: 0 },
    { label: "light", index: 1 },
  ];

  return React.createElement(Box, { flexDirection: "column", paddingX: 1, paddingY: 1 },
    React.createElement(Text, { bold: true }, "Pick a theme:"),
    React.createElement(Box, { marginTop: 1, flexDirection: "column" },
      ...options.map(({ label, index }) =>
        React.createElement(Text, { key: label },
          selected === index
            ? React.createElement(Text, { color: "green" }, "> ")
            : "  ",
          React.createElement(Text, { bold: selected === index }, label),
        ),
      ),
    ),
    React.createElement(Text, { dimColor: true }, "↑/↓ to move, enter to select"),
  );
}

function ThemePickerWrapper({ onDone }: { onDone: (theme: "dark" | "light") => void }) {
  return React.createElement(ThemePicker, {
    onPick: (theme: "dark" | "light") => {
      onDone(theme);
    },
  });
}

async function promptTheme(): Promise<"dark" | "light"> {
  return new Promise((resolve) => {
    const instance = render(
      React.createElement(ThemePickerWrapper, {
        onDone: (theme: "dark" | "light") => {
          instance.unmount();
          resolve(theme);
        },
      }),
    );
  });
}

async function resolveTheme(explicitTheme?: "dark" | "light"): Promise<"dark" | "light"> {
  // 1. Explicit --theme flag takes priority
  if (explicitTheme) return explicitTheme;

  // 2. Saved settings
  const saved = loadSettings();
  if (saved && saved.theme && (saved.theme === "dark" || saved.theme === "light")) {
    return saved.theme;
  }

  // 3. First run — prompt the user
  const isTTY = process.stdin.isTTY === true;
  if (!isTTY) return "dark";

  const chosen = await promptTheme();
  try {
    saveSettings({ theme: chosen });
  } catch (error) {
    // Continue without saving if settings directory is not writable
    logger.warn("Could not save theme preference:", error instanceof Error ? error.message : String(error));
  }
  return chosen;
}

export async function startCommand(options: StartOptions): Promise<void> {
  const theme = await resolveTheme(options.theme);

  const config: Config = ConfigSchema.parse({
    pollInterval: options.pollInterval,
    confidence: options.confidence,
    model: options.model,
    sessionTimeout: options.sessionTimeout,
    claudeTimeout: options.claudeTimeout,
    dryRun: options.dryRun ?? false,
    verbose: options.verbose ?? false,
    writeLogs: options.writeLogs ?? false,
    theme,
  });

  logger.init(config.writeLogs ? "orc.log" : undefined, config.verbose);

  // Clean up session log files from previous runs
  try {
    const cwd = process.cwd();
    for (const entry of fs.readdirSync(cwd)) {
      if (entry.startsWith(".orc-session-") && entry.endsWith(".txt")) {
        try {
          fs.unlinkSync(path.join(cwd, entry));
        } catch {
          // Continue cleanup even if individual file deletion fails
        }
      }
    }
  } catch {
    // Directory read failed, skip cleanup
  }

  const isTTY = process.stdin.isTTY === true;

  if (isTTY) {
    logger.setSuppressConsole(true);
  }

  logger.info(`Orc starting`);
  logger.info(`Config: ${JSON.stringify(config, null, 2)}`);

  if (config.dryRun) {
    logger.info("[DRY RUN MODE] No changes will be made.");
  }

  const cwd = process.cwd();
  const daemon = new Daemon(config, cwd);

  if (!isTTY) {
    const cleanup = async () => {
      await daemon.stop();
      logger.close();
      process.exit(0);
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
    try {
      await daemon.run();
    } finally {
      logger.close();
    }
    return;
  }

  const daemonPromise = daemon.run().catch((err) => {
    logger.error(`Daemon error: ${err}`);
  });

  const instance = render(
    React.createElement(ThemeProvider, { initialMode: config.theme },
      React.createElement(App, { daemon }),
    ),
    { exitOnCtrlC: true },
  );

  await instance.waitUntilExit();

  const shutdown = async () => {
    await daemon.stop();
    await daemonPromise;
    logger.close();
  };
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 2000));
  await Promise.race([shutdown(), timeout]);
  process.exit(0);
}
