/**
 * Entry point for the daemon — discovers and watches all open PRs
 * authored by the current user.
 */

import React from "react";
import { render } from "ink";
import { Daemon } from "../core/daemon.js";
import { ConfigSchema, type Config } from "../types/config.js";
import { logger } from "../utils/logger.js";
import { App } from "../tui/App.js";

export interface StartOptions {
  maxLoops?: number;
  pollInterval?: number;
  confidence?: number;
  model?: string;
  maxTurns?: number;
  claudeTimeout?: number;
  dryRun?: boolean;
  verbose?: boolean;
}

export async function startCommand(options: StartOptions): Promise<void> {
  const config: Config = ConfigSchema.parse({
    maxLoops: options.maxLoops,
    pollInterval: options.pollInterval,
    confidence: options.confidence,
    model: options.model,
    maxTurns: options.maxTurns,
    claudeTimeout: options.claudeTimeout,
    dryRun: options.dryRun ?? false,
    verbose: options.verbose ?? false,
  });

  logger.init("orc.log", config.verbose);

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

  const startTime = Date.now();

  const daemonPromise = daemon.run().catch((err) => {
    logger.error(`Daemon error: ${err}`);
  });

  const instance = render(
    React.createElement(App, { daemon, startTime }),
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
