/**
 * Parses an ORC.md config file from the repo root.
 *
 * Format:
 *   # Orc
 *   ## Instructions
 *   Free-form text passed to Claude Code as context.
 *   ## Verify
 *   - `yarn lint`
 *   - `yarn typecheck`
 *   ## Auto-fix
 *   - must_fix: true
 *   - should_fix: true
 *   - nice_to_have: false
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RepoConfig } from "../types/index.js";
import { logger } from "../utils/logger.js";

const DEFAULT_CONFIG: RepoConfig = {
  instructions: "",
  verifyCommands: [],
  autoFix: {
    must_fix: true,
    should_fix: true,
    nice_to_have: false,
    verify_and_fix: true,
  },
};

export async function loadRepoConfig(cwd: string): Promise<RepoConfig> {
  const filePath = join(cwd, "ORC.md");
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    logger.debug("No ORC.md found, using defaults");
    return { ...DEFAULT_CONFIG, autoFix: { ...DEFAULT_CONFIG.autoFix } };
  }

  logger.info("Loaded ORC.md config");

  const sections = new Map<string, string>();
  let currentHeading = "";
  const lines = content.split("\n");

  for (const line of lines) {
    const h2Match = line.match(/^## (.+)/);
    if (h2Match) {
      currentHeading = h2Match[1].trim().toLowerCase();
      continue;
    }
    // Skip H1
    if (line.match(/^# /)) continue;

    if (currentHeading) {
      const existing = sections.get(currentHeading) ?? "";
      sections.set(currentHeading, existing + line + "\n");
    }
  }

  const instructions = (sections.get("instructions") ?? "").trim();

  const verifyCommands: string[] = [];
  const verifySection = sections.get("verify") ?? "";
  for (const line of verifySection.split("\n")) {
    const match = line.match(/^-\s*`(.+)`/);
    if (match) {
      verifyCommands.push(match[1]);
    }
  }

  const autoFix = { ...DEFAULT_CONFIG.autoFix };
  const autoFixSection = sections.get("auto-fix") ?? "";
  for (const line of autoFixSection.split("\n")) {
    const match = line.match(/^-\s*(must_fix|should_fix|nice_to_have|verify_and_fix)\s*:\s*(true|false)/);
    if (match) {
      autoFix[match[1] as keyof typeof autoFix] = match[2] === "true";
    }
  }

  return { instructions, verifyCommands, autoFix };
}
