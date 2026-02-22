/**
 * Uses the Claude Code SDK to classify PR review comments by severity.
 * Piggybacks on Claude Code's existing authentication (no separate API key needed).
 */

import { query, type SDKResultMessage } from "@anthropic-ai/claude-code";
import type { CategorizedComment } from "../types/index.js";
import type { FetchedComment } from "./comment-fetcher.js";
import { logger } from "../utils/logger.js";

const ANALYSIS_PROMPT = `You are a code review comment analyzer. Given a PR review comment and its surrounding diff context, determine whether the comment is actionable and should be fixed.

Classify the comment into one of these categories:
- must_fix: Clear bug, security issue, or breaking change that must be addressed
- should_fix: Valid improvement suggestion, style issue, or reasonable request
- nice_to_have: Minor suggestion that could be skipped without issue
- false_positive: Incorrect suggestion, already handled, or not applicable

Respond with JSON only (no markdown fences):
{
  "confidence": <0.0-1.0>,
  "category": "<must_fix|should_fix|nice_to_have|false_positive>",
  "reasoning": "<brief explanation>",
  "suggestedAction": "<what the fix should do>"
}`;

export class CommentCategorizer {
  private cwd: string;
  private confidenceThreshold: number;

  constructor(cwd: string, confidenceThreshold = 0.75) {
    this.cwd = cwd;
    this.confidenceThreshold = confidenceThreshold;
  }

  async categorize(comments: FetchedComment[], abortSignal?: AbortSignal): Promise<CategorizedComment[]> {
    const results: CategorizedComment[] = [];

    for (const { thread } of comments) {
      if (abortSignal?.aborted) break;
      // Conversation comments lack diff context — delegate verification to fix executor
      if (thread.path === "(conversation)") {
        results.push({
          threadId: thread.threadId,
          path: thread.path,
          line: thread.line,
          body: thread.body,
          author: thread.author,
          diffHunk: thread.diffHunk,
          category: "verify_and_fix",
          confidence: 1.0,
          reasoning: "Conversation comment — delegating verification to fix executor",
          suggestedAction: "Verify and fix if applicable",
        });
        continue;
      }

      try {
        const analysis = await this.classifyComment(thread, abortSignal);

        // Override low-confidence inline comments to verify_and_fix
        if (
          analysis.confidence < this.confidenceThreshold &&
          analysis.category !== "must_fix"
        ) {
          results.push({
            threadId: thread.threadId,
            path: thread.path,
            line: thread.line,
            body: thread.body,
            author: thread.author,
            diffHunk: thread.diffHunk,
            category: "verify_and_fix",
            confidence: analysis.confidence,
            reasoning: `[low confidence — verify] ${analysis.reasoning}`,
            suggestedAction: analysis.suggestedAction,
          });
        } else {
          results.push({
            threadId: thread.threadId,
            path: thread.path,
            line: thread.line,
            body: thread.body,
            author: thread.author,
            diffHunk: thread.diffHunk,
            ...analysis,
          });
        }
      } catch (err) {
        logger.warn(`Failed to categorize comment ${thread.id}: ${err}`);
        results.push({
          threadId: thread.threadId,
          path: thread.path,
          line: thread.line,
          body: thread.body,
          author: thread.author,
          diffHunk: thread.diffHunk,
          confidence: 0.5,
          category: "should_fix",
          reasoning: "Analysis failed, defaulting to should_fix",
          suggestedAction: thread.body,
        });
      }
    }

    return results;
  }

  private async classifyComment(
    thread: FetchedComment["thread"],
    abortSignal?: AbortSignal,
  ): Promise<Pick<CategorizedComment, "confidence" | "category" | "reasoning" | "suggestedAction">> {
    const userMessage = `## File: ${thread.path}${thread.line ? ` (line ${thread.line})` : ""}

### Diff Context:
\`\`\`
${thread.diffHunk}
\`\`\`

### Review Comment (by @${thread.author}):
${thread.body}`;

    const prompt = `${ANALYSIS_PROMPT}\n\n${userMessage}`;

    let resultText = "";

    const ac = new AbortController();
    if (abortSignal) {
      abortSignal.addEventListener("abort", () => ac.abort(), { once: true });
    }

    const stream = query({
      prompt,
      options: {
        maxTurns: 1,
        allowedTools: [],
        permissionMode: "bypassPermissions",
        cwd: this.cwd,
        abortController: ac,
      },
    });

    for await (const message of stream) {
      if (message.type === "result") {
        const result = message as SDKResultMessage;
        if (result.subtype === "success") {
          resultText = result.result;
        }
      }
    }

    // Strip markdown fences if present
    const cleaned = resultText.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();

    try {
      const parsed = JSON.parse(cleaned);
      return {
        confidence: Number(parsed.confidence),
        category: parsed.category,
        reasoning: parsed.reasoning,
        suggestedAction: parsed.suggestedAction,
      };
    } catch {
      logger.warn(`Failed to parse categorization response: ${cleaned}`);
      return {
        confidence: 0.5,
        category: "should_fix",
        reasoning: "Failed to parse analysis response",
        suggestedAction: thread.body,
      };
    }
  }
}
