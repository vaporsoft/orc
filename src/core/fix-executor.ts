/**
 * Spawns Claude Code via the Agent SDK to fix PR feedback.
 *
 * Builds a focused prompt containing only the categorized comments,
 * then lets Claude Code read the code, make changes, run lint/tests,
 * and create fixup commits. The orchestrator handles rebase and push.
 */

import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  query,
  type SDKMessage,
  type SDKResultMessage,
} from "@anthropic-ai/claude-code";
import type { CategorizedComment, RepoConfig } from "../types/index.js";
import type { Config } from "../types/config.js";
import { ALLOWED_TOOLS } from "../constants.js";
import { logger } from "../utils/logger.js";

export interface VerifyOutcome {
  status: "fixed" | "not_applicable" | "unknown";
  summary?: string;
  reason?: string;
}

export interface FixResult {
  sessionId: string;
  costUsd: number;
  durationMs: number;
  isError: boolean;
  changedFiles: string[];
  errors: string[];
  verifyResults: Map<string, VerifyOutcome>;
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
    repoConfig: RepoConfig,
    abortSignal?: AbortSignal,
    onActivity?: (line: string) => void,
  ): Promise<FixResult> {
    const prompt = this.buildPrompt(comments, repoConfig);
    logger.info("Invoking Claude Code to fix feedback", undefined, {
      commentsCount: comments.length,
    });
    logger.debug("Fix prompt:\n" + prompt);

    const systemSuffix = this.buildSystemSuffix(repoConfig, "review");
    const result = await this.executeClaude(prompt, systemSuffix, abortSignal, onActivity, "Claude session");

    // Add verify results for review feedback
    result.verifyResults = await this.readVerifyResults(comments);
    return result;
  }

  /** Execute a conflict resolution fix, given context about the merge conflicts. */
  async executeConflictFix(
    conflictContext: string,
    repoConfig: RepoConfig,
    abortSignal?: AbortSignal,
    onActivity?: (line: string) => void,
  ): Promise<FixResult> {
    const prompt = this.buildConflictPrompt(conflictContext);
    logger.info("Invoking Claude Code to resolve merge conflicts");
    logger.debug("Conflict fix prompt:\n" + prompt);

    const systemSuffix = this.buildSystemSuffix(repoConfig, "conflict");
    return this.executeClaude(prompt, systemSuffix, abortSignal, onActivity, "Claude conflict resolution session");
  }

  /** Build system suffix based on execution mode and pilot config. */
  private buildSystemSuffix(repoConfig: RepoConfig, mode: "review" | "ci" | "conflict"): string {
    let systemSuffix = mode === "conflict"
      ? `You are resolving merge conflicts during a git rebase. The rebase is paused with conflict markers (<<<<<<< / ======= / >>>>>>>) in the listed files. Read each conflicting file, understand both sides, and edit them to produce the correct merged result with all conflict markers removed.

Do NOT run git commands (no git add, commit, rebase --continue, etc). Just edit the files. The orchestrator handles staging and continuing the rebase.`
      : mode === "review"
      ? `You are fixing PR review feedback. Make targeted, minimal changes.

After making changes, commit them. Prefer fixup commits when you can confidently identify the parent commit that introduced the code being fixed: git commit --fixup=<sha>

If you are not confident which commit to fixup against (e.g. the change spans multiple commits, or you're adding something new), make a regular descriptive commit instead.

Do not push — the orchestrator handles that.`
      : `You are fixing CI/CD pipeline failures. Analyze the logs, identify the root cause, and make targeted, minimal changes to fix the build/test failures.

After making changes, commit them with a descriptive message prefixed with "fix(ci): ".

Do not push — the orchestrator handles that.`;

    if (repoConfig.instructions) {
      systemSuffix += `\n\n## Repo-Specific Instructions\n${repoConfig.instructions}`;
    }

    if (repoConfig.verifyCommands.length > 0 && mode !== "conflict") {
      systemSuffix += `\n\nAfter making changes, run these verification commands:\n${repoConfig.verifyCommands.map((c) => `- \`${c}\``).join("\n")}`;
    } else if (mode === "review") {
      systemSuffix += "\n\nRun lint and typecheck after changes if the project supports it.";
    }

    return systemSuffix;
  }

  /** Shared Claude SDK invocation logic. */
  private async executeClaude(
    prompt: string,
    systemSuffix: string,
    abortSignal?: AbortSignal,
    onActivity?: (line: string) => void,
    sessionLabel = "Claude Code session"
  ): Promise<FixResult> {
    const startTime = Date.now();
    const abortController = new AbortController();
    const timeoutMs = this.config.claudeTimeout * 1000;
    const timeout = setTimeout(() => {
      logger.info(`${sessionLabel} timed out, aborting`);
      abortController.abort();
    }, timeoutMs);

    if (abortSignal) {
      abortSignal.addEventListener("abort", () => abortController.abort());
    }

    let sessionId = "unknown";

    try {
      const stream = query({
        prompt,
        options: {
          allowedTools: [...ALLOWED_TOOLS],
          permissionMode: "bypassPermissions",
          cwd: this.cwd,
          abortController,
          appendSystemPrompt: systemSuffix,
        },
      });

      let resultMessage: SDKResultMessage | null = null;

      for await (const message of stream) {
        if (message.session_id) {
          sessionId = message.session_id;
        }

        if (message.type === "result") {
          resultMessage = message as SDKResultMessage;
        }

        if (message.type === "assistant" && onActivity) {
          const msg = message as SDKMessage;
          const content = (msg as Record<string, unknown>).message as
            | { content?: Array<{ type: string; name?: string; text?: string; input?: Record<string, unknown> }> }
            | undefined;
          if (content?.content) {
            for (const block of content.content) {
              if (block.type === "tool_use" && block.name) {
                onActivity(this.summarizeTool(block.name, block.input));
              } else if (block.type === "text" && block.text) {
                const lastLine = block.text.trim().split("\n").pop()?.trim();
                if (lastLine && lastLine.length > 0) {
                  const truncated = lastLine.length > 120 ? lastLine.slice(0, 119) + "…" : lastLine;
                  onActivity(truncated);
                }
              }
            }
          }
        }

        if (this.config?.verbose && message.type === "assistant") {
          const msg = message as SDKMessage;
          logger.debug(`Claude: ${JSON.stringify(msg).slice(0, 200)}`);
        }
      }

      clearTimeout(timeout);
      const durationMs = Date.now() - startTime;

      if (!resultMessage) {
        return {
          sessionId,
          costUsd: 0,
          durationMs,
          isError: true,
          changedFiles: [],
          errors: ["No result message received from Claude Code"],
          verifyResults: new Map(),
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
        verifyResults: new Map(),
      };
    } catch (err) {
      clearTimeout(timeout);
      const durationMs = Date.now() - startTime;
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`${sessionLabel} failed: ${message}`);
      return {
        sessionId,
        costUsd: 0,
        durationMs,
        isError: true,
        changedFiles: [],
        errors: [message],
        verifyResults: new Map(),
      };
    }
  }

  /** Execute a CI-specific fix cycle, given context about the failures. */
  async executeCIFix(
    ciContext: string,
    repoConfig: RepoConfig,
    abortSignal?: AbortSignal,
    onActivity?: (line: string) => void,
  ): Promise<FixResult> {
    const prompt = this.buildCIPrompt(ciContext);
    logger.info("Invoking Claude Code to fix CI failures");
    logger.debug("CI fix prompt:\n" + prompt);

    const systemSuffix = this.buildSystemSuffix(repoConfig, "ci");
    return this.executeClaude(prompt, systemSuffix, abortSignal, onActivity, "Claude CI fix session");
  }

  private buildConflictPrompt(conflictContext: string): string {
    const sections: string[] = [];

    sections.push(
      "# Merge Conflict Resolution\n\nA git rebase is in progress and has paused due to conflicts. The conflicting files contain <<<<<<< / ======= / >>>>>>> markers. Read each file, understand both sides, and edit to produce the correct merged result.\n",
    );

    sections.push(conflictContext);

    sections.push("\nEdit the files to remove all conflict markers. Do not run any git commands.\n");

    return sections.join("\n");
  }

  private buildCIPrompt(ciContext: string): string {
    const sections: string[] = [];

    sections.push(
      "# CI Failure Fix\n\nThe CI pipeline is failing after the latest push. Fix the failures described below.\n",
    );

    sections.push(ciContext);

    sections.push("\nMake targeted fixes and create commits to resolve these CI failures.\n");

    return sections.join("\n");
  }

  private buildPrompt(
    comments: CategorizedComment[],
    repoConfig: RepoConfig,
  ): string {
    const sections: string[] = [];

    sections.push(
      "# PR Review Comments to Address\n\nFix the following review comments. Make targeted changes and create fixup commits.\n",
    );

    // Group by severity
    const verifyAndFix = comments.filter((c) => c.category === "verify_and_fix");
    const mustFix = comments.filter((c) => c.category === "must_fix");
    const shouldFix = comments.filter((c) => c.category === "should_fix");
    const niceToHave = comments.filter((c) => c.category === "nice_to_have");

    const renderComment = (comment: CategorizedComment, filterSuggestedAction = false) => {
      const parts: string[] = [];
      parts.push(
        `### ${comment.path}${comment.line ? `:${comment.line}` : ""}`,
      );
      parts.push(`**Comment by @${comment.author}:**`);
      parts.push(comment.body);
      if (comment.diffHunk) {
        parts.push("\n**Diff context:**");
        parts.push("```\n" + comment.diffHunk + "\n```");
      }
      if (comment.suggestedAction && (!filterSuggestedAction || comment.suggestedAction !== "Verify and fix if applicable")) {
        parts.push(`\n**Suggested action:** ${comment.suggestedAction}`);
      }
      parts.push("");
      return parts;
    };

    const renderGroup = (label: string, items: CategorizedComment[]) => {
      if (items.length === 0) return;
      sections.push(`## ${label}\n`);
      for (const comment of items) {
        sections.push(...renderComment(comment));
      }
    };

    // Render verify-and-fix first with special instructions
    if (verifyAndFix.length > 0) {
      sections.push(`## Verify and Fix\n`);
      sections.push(
        `For each comment below, first read the relevant file(s) and verify the request is valid.
If valid, make the fix and commit. If not applicable, skip it.\n`,
      );
      for (const comment of verifyAndFix) {
        sections.push(...renderComment(comment, true));
      }
    }

    renderGroup("Must Fix", mustFix);
    renderGroup("Should Fix", shouldFix);
    renderGroup("Nice to Have", niceToHave);

    // Results file instruction for verify-and-fix comments
    if (verifyAndFix.length > 0) {
      sections.push(`## Verify Results\n`);
      sections.push(
        `After processing all "Verify and Fix" comments above, write a JSON file \`.orc-verify.json\`
at the repo root with this exact structure:
\`\`\`json
{
  "<threadId>": { "status": "fixed", "summary": "<what you did>" },
  "<threadId>": { "status": "not_applicable", "reason": "<why>" }
}
\`\`\`
Include an entry for every Verify and Fix comment. Do not skip any.
IMPORTANT: Do not add or commit the \`.orc-verify.json\` file to git - it's a temporary results file that will be automatically cleaned up after processing.
The thread IDs are:\n`,
      );
      for (const comment of verifyAndFix) {
        sections.push(`- \`${comment.threadId}\` — ${comment.path}${comment.line ? `:${comment.line}` : ""}: ${comment.body.slice(0, 80)}${comment.body.length > 80 ? "..." : ""}`);
      }
      sections.push("");
    }

    if (repoConfig.instructions) {
      sections.push(`## Additional Context\n\n${repoConfig.instructions}\n`);
    }

    return sections.join("\n");
  }

  private summarizeTool(name: string, input?: Record<string, unknown>): string {
    const path = input?.file_path ?? input?.path ?? "";
    const pathStr = typeof path === "string" ? path.replace(/^.*\//, "") : "";
    switch (name) {
      case "Read": return `Reading ${pathStr || "file"}`;
      case "Edit": return `Editing ${pathStr || "file"}`;
      case "Write": return `Writing ${pathStr || "file"}`;
      case "Bash": {
        const cmd = typeof input?.command === "string" ? input.command : "";
        const short = cmd.length > 80 ? cmd.slice(0, 79) + "…" : cmd;
        return `Running: ${short || "command"}`;
      }
      case "Grep": {
        const pattern = typeof input?.pattern === "string" ? input.pattern : "";
        return `Searching: ${pattern || "pattern"}`;
      }
      case "Glob": {
        const pattern = typeof input?.pattern === "string" ? input.pattern : "";
        return `Finding: ${pattern || "files"}`;
      }
      default: return `Using ${name}`;
    }
  }

  private async readVerifyResults(
    comments: CategorizedComment[],
  ): Promise<Map<string, VerifyOutcome>> {
    const verifyComments = comments.filter((c) => c.category === "verify_and_fix");
    if (verifyComments.length === 0) return new Map();

    const filePath = join(this.cwd, ".orc-verify.json");
    try {
      const raw = await readFile(filePath, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, VerifyOutcome>;

      // Clean up the file
      await unlink(filePath).catch(() => {});

      const results = new Map<string, VerifyOutcome>();
      for (const [threadId, outcome] of Object.entries(parsed)) {
        results.set(threadId, outcome);
      }
      return results;
    } catch {
      logger.debug("No .orc-verify.json found or failed to parse, defaulting all to unknown");
      // Fall back: mark all verify_and_fix comments as unknown status
      const results = new Map<string, VerifyOutcome>();
      for (const comment of verifyComments) {
        results.set(comment.threadId, { status: "unknown", reason: "Verification results not found" });
      }
      return results;
    }
  }
}
