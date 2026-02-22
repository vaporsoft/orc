/**
 * Loads per-repo configuration from two sources:
 *
 * - `ORC.md`          — freeform instructions/context passed to Claude Code
 * - `orc.config.json` — structured config (setup, verify, permissions, auto-fix)
 *
 * This mirrors the Claude Code pattern: markdown for context, JSON for config.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { RepoConfig } from "../types/index.js";
import { logger } from "../utils/logger.js";

const OrcConfigSchema = z.object({
  setup: z.array(z.string()).default([]),
  verify: z.array(z.string()).default([]),
  allowedCommands: z.array(z.string()).default([]),
  autoFix: z
    .object({
      must_fix: z.boolean().default(true),
      should_fix: z.boolean().default(true),
      nice_to_have: z.boolean().default(false),
      verify_and_fix: z.boolean().default(true),
      needs_clarification: z.boolean().default(true),
    })
    .default({}),
});

const DEFAULT_CONFIG: RepoConfig = {
  instructions: "",
  setupCommands: [],
  verifyCommands: [],
  allowedCommands: [],
  autoFix: {
    must_fix: true,
    should_fix: true,
    nice_to_have: false,
    verify_and_fix: true,
    needs_clarification: true,
  },
};

export async function loadRepoConfig(cwd: string): Promise<RepoConfig> {
  const instructions = await loadInstructions(cwd);
  const jsonConfig = await loadJsonConfig(cwd);

  return {
    instructions,
    setupCommands: jsonConfig.setup,
    verifyCommands: jsonConfig.verify,
    allowedCommands: jsonConfig.allowedCommands,
    autoFix: jsonConfig.autoFix,
  };
}

/** Read freeform instructions from ORC.md. */
async function loadInstructions(cwd: string): Promise<string> {
  const filePath = join(cwd, "ORC.md");
  try {
    const content = await readFile(filePath, "utf-8");
    logger.info("Loaded ORC.md instructions");
    return content.trim();
  } catch {
    logger.debug("No ORC.md found");
    return DEFAULT_CONFIG.instructions;
  }
}

/** Read structured config from orc.config.json, validated with Zod. */
async function loadJsonConfig(cwd: string): Promise<z.infer<typeof OrcConfigSchema>> {
  const filePath = join(cwd, "orc.config.json");
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    const config = OrcConfigSchema.parse(parsed);
    logger.info("Loaded orc.config.json");
    return config;
  } catch (err) {
    if (err instanceof z.ZodError) {
      logger.warn(`Invalid orc.config.json: ${err.issues.map((i) => i.message).join(", ")}`);
    } else if (err instanceof SyntaxError) {
      logger.warn(`Malformed JSON in orc.config.json: ${err.message}`);
    } else if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      logger.debug("No orc.config.json found, using defaults");
    } else {
      logger.warn(`Failed to load orc.config.json: ${err instanceof Error ? err.message : String(err)}`);
    }
    return OrcConfigSchema.parse({});
  }
}
