/**
 * Uses the Anthropic API (Haiku) for fast, cheap classification of
 * PR review comments. Determines category and confidence for each.
 */

import Anthropic from "@anthropic-ai/sdk";
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
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic();
  }

  async categorize(comments: FetchedComment[]): Promise<CategorizedComment[]> {
    const results: CategorizedComment[] = [];

    for (const { thread } of comments) {
      try {
        const analysis = await this.classifyComment(thread);
        results.push({
          threadId: thread.threadId,
          path: thread.path,
          line: thread.line,
          body: thread.body,
          author: thread.author,
          diffHunk: thread.diffHunk,
          ...analysis,
        });
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
  ): Promise<Pick<CategorizedComment, "confidence" | "category" | "reasoning" | "suggestedAction">> {
    const userMessage = `## File: ${thread.path}${thread.line ? ` (line ${thread.line})` : ""}

### Diff Context:
\`\`\`
${thread.diffHunk}
\`\`\`

### Review Comment (by @${thread.author}):
${thread.body}`;

    const response = await this.client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages: [
        { role: "user", content: `${ANALYSIS_PROMPT}\n\n${userMessage}` },
      ],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";

    try {
      const parsed = JSON.parse(text);
      return {
        confidence: Number(parsed.confidence),
        category: parsed.category,
        reasoning: parsed.reasoning,
        suggestedAction: parsed.suggestedAction,
      };
    } catch {
      logger.warn(`Failed to parse Haiku response: ${text}`);
      return {
        confidence: 0.5,
        category: "should_fix",
        reasoning: "Failed to parse analysis response",
        suggestedAction: thread.body,
      };
    }
  }
}
