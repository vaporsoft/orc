/**
 * Replies to addressed review threads via the GitHub GraphQL API.
 * Marks threads as resolved after replying.
 */

import { GHClient } from "../github/gh-client.js";
import type { PREvent, CommentAnalysis } from "../types/index.js";
import { logger } from "../utils/logger.js";

export class ThreadResponder {
  private ghClient: GHClient;
  private branch: string;

  constructor(ghClient: GHClient, branch: string) {
    this.ghClient = ghClient;
    this.branch = branch;
  }

  /**
   * Reply to all addressed review threads, indicating they've been
   * fixed. Optionally resolve the threads.
   */
  async replyToAddressed(
    events: PREvent[],
    analyses: CommentAnalysis[],
    resolveThreads = true,
  ): Promise<void> {
    const reviewEvents = events.filter(
      (e) => e.type === "review_comment" && e.thread,
    );

    for (const event of reviewEvents) {
      const thread = event.thread!;
      const analysis = analyses.find((a) => a.threadId === thread.threadId);

      if (!analysis || analysis.category === "false_positive") {
        continue;
      }

      try {
        // Reply to the thread
        await this.ghClient.addThreadReply(
          thread.threadId,
          `Addressed by PR Pilot (${analysis.category}, confidence: ${analysis.confidence.toFixed(2)}).`,
        );

        // Resolve the thread
        if (resolveThreads) {
          await this.ghClient.resolveThread(thread.threadId);
        }

        logger.info(
          `Replied to thread on ${thread.path} and resolved`,
          this.branch,
        );
      } catch (err) {
        logger.warn(
          `Failed to reply/resolve thread ${thread.threadId}: ${err}`,
          this.branch,
        );
      }
    }
  }

  /**
   * Reply to skipped threads explaining why they were skipped.
   */
  async replyToSkipped(
    events: PREvent[],
    analyses: CommentAnalysis[],
    confidenceThreshold: number,
  ): Promise<void> {
    for (const event of events) {
      if (event.type !== "review_comment" || !event.thread) continue;

      const analysis = analyses.find(
        (a) => a.threadId === event.thread!.threadId,
      );
      if (!analysis) continue;

      if (
        analysis.confidence < confidenceThreshold ||
        analysis.category === "false_positive"
      ) {
        try {
          await this.ghClient.addThreadReply(
            event.thread.threadId,
            `PR Pilot skipped this comment (${analysis.category}, confidence: ${analysis.confidence.toFixed(2)}): ${analysis.reasoning}`,
          );
          logger.debug(
            `Replied to skipped thread on ${event.thread.path}`,
            this.branch,
          );
        } catch (err) {
          logger.warn(
            `Failed to reply to skipped thread: ${err}`,
            this.branch,
          );
        }
      }
    }
  }
}
