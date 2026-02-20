/**
 * Entry point for the daemon — discovers and watches all open PRs
 * authored by the current user.
 */

import { Daemon } from "../core/daemon.js";
import { ConfigSchema, type Config } from "../types/config.js";
import { logger } from "../utils/logger.js";

export interface StartOptions {
  maxLoops?: number;
  pollInterval?: number;
  debounce?: number;
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
    debounce: options.debounce,
    confidence: options.confidence,
    model: options.model,
    maxTurns: options.maxTurns,
    claudeTimeout: options.claudeTimeout,
    dryRun: options.dryRun ?? false,
    verbose: options.verbose ?? false,
  });

  logger.init("pr-pilot.log", config.verbose);
  logger.info(`PR Pilot starting`);
  logger.info(`Config: ${JSON.stringify(config, null, 2)}`);

  if (config.dryRun) {
    logger.info("[DRY RUN MODE] No changes will be made.");
  }

  const cwd = process.cwd();
  const daemon = new Daemon(config, cwd);

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
}
