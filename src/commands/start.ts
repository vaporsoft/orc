/**
 * The `start` command — launches one or more session controllers
 * for the given branches. Phase 1 uses log output only (no TUI).
 */

import { SessionController } from "../core/session-controller.js";
import { WorktreeManager } from "../core/worktree-manager.js";
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

export async function startCommand(
  branches: string[],
  options: StartOptions,
): Promise<void> {
  // Parse and validate config
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

  // Initialize logger
  logger.init("pr-pilot.log", config.verbose);

  logger.info(`PR Pilot starting for branches: ${branches.join(", ")}`);
  logger.info(`Config: ${JSON.stringify(config, null, 2)}`);

  if (config.dryRun) {
    logger.info("[DRY RUN MODE] No changes will be made.");
  }

  const cwd = process.cwd();
  const worktreeManager = new WorktreeManager(cwd);
  const controllers: SessionController[] = [];

  // Graceful shutdown
  const cleanup = async () => {
    logger.info("Shutting down...");
    for (const controller of controllers) {
      controller.stop();
    }
    await worktreeManager.cleanup();
    logger.close();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Launch controllers
  for (let i = 0; i < branches.length; i++) {
    const branch = branches[i];
    let workDir = cwd;

    // First branch uses cwd; additional branches get worktrees
    if (i > 0) {
      try {
        workDir = await worktreeManager.create(branch);
      } catch (err) {
        logger.error(
          `Failed to create worktree for ${branch}: ${err}`,
        );
        continue;
      }
    }

    const controller = new SessionController(branch, config, workDir);

    controller.on("statusChange", (b: string, status: string) => {
      logger.info(`Status: ${status}`, b);
    });

    controller.on("iterationComplete", (b: string, summary: unknown) => {
      logger.info(
        `Iteration complete: ${JSON.stringify(summary)}`,
        b,
      );
    });

    controller.on("done", (b: string) => {
      logger.info("Session finished.", b);
    });

    controllers.push(controller);
  }

  // Run all controllers concurrently
  const results = await Promise.allSettled(
    controllers.map((c) => c.start()),
  );

  // Report results
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const branch = branches[i];
    if (result.status === "rejected") {
      logger.error(`${branch}: ${result.reason}`);
    } else {
      const state = controllers[i].getState();
      logger.info(
        `${branch}: ${state.status} after ${state.currentIteration} iterations ($${state.totalCostUsd.toFixed(4)})`,
      );
    }
  }

  // Cleanup worktrees
  await worktreeManager.cleanup();
  logger.close();
}
