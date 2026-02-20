/**
 * Fetches review comments from GitHub — both inline review threads
 * and top-level PR conversation comments.
 * Filters out resolved, outdated, and already-replied-to comments.
 *
 * Since PR Pilot runs under the user's own GitHub account, we can't
 * detect bot replies by author login. Instead we detect them by the
 * "PR Pilot" signature in the comment body.
 */

import { GHClient } from "../github/gh-client.js";
import type { GHReviewThread } from "../github/types.js";
import type { ReviewThread } from "../types/index.js";
import { logger } from "../utils/logger.js";

/** Signature PR Pilot leaves in every reply. */
const BOT_SIGNATURE = "PR Pilot";

function isPilotReply(body: string): boolean {
  return body.includes(BOT_SIGNATURE);
}

export interface FetchedComment {
  thread: ReviewThread;
  /** Present for inline review threads, null for PR conversation comments. */
  rawThread: GHReviewThread | null;
}

export class CommentFetcher {
  private ghClient: GHClient;
  private prNumber: number;
  private branch: string;

  constructor(ghClient: GHClient, prNumber: number, _botLogin: string, branch: string) {
    this.ghClient = ghClient;
    this.prNumber = prNumber;
    this.branch = branch;
  }

  /** Fetch all actionable comments: unresolved review threads + PR conversation comments. */
  async fetch(): Promise<FetchedComment[]> {
    const [threadComments, prComments] = await Promise.all([
      this.fetchReviewThreads(),
      this.fetchPRConversationComments(),
    ]);

    const results = [...threadComments, ...prComments];
    logger.info(
      `Fetched ${results.length} comments (${threadComments.length} inline, ${prComments.length} conversation)`,
      this.branch,
    );
    return results;
  }

  /** Lightweight count for the TUI badge. */
  async countUnresolved(): Promise<number> {
    const [threadCount, prCount] = await Promise.all([
      this.countReviewThreads(),
      this.countPRConversationComments(),
    ]);
    return threadCount + prCount;
  }

  private async fetchReviewThreads(): Promise<FetchedComment[]> {
    const threads = await this.ghClient.getReviewThreads(this.prNumber);
    const results: FetchedComment[] = [];

    for (const thread of threads) {
      if (thread.isResolved || thread.isOutdated) continue;

      const firstComment = thread.comments.nodes[0];
      if (!firstComment) continue;

      // Skip threads where PR Pilot has already replied
      const alreadyReplied = thread.comments.nodes.some(
        (c) => isPilotReply(c.body),
      );
      if (alreadyReplied) {
        logger.debug(`Skipping thread ${thread.id} — already replied`, this.branch);
        continue;
      }

      const body = thread.comments.nodes.map((c) => c.body).join("\n\n---\n\n");
      results.push({
        thread: {
          id: firstComment.id,
          threadId: thread.id,
          path: firstComment.path,
          line: firstComment.line,
          body,
          author: firstComment.author.login,
          isResolved: thread.isResolved,
          diffHunk: firstComment.diffHunk,
          createdAt: firstComment.createdAt,
        },
        rawThread: thread,
      });
    }

    return results;
  }

  private async fetchPRConversationComments(): Promise<FetchedComment[]> {
    const comments = await this.ghClient.getPRComments(this.prNumber);
    const results: FetchedComment[] = [];

    for (const comment of comments) {
      // Skip PR Pilot's own replies
      if (isPilotReply(comment.body)) continue;

      // Check if a later PR Pilot reply addresses this comment
      const alreadyReplied = comments.some(
        (c) =>
          isPilotReply(c.body) &&
          c.createdAt > comment.createdAt,
      );
      if (alreadyReplied) {
        logger.debug(`Skipping PR comment ${comment.id} — already replied`, this.branch);
        continue;
      }

      results.push({
        thread: {
          id: comment.id,
          threadId: comment.id,
          path: "(conversation)",
          line: null,
          body: comment.body,
          author: comment.author.login,
          isResolved: false,
          diffHunk: "",
          createdAt: comment.createdAt,
        },
        rawThread: null,
      });
    }

    return results;
  }

  private async countReviewThreads(): Promise<number> {
    const threads = await this.ghClient.getReviewThreads(this.prNumber);
    let count = 0;
    for (const thread of threads) {
      if (thread.isResolved || thread.isOutdated) continue;
      const firstComment = thread.comments.nodes[0];
      if (!firstComment) continue;
      const alreadyReplied = thread.comments.nodes.some(
        (c) => isPilotReply(c.body),
      );
      if (!alreadyReplied) count++;
    }
    return count;
  }

  private async countPRConversationComments(): Promise<number> {
    const comments = await this.ghClient.getPRComments(this.prNumber);
    let count = 0;
    for (const comment of comments) {
      if (isPilotReply(comment.body)) continue;
      const alreadyReplied = comments.some(
        (c) =>
          isPilotReply(c.body) &&
          c.createdAt > comment.createdAt,
      );
      if (!alreadyReplied) count++;
    }
    return count;
  }
}
