/**
 * CLI setup using Commander.
 */

import { createRequire } from "node:module";
import { Command } from "commander";
import { startCommand } from "./commands/start.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

export const cli = new Command()
  .name("orc")
  .description(
    "Automate PR feedback loops — fetch review comments, fix with Claude Code, push, repeat.",
  )
  .version(pkg.version)
  .option("--poll-interval <n>", "Seconds between polls", parseInt)
  .option(
    "--confidence <n>",
    "Min confidence to act on a comment (0-1)",
    parseFloat,
  )
  .option("--model <model>", "Claude model for fixes")
  .option(
    "--session-timeout <n>",
    "Hours before stopping a session (default: 1)",
    parseFloat,
  )
  .option(
    "--claude-timeout <n>",
    "Seconds before killing Claude Code",
    parseInt,
  )
  .option("--dry-run", "Show what would be done without executing")
  .option("--verbose", "Include detailed output")
  .option("--theme <mode>", "Color theme (dark, light)")
  .action(startCommand);
