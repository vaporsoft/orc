/**
 * Spawns Claude Code via the Agent SDK to fix PR feedback.
 *
 * Builds a focused prompt containing only the filtered events,
 * then lets Claude Code read the code, make changes, run lint/tests,
 * and create fixup commits. The orchestrator handles rebase and push.
 */

import {
  query,
  type SDKMessage,
  type SDKResultMessage,
} from "@anthropic-ai/claude-code";
import type { PREvent, CommentAnalysis } from "../types/index.js";
import type { Config } from "../types/config.js";
import { ALLOWED_TOOLS } from "../constants.js";
import { logger } from "../utils/logger.js";

export interface FixResult {
  sessionId: string;
  costUsd: number;
  durationMs: number;
  isError: boolean;
  /** Files changed by the fix. */
  changedFiles: string[];
  errors: string[];
}

export class FixExecutor {
  private config: Config;
  private cwd: string;

  constructor(config: Config, cwd: string) {
    this.config = config;
    this.cwd = cwd;
  }

  /**
   * Build a prompt from the filtered events and analyses, then
   * invoke Claude Code to make the fixes.
   */
  async execute(
    events: PREvent[],
    analyses: CommentAnalysis[],
    abortSignal?: AbortSignal,
  ): Promise<FixResult> {
    const prompt = this.buildPrompt(events, analyses);
    logger.info("Invoking Claude Code to fix feedback", undefined, {
      eventsCount: events.length,
    });
    logger.debug("Fix prompt:\n" + prompt);

    const startTime = Date.now();
    const abortController = new AbortController();

    // Forward external abort signal
    if (abortSignal) {
      abortSignal.addEventListener("abort", () => abortController.abort());
    }

    try {
      const stream = query({
        prompt,
        options: {
          maxTurns: this.config.maxTurns,
          allowedTools: [...ALLOWED_TOOLS],
          permissionMode: "bypassPermissions",
          cwd: this.cwd,
          abortController,
          appendSystemPrompt:
            "You are fixing PR review feedback and CI failures. Make targeted, minimal changes. Create fixup commits (git commit --fixup=HEAD or appropriate parent) for each logical fix. Run lint and typecheck after changes. Do not push — the orchestrator handles that.",
        },
      });

      let resultMessage: SDKResultMessage | null = null;
      let sessionId = "unknown";

      for await (const message of stream) {
        // Capture the session ID from any message
        if (message.session_id) {
          sessionId = message.session_id;
        }

        // Look for the result message
        if (message.type === "result") {
          resultMessage = message as SDKResultMessage;
        }

        // Log assistant messages in verbose mode
        if (this.config?.verbose && message.type === "assistant") {
          const msg = message as SDKMessage;
          logger.debug(`Claude: ${JSON.stringify(msg).slice(0, 200)}`);
        }
      }

      const durationMs = Date.now() - startTime;

      if (!resultMessage) {
        return {
          sessionId,
          costUsd: 0,
          durationMs,
          isError: true,
          changedFiles: [],
          errors: ["No result message received from Claude Code"],
        };
      }

      return {
        sessionId,
        costUsd: resultMessage.total_cost_usd ?? 0,
        durationMs,
        isError: resultMessage.is_error ?? false,
        changedFiles: [],
        errors: resultMessage.is_error
          ? [
              resultMessage.subtype === "success"
                ? resultMessage.result
                : `Session ended: ${resultMessage.subtype}`,
            ]
          : [],
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Claude Code session failed: ${message}`);
      return {
        sessionId: "error",
        costUsd: 0,
        durationMs,
        isError: true,
        changedFiles: [],
        errors: [message],
      };
    }
  }

  private buildPrompt(
    events: PREvent[],
    analyses: CommentAnalysis[],
  ): string {
    const sections: string[] = [];

    sections.push(
      "# PR Feedback to Address\n\nFix the following review comments and CI failures. Make targeted changes and create fixup commits.\n",
    );

    // Group by type
    const ciFailures = events.filter((e) => e.type === "ci_failure");
    const reviewComments = events.filter((e) => e.type === "review_comment");

    if (ciFailures.length > 0) {
      sections.push("## CI Failures (must fix)\n");
      for (const event of ciFailures) {
        sections.push(`### ${event.ciCheck?.name ?? "Unknown check"}`);
        if (event.ciLog) {
          sections.push("```\n" + event.ciLog + "\n```");
        }
        sections.push("");
      }
    }

    if (reviewComments.length > 0) {
      sections.push("## Review Comments\n");
      for (const event of reviewComments) {
        const thread = event.thread;
        if (!thread) continue;

        const analysis = analyses.find((a) => a.threadId === thread.threadId);
        sections.push(
          `### ${thread.path}${thread.line ? `:${thread.line}` : ""} (${analysis?.category ?? "unknown"})`,
        );
        sections.push(`**Comment by @${thread.author}:**`);
        sections.push(thread.body);
        if (thread.diffHunk) {
          sections.push("\n**Diff context:**");
          sections.push("```\n" + thread.diffHunk + "\n```");
        }
        if (analysis?.suggestedAction) {
          sections.push(`\n**Suggested action:** ${analysis.suggestedAction}`);
        }
        sections.push("");
      }
    }

    return sections.join("\n");
  }
}
