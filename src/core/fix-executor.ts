/**
 * Spawns Claude Code via the Agent SDK to fix PR feedback.
 *
 * Builds a focused prompt containing only the categorized comments,
 * then lets Claude Code read the code, make changes, run lint/tests,
 * and create fixup commits. The orchestrator handles rebase and push.
 */

import {
  query,
  type SDKMessage,
  type SDKResultMessage,
} from "@anthropic-ai/claude-code";
import type { CategorizedComment, RepoPilotConfig } from "../types/index.js";
import type { Config } from "../types/config.js";
import { ALLOWED_TOOLS } from "../constants.js";
import { logger } from "../utils/logger.js";

export interface FixResult {
  sessionId: string;
  costUsd: number;
  durationMs: number;
  isError: boolean;
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

  async execute(
    comments: CategorizedComment[],
    pilotConfig: RepoPilotConfig,
    abortSignal?: AbortSignal,
  ): Promise<FixResult> {
    const prompt = this.buildPrompt(comments, pilotConfig);
    logger.info("Invoking Claude Code to fix feedback", undefined, {
      commentsCount: comments.length,
    });
    logger.debug("Fix prompt:\n" + prompt);

    const startTime = Date.now();
    const abortController = new AbortController();

    if (abortSignal) {
      abortSignal.addEventListener("abort", () => abortController.abort());
    }

    let systemSuffix =
      `You are fixing PR review feedback. Make targeted, minimal changes.

After making changes, commit them. Prefer fixup commits when you can confidently identify the parent commit that introduced the code being fixed: git commit --fixup=<sha>

If you are not confident which commit to fixup against (e.g. the change spans multiple commits, or you're adding something new), make a regular descriptive commit instead.

Do not push — the orchestrator handles that.`;

    if (pilotConfig.instructions) {
      systemSuffix += `\n\n## Repo-Specific Instructions\n${pilotConfig.instructions}`;
    }

    if (pilotConfig.verifyCommands.length > 0) {
      systemSuffix += `\n\nAfter making changes, run these verification commands:\n${pilotConfig.verifyCommands.map((c) => `- \`${c}\``).join("\n")}`;
    } else {
      systemSuffix += "\n\nRun lint and typecheck after changes if the project supports it.";
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
          appendSystemPrompt: systemSuffix,
        },
      });

      let resultMessage: SDKResultMessage | null = null;
      let sessionId = "unknown";

      for await (const message of stream) {
        if (message.session_id) {
          sessionId = message.session_id;
        }

        if (message.type === "result") {
          resultMessage = message as SDKResultMessage;
        }

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
    comments: CategorizedComment[],
    pilotConfig: RepoPilotConfig,
  ): string {
    const sections: string[] = [];

    sections.push(
      "# PR Review Comments to Address\n\nFix the following review comments. Make targeted changes and create fixup commits.\n",
    );

    // Group by severity
    const mustFix = comments.filter((c) => c.category === "must_fix");
    const shouldFix = comments.filter((c) => c.category === "should_fix");
    const niceToHave = comments.filter((c) => c.category === "nice_to_have");

    const renderGroup = (label: string, items: CategorizedComment[]) => {
      if (items.length === 0) return;
      sections.push(`## ${label}\n`);
      for (const comment of items) {
        sections.push(
          `### ${comment.path}${comment.line ? `:${comment.line}` : ""}`,
        );
        sections.push(`**Comment by @${comment.author}:**`);
        sections.push(comment.body);
        if (comment.diffHunk) {
          sections.push("\n**Diff context:**");
          sections.push("```\n" + comment.diffHunk + "\n```");
        }
        if (comment.suggestedAction) {
          sections.push(`\n**Suggested action:** ${comment.suggestedAction}`);
        }
        sections.push("");
      }
    };

    renderGroup("Must Fix", mustFix);
    renderGroup("Should Fix", shouldFix);
    renderGroup("Nice to Have", niceToHave);

    if (pilotConfig.instructions) {
      sections.push(`## Additional Context\n\n${pilotConfig.instructions}\n`);
    }

    return sections.join("\n");
  }
}
