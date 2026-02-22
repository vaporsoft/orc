/**
 * CLI setup using Commander.
 */

import { Command } from "commander";
import { startCommand } from "./commands/start.js";

export const cli = new Command()
  .name("orc")
  .description(
    "Automate PR feedback loops — fetch review comments, fix with Claude Code, push, repeat.",
  )
  .version("0.1.0")
  .option("--poll-interval <n>", "Seconds between polls", parseInt)
  .option(
    "--confidence <n>",
    "Min confidence to act on a comment (0-1)",
    parseFloat,
  )
  .option("--model <model>", "Claude model for fixes")
  .option(
    "--session-timeout <n>",
    "Hours before stopping a watch session (0 = unlimited, default: unlimited)",
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
