/**
 * `orc init` — generates ORC.md + orc.config.json for the current repo
 * by detecting the project ecosystem and writing sensible defaults.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { detectProject } from "../utils/project-detector.js";

function generateMarkdown(): string {
  return `# Orc

Add repo-specific instructions and context for Claude Code here.
`;
}

interface OrcConfig {
  setup: string[];
  verify: string[];
  allowedCommands: string[];
  autoFix: Record<string, boolean>;
}

function generateConfig(cwd: string): { config: OrcConfig; ecosystem: string } {
  const detected = detectProject(cwd);

  const config: OrcConfig = {
    setup: detected.setupCommands,
    verify: detected.verifyCommands,
    allowedCommands: detected.allowedCommands,
    autoFix: {
      must_fix: true,
      should_fix: true,
      nice_to_have: false,
      verify_and_fix: true,
      needs_clarification: true,
    },
  };

  return { config, ecosystem: detected.ecosystem };
}

export async function initCommand(): Promise<void> {
  const cwd = process.cwd();
  const mdPath = path.join(cwd, "ORC.md");
  const jsonPath = path.join(cwd, "orc.config.json");

  const mdExists = fs.existsSync(mdPath);
  const jsonExists = fs.existsSync(jsonPath);

  if (mdExists && jsonExists) {
    console.log("ORC.md and orc.config.json already exist. Remove them first to re-initialize.");
    process.exit(1);
  }

  const { config, ecosystem } = generateConfig(cwd);

  if (!mdExists) {
    fs.writeFileSync(mdPath, generateMarkdown(), "utf-8");
    console.log("Created ORC.md (instructions)");
  }

  if (!jsonExists) {
    fs.writeFileSync(jsonPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    console.log("Created orc.config.json (config)");
  }

  console.log(`\nDetected: ${ecosystem}`);
  if (config.setup.length > 0) console.log(`  Setup:    ${config.setup.join(", ")}`);
  if (config.verify.length > 0) console.log(`  Verify:   ${config.verify.join(", ")}`);
  if (config.allowedCommands.length > 0) console.log(`  Commands: ${config.allowedCommands.join(", ")}`);
  console.log("\nReview and customize both files for your project.");
}
