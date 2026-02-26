/**
 * Uses the Claude Code SDK to classify PR review comments by severity.
 * Piggybacks on Claude Code's existing authentication (no separate API key needed).
 */

import { query, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { CategorizedComment } from "../types/index.js";
import type { FetchedComment } from "./comment-fetcher.js";
import { logger } from "../utils/logger.js";

const ANALYSIS_PROMPT = `You are a code review comment analyzer. Given a PR review comment and its surrounding diff context, determine whether the comment is actionable and should be fixed.

Classify the comment into one of these categories:
- must_fix: Clear bug, security issue, or breaking change that must be addressed
- should_fix: Valid improvement suggestion, style issue, or reasonable request (includes dead code, unused exports, unnecessary complexity)
- nice_to_have: Minor suggestion that could be skipped without issue
- needs_clarification: The comment raises a potentially valid concern but is too ambiguous to act on — you cannot determine what specific change the reviewer wants, or whether the concern applies without more context from the reviewer
- false_positive: The reviewer is factually wrong — the issue they describe does not exist in the code (e.g. they misread the code, the problem is already handled elsewhere, or the suggestion would break correct behavior)

## Bias toward technical correctness

When a reviewer raises a concern that involves a real failure mode — data corruption, race conditions, missing transactions, incorrect error handling, silent data loss, security holes — lean toward should_fix or must_fix even if the current code "works most of the time." The fact that a bug is unlikely does not make the suggestion low-priority. Correctness concerns are cheap to fix now and expensive to debug later.

Apply the same standard to tests. A test that reimplements production logic locally, mocks away the code under test, or cannot detect regressions when the real code changes is a should_fix — the failure mode is false confidence (the test passes while the production code is broken). Tests that only verify a local copy of logic rather than exercising real code paths are not "style preferences."

However, do NOT blindly escalate large architectural refactors that have no concrete failure mode. If a reviewer is pushing a pattern preference (e.g. "rewrite this to use the repository pattern", "this should use event sourcing") without identifying a specific bug or failure scenario, that is nice_to_have at most. The test: can the reviewer point to a realistic scenario where the current code produces a wrong result or fails? If yes, it's should_fix or higher. If the argument is purely about code aesthetics or architectural philosophy, it's nice_to_have.

## Guarding against false dismissals

Be rigorous about false_positive. A comment is only a false positive if the reviewer's factual claim is incorrect. These are NOT false positives:
- Dead code or unused methods (even if they "might be useful later" — that is speculative)
- Style or naming improvements (these are valid suggestions)
- Requests to remove unnecessary complexity
- Suggestions the reviewer is correct about but that seem low-priority

When in doubt between false_positive and should_fix, choose should_fix.
When in doubt between nice_to_have and should_fix, consider whether a real failure mode exists.

Respond with JSON only (no markdown fences):
{
  "confidence": <0.0-1.0>,
  "category": "<must_fix|should_fix|nice_to_have|needs_clarification|false_positive>",
  "reasoning": "<brief explanation>",
  "suggestedAction": "<what the fix should do>",
  "clarificationQuestion": "<only when category is needs_clarification: a specific, concise question to ask the reviewer>"
}`;

export interface CategorizationResult {
  comments: CategorizedComment[];
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export class CommentCategorizer {
  private cwd: string;
  private confidenceThreshold: number;

  constructor(cwd: string, confidenceThreshold = 0.75) {
    this.cwd = cwd;
    this.confidenceThreshold = confidenceThreshold;
  }

  async categorize(comments: FetchedComment[], abortSignal?: AbortSignal): Promise<CategorizationResult> {
    const results: CategorizedComment[] = [];
    let totalCostUsd = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const { thread, rawThread } of comments) {
      if (abortSignal?.aborted) break;

      try {
        const { analysis, costUsd, inputTokens, outputTokens } = await this.classifyComment(thread, abortSignal);
        totalCostUsd += costUsd;
        totalInputTokens += inputTokens;
        totalOutputTokens += outputTokens;

        // Cap clarifications at one round per thread: if Orc has already asked
        // a clarification question, promote to should_fix instead of asking again.
        // We detect prior clarification by looking for the signature marker in
        // any previous Orc reply (rawThread contains all comments including Orc's).
        const hasAskedClarification = rawThread?.comments.nodes.some(
          (c) => /^\*Orc — needs_clarification \(confidence: [\d.]+\)\*$/m.test(c.body),
        );
        if (analysis.category === "needs_clarification" && hasAskedClarification) {
          analysis.category = "should_fix";
          analysis.reasoning = `[follow-up received — attempting fix] ${analysis.reasoning}`;
          delete analysis.clarificationQuestion;
        }

        // Override low-confidence inline comments to verify_and_fix
        // (but not needs_clarification — those should stay as-is)
        if (
          analysis.confidence < this.confidenceThreshold &&
          analysis.category !== "must_fix" &&
          analysis.category !== "needs_clarification"
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
            replies: thread.replies,
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
            replies: thread.replies,
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
          replies: thread.replies,
        });
      }
    }

    return { comments: results, costUsd: totalCostUsd, inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
  }

  private async classifyComment(
    thread: FetchedComment["thread"],
    abortSignal?: AbortSignal,
  ): Promise<{
    analysis: Pick<CategorizedComment, "confidence" | "category" | "reasoning" | "suggestedAction" | "clarificationQuestion">;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
  }> {
    const userMessage = `## File: ${thread.path}${thread.line ? ` (line ${thread.line})` : ""}

### Diff Context:
\`\`\`
${thread.diffHunk}
\`\`\`

### Review Comment (by @${thread.author}):
${thread.body}`;

    const prompt = `${ANALYSIS_PROMPT}\n\n${userMessage}`;

    let resultText = "";
    let costUsd = 0;
    let inputTokens = 0;
    let outputTokens = 0;

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
        costUsd = result.total_cost_usd ?? 0;
        inputTokens = result.usage?.input_tokens ?? 0;
        outputTokens = result.usage?.output_tokens ?? 0;
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
        analysis: {
          confidence: Number(parsed.confidence),
          category: parsed.category,
          reasoning: parsed.reasoning,
          suggestedAction: parsed.suggestedAction,
          ...(parsed.clarificationQuestion ? { clarificationQuestion: parsed.clarificationQuestion } : {}),
        },
        costUsd,
        inputTokens,
        outputTokens,
      };
    } catch {
      logger.warn(`Failed to parse categorization response: ${cleaned}`);
      return {
        analysis: {
          confidence: 0.5,
          category: "should_fix",
          reasoning: "Failed to parse analysis response",
          suggestedAction: thread.body,
        },
        costUsd,
        inputTokens,
        outputTokens,
      };
    }
  }
}
