/**
 * `orc init` — generates an ORC.md config file for the current repo
 * by detecting the project ecosystem and writing sensible defaults.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { detectProject } from "../utils/project-detector.js";

function renderList(items: string[]): string {
  if (items.length === 0) return "";
  return items.map((item) => `- \`${item}\``).join("\n");
}

function generateTemplate(cwd: string): string {
  const detected = detectProject(cwd);
  const sections: string[] = [];

  sections.push("# Orc\n");

  sections.push("## Instructions\n");
  sections.push("<!-- Add repo-specific context for Claude Code here. -->\n");

  if (detected.setupCommands.length > 0) {
    sections.push("## Setup\n");
    sections.push(renderList(detected.setupCommands) + "\n");
  }

  if (detected.verifyCommands.length > 0) {
    sections.push("## Verify\n");
    sections.push(renderList(detected.verifyCommands) + "\n");
  }

  if (detected.allowedCommands.length > 0) {
    sections.push("## Allowed Commands\n");
    sections.push(renderList(detected.allowedCommands) + "\n");
  }

  sections.push("## Auto-fix\n");
  sections.push("- must_fix: true");
  sections.push("- should_fix: true");
  sections.push("- nice_to_have: false");
  sections.push("- verify_and_fix: true");
  sections.push("- needs_clarification: true\n");

  return sections.join("\n");
}

export async function initCommand(): Promise<void> {
  const cwd = process.cwd();
  const filePath = path.join(cwd, "ORC.md");

  if (fs.existsSync(filePath)) {
    console.log("ORC.md already exists. Remove it first to re-initialize.");
    process.exit(1);
  }

  const detected = detectProject(cwd);
  const content = generateTemplate(cwd);

  fs.writeFileSync(filePath, content, "utf-8");

  console.log(`Created ORC.md (detected: ${detected.ecosystem})\n`);

  if (detected.setupCommands.length > 0) {
    console.log(`  Setup:    ${detected.setupCommands.join(", ")}`);
  }
  if (detected.verifyCommands.length > 0) {
    console.log(`  Verify:   ${detected.verifyCommands.join(", ")}`);
  }
  if (detected.allowedCommands.length > 0) {
    console.log(`  Commands: ${detected.allowedCommands.join(", ")}`);
  }

  console.log("\nReview and customize ORC.md for your project.");
}
