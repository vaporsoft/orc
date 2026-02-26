/**
 * Fetches inline review threads from GitHub.
 * Filters out resolved, outdated, and already-replied-to threads.
 * Only processes the first comment in each thread (ignores follow-ups).
 *
 * Since Orc runs under the user's own GitHub account, we can't
 * detect bot replies by author login. Instead we detect them by the
 * "Orc" signature in the comment body.
 */

import { GHClient } from "../github/gh-client.js";
import type { GHReviewThread } from "../github/types.js";
import type { ReviewThread, ThreadReply } from "../types/index.js";
import { logger } from "../utils/logger.js";

/** Signature Orc leaves in every reply — e.g. "*Orc — bug_fix (confidence: 0.95)*" */
const BOT_SIGNATURE_RE = /^\*Orc — .+ \(confidence: [\d.]+\)\*$/m;

function isOrcReply(body: string): boolean {
  return BOT_SIGNATURE_RE.test(body);
}


/** GitHub bot account — author login ends with [bot] (e.g. "claude[bot]", "copilot[bot]"). */
function isBotAuthor(login: string): boolean {
  return login.endsWith("[bot]");
}

export interface FetchedComment {
  thread: ReviewThread;
  rawThread: GHReviewThread;
}

export interface ThreadCounts {
  resolved: number;
  total: number;
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

  /** Fetch actionable comments and thread counts in a single pass. */
  async fetchWithCounts(): Promise<{
    comments: FetchedComment[];
    threadCounts: ThreadCounts;
    /** Resolved thread IDs that still contain an ORC reply (for deleted-reply detection). */
    orcRepliedResolvedThreadIds: string[];
    /** Resolved thread IDs that do NOT contain an ORC reply. */
    resolvedNoOrcReplyThreadIds: string[];
    /** Resolved thread IDs where a non-orc comment was posted after orc's last reply (follow-up detection). */
    followUpResolvedThreadIds: string[];
  }> {
    const allThreads = await this.ghClient.getReviewThreads(this.prNumber);

    // Count resolved/total from the full unfiltered list
    let resolved = 0;
    const orcRepliedResolvedThreadIds: string[] = [];
    const resolvedNoOrcReplyThreadIds: string[] = [];
    const followUpResolvedThreadIds: string[] = [];
    for (const thread of allThreads) {
      if (thread.isResolved) {
        resolved++;
        // Skip threads with truncated comments (>100) — we can't reliably detect
        // ORC replies beyond the first 100, so treat them as unknown to avoid
        // false unresolves.
        if (thread.comments.pageInfo.hasNextPage) {
          continue;
        }
        const lastOrcReplyAt = thread.comments.nodes
          .filter((c) => isOrcReply(c.body))
          .reduce<string | null>(
            (latest, c) => (!latest || c.createdAt > latest ? c.createdAt : latest),
            null,
          );
        if (lastOrcReplyAt !== null) {
          orcRepliedResolvedThreadIds.push(thread.id);
          // Detect follow-up: a non-orc, non-bot comment posted after orc's last reply
          const hasFollowUp = thread.comments.nodes.some(
            (c) => !isOrcReply(c.body) && !isBotAuthor(c.author?.login ?? "") && c.createdAt > lastOrcReplyAt,
          );
          if (hasFollowUp) {
            followUpResolvedThreadIds.push(thread.id);
          }
        } else {
          resolvedNoOrcReplyThreadIds.push(thread.id);
        }
      }
    }
    const threadCounts: ThreadCounts = { resolved, total: allThreads.length };

    // Filter to actionable threads
    const comments = this.filterActionableThreads(allThreads);
    logger.info(
      `Fetched ${comments.length} inline review threads`,
      this.branch,
    );
    return { comments, threadCounts, orcRepliedResolvedThreadIds, resolvedNoOrcReplyThreadIds, followUpResolvedThreadIds };
  }

  /** Fetch all actionable comments: unresolved review threads + PR conversation comments. */
  async fetch(): Promise<FetchedComment[]> {
    const { comments } = await this.fetchWithCounts();
    return comments;
  }

  private filterActionableThreads(threads: GHReviewThread[]): FetchedComment[] {
    const results: FetchedComment[] = [];

    for (const thread of threads) {
      if (thread.isResolved || thread.isOutdated) continue;

      const firstComment = thread.comments.nodes[0];
      if (!firstComment) continue;

      // Skip threads where Orc has replied AND no new reviewer
      // comments appeared after that reply.  If a reviewer responds
      // after Orc's last reply (keeping the thread unresolved), the
      // thread should be picked up again.
      const lastOrcReplyAt = thread.comments.nodes
        .filter((c) => isOrcReply(c.body))
        .reduce<string | null>(
          (latest, c) => (!latest || c.createdAt > latest ? c.createdAt : latest),
          null,
        );

      if (
        lastOrcReplyAt !== null &&
        !thread.comments.nodes.some(
          (c) => !isOrcReply(c.body) && !isBotAuthor(c.author?.login ?? "") && c.createdAt > lastOrcReplyAt,
        )
      ) {
        logger.debug(`Skipping thread ${thread.id} — already replied`, this.branch);
        continue;
      }

      // Only use the first comment in the thread (ignore follow-up replies)
      const body = firstComment.body;
      const replies: ThreadReply[] = thread.comments.nodes.map((c) => ({
        id: c.id,
        author: c.author.login,
        body: c.body,
        createdAt: c.createdAt,
        isOrcReply: isOrcReply(c.body),
      }));
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
          replies,
        },
        rawThread: thread,
      });
    }

    return results;
  }

}
