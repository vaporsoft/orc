/**
 * Loads per-repo configuration from two sources:
 *
 * - `ORC.md`          — freeform instructions/context passed to Claude Code
 * - `orc.config.json` — structured config (setup, verify, permissions, auto-fix, MCP servers)
 *
 * This mirrors the Claude Code pattern: markdown for context, JSON for config.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { MCPServerConfig, RepoConfig } from "../types/index.js";
import { logger } from "../utils/logger.js";

const McpServerSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
});

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
  mcpServers: z.record(McpServerSchema).default({}),
  /** Allowlist of env var names that can be resolved in MCP server configs. */
  allowedEnvVars: z.array(z.string()).default([]),
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
  mcpServers: {},
  allowedEnvVars: [],
};

export async function loadRepoConfig(cwd: string): Promise<RepoConfig> {
  const { instructions, orcMdContent } = await loadInstructions(cwd);
  const jsonResult = await loadJsonConfig(cwd);

  // Only fall back to legacy ORC.md sections if orc.config.json doesn't exist at all.
  // If orc.config.json exists but is invalid/malformed, use defaults (don't silently use legacy).
  if (jsonResult.status === "not_found" && orcMdContent) {
    const legacyConfig = parseLegacyOrcMdSections(orcMdContent);
    if (legacyConfig) {
      logger.info("Using legacy ORC.md sections (## Verify, ## Auto-fix, etc.) for config");
      return {
        instructions,
        setupCommands: legacyConfig.setupCommands,
        verifyCommands: legacyConfig.verifyCommands,
        allowedCommands: legacyConfig.allowedCommands,
        autoFix: legacyConfig.autoFix,
        mcpServers: legacyConfig.mcpServers,
        allowedEnvVars: legacyConfig.allowedEnvVars,
      };
    }
  }

  return {
    instructions,
    setupCommands: jsonResult.config.setup,
    verifyCommands: jsonResult.config.verify,
    allowedCommands: jsonResult.config.allowedCommands,
    autoFix: jsonResult.config.autoFix,
    mcpServers: jsonResult.config.mcpServers,
    allowedEnvVars: jsonResult.config.allowedEnvVars,
  };
}

/** Read freeform instructions from ORC.md. */
async function loadInstructions(cwd: string): Promise<{ instructions: string; orcMdContent: string | null }> {
  const filePath = join(cwd, "ORC.md");
  try {
    const content = await readFile(filePath, "utf-8");
    logger.info("Loaded ORC.md instructions");
    return { instructions: content.trim(), orcMdContent: content };
  } catch {
    logger.debug("No ORC.md found");
    return { instructions: DEFAULT_CONFIG.instructions, orcMdContent: null };
  }
}

interface LegacyOrcConfig {
  setupCommands: string[];
  verifyCommands: string[];
  allowedCommands: string[];
  autoFix: RepoConfig["autoFix"];
  mcpServers: Record<string, MCPServerConfig>;
  allowedEnvVars: string[];
}

/**
 * Parse legacy ORC.md sections (## Verify, ## Auto-fix, etc.)
 * for backwards compatibility with users who haven't migrated to orc.config.json.
 */
function parseLegacyOrcMdSections(content: string): LegacyOrcConfig | null {
  const sections = new Map<string, string>();
  let currentHeading = "";
  const lines = content.split("\n");

  for (const line of lines) {
    const h2Match = line.match(/^## (.+)/);
    if (h2Match) {
      currentHeading = h2Match[1].trim().toLowerCase();
      continue;
    }
    if (line.match(/^# /)) continue;

    if (currentHeading) {
      const existing = sections.get(currentHeading) ?? "";
      sections.set(currentHeading, existing + line + "\n");
    }
  }

  // Check if any legacy sections exist
  const hasLegacySections =
    sections.has("verify") || sections.has("auto-fix") || sections.has("setup") || sections.has("allowed commands") || sections.has("mcp servers");

  if (!hasLegacySections) {
    return null;
  }

  const setupCommands: string[] = [];
  const setupSection = sections.get("setup") ?? "";
  for (const line of setupSection.split("\n")) {
    const match = line.match(/^-\s*`(.+)`/);
    if (match) {
      setupCommands.push(match[1]);
    }
  }

  const verifyCommands: string[] = [];
  const verifySection = sections.get("verify") ?? "";
  for (const line of verifySection.split("\n")) {
    const match = line.match(/^-\s*`(.+)`/);
    if (match) {
      verifyCommands.push(match[1]);
    }
  }

  const allowedCommands: string[] = [];
  const allowedSection = sections.get("allowed commands") ?? "";
  for (const line of allowedSection.split("\n")) {
    const match = line.match(/^-\s*`(.+)`/);
    if (match) {
      allowedCommands.push(match[1]);
    }
  }

  const autoFix = { ...DEFAULT_CONFIG.autoFix };
  const autoFixSection = sections.get("auto-fix") ?? "";
  for (const line of autoFixSection.split("\n")) {
    const match = line.match(
      /^-\s*(must_fix|should_fix|nice_to_have|verify_and_fix|needs_clarification)\s*:\s*(true|false)/
    );
    if (match) {
      autoFix[match[1] as keyof typeof autoFix] = match[2] === "true";
    }
  }

  // Parse ## MCP Servers — expects a fenced JSON block
  const mcpServers = parseMcpServers(sections.get("mcp servers") ?? "");

  // Legacy ORC.md doesn't support allowedEnvVars — always empty for security
  return { setupCommands, verifyCommands, allowedCommands, autoFix, mcpServers, allowedEnvVars: [] };
}

/** Extract JSON from a fenced code block and validate as MCP server config. */
function parseMcpServers(section: string): Record<string, MCPServerConfig> {
  const jsonMatch = section.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  if (!jsonMatch) return {};

  try {
    const parsed = JSON.parse(jsonMatch[1]) as Record<string, unknown>;
    const servers: Record<string, MCPServerConfig> = {};

    for (const [name, raw] of Object.entries(parsed)) {
      if (typeof raw !== "object" || raw === null) continue;
      const entry = raw as Record<string, unknown>;

      if (typeof entry.command !== "string") {
        logger.warn(`MCP server "${name}" missing required "command" field, skipping`);
        continue;
      }

      const config: MCPServerConfig = { command: entry.command };
      if (Array.isArray(entry.args) && entry.args.every((a: unknown) => typeof a === "string")) {
        config.args = entry.args as string[];
      }
      if (typeof entry.env === "object" && entry.env !== null && Object.values(entry.env).every((v: unknown) => typeof v === "string")) {
        config.env = entry.env as Record<string, string>;
      }

      servers[name] = config;
    }

    if (Object.keys(servers).length > 0) {
      logger.info(`Loaded ${Object.keys(servers).length} MCP server(s) from ORC.md`);
    }

    return servers;
  } catch (err) {
    logger.warn(`Failed to parse MCP Servers JSON in ORC.md: ${err}`);
    return {};
  }
}

type JsonConfigResult =
  | { status: "loaded"; config: z.infer<typeof OrcConfigSchema> }
  | { status: "not_found"; config: z.infer<typeof OrcConfigSchema> }
  | { status: "invalid"; config: z.infer<typeof OrcConfigSchema> };

/** Read structured config from orc.config.json, validated with Zod. */
async function loadJsonConfig(cwd: string): Promise<JsonConfigResult> {
  const filePath = join(cwd, "orc.config.json");
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    const config = OrcConfigSchema.parse(parsed);
    logger.info("Loaded orc.config.json");
    return { status: "loaded", config };
  } catch (err) {
    if (err instanceof z.ZodError) {
      logger.warn(`Invalid orc.config.json: ${err.issues.map((i) => i.message).join(", ")}`);
      return { status: "invalid", config: OrcConfigSchema.parse({}) };
    } else if (err instanceof SyntaxError) {
      logger.warn(`Malformed JSON in orc.config.json: ${err.message}`);
      return { status: "invalid", config: OrcConfigSchema.parse({}) };
    } else if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      logger.debug("No orc.config.json found, using defaults");
      return { status: "not_found", config: OrcConfigSchema.parse({}) };
    } else {
      logger.warn(`Failed to load orc.config.json: ${err instanceof Error ? err.message : String(err)}`);
      return { status: "invalid", config: OrcConfigSchema.parse({}) };
    }
  }
}
