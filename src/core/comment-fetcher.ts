/**
 * Fetches review comments from GitHub — both inline review threads
 * and top-level PR conversation comments.
 * Filters out resolved, outdated, and already-replied-to comments.
 *
 * Since Orc runs under the user's own GitHub account, we can't
 * detect bot replies by author login. Instead we detect them by the
 * "Orc" signature in the comment body.
 */

import { GHClient } from "../github/gh-client.js";
import type { GHReviewThread } from "../github/types.js";
import type { ReviewThread, ThreadReply } from "../types/index.js";
import { logger } from "../utils/logger.js";
import { containsQuotedComment } from "../utils/quoting.js";

/** Signature Orc leaves in every reply — e.g. "*Orc — bug_fix (confidence: 0.95)*" */
const BOT_SIGNATURE_RE = /^\*Orc — .+ \(confidence: [\d.]+\)\*$/m;

function isOrcReply(body: string): boolean {
  return BOT_SIGNATURE_RE.test(body);
}


/** Comments that are just bot mentions/commands (e.g. "@cursor review"). Not review feedback. */
function isBotCommand(body: string): boolean {
  const trimmed = body.trim();
  // Matches "@something" optionally followed by a single word — e.g. "@cursor review", "@copilot fix"
  return /^@\w+(\s+\w+)?$/.test(trimmed);
}

/** GitHub bot account — author login ends with [bot] (e.g. "claude[bot]", "copilot[bot]"). */
function isBotAuthor(login: string): boolean {
  return login.endsWith("[bot]");
}

export interface FetchedComment {
  thread: ReviewThread;
  /** Present for inline review threads, null for PR conversation comments. */
  rawThread: GHReviewThread | null;
}

export interface ThreadCounts {
  resolved: number;
  total: number;
}

export interface CommentCounts {
  /** Inline review thread comments — can be resolved on GitHub. */
  addressable: number;
  /** Top-level PR conversation comments — cannot be resolved. */
  conversation: number;
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
    commentCounts: CommentCounts;
    /** Resolved thread IDs that still contain an ORC reply (for deleted-reply detection). */
    orcRepliedResolvedThreadIds: string[];
    /** Resolved thread IDs that do NOT contain an ORC reply. */
    resolvedNoOrcReplyThreadIds: string[];
    /** Resolved thread IDs where a non-orc comment was posted after orc's last reply (follow-up detection). */
    followUpResolvedThreadIds: string[];
  }> {
    const [allThreads, prComments] = await Promise.all([
      this.ghClient.getReviewThreads(this.prNumber),
      this.fetchPRConversationComments(),
    ]);

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

    // Filter to actionable threads (same logic as fetchReviewThreads)
    const threadComments = this.filterActionableThreads(allThreads);
    const comments = [...threadComments, ...prComments];
    const commentCounts: CommentCounts = {
      addressable: threadComments.length,
      conversation: prComments.length,
    };
    logger.info(
      `Fetched ${comments.length} comments (${threadComments.length} inline, ${prComments.length} conversation)`,
      this.branch,
    );
    return { comments, threadCounts, commentCounts, orcRepliedResolvedThreadIds, resolvedNoOrcReplyThreadIds, followUpResolvedThreadIds };
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

      // Exclude orc's own replies and bot reactions (bot comments posted
      // after orc's first reply are reactions, not review feedback).
      const firstOrcReplyAt = thread.comments.nodes
        .filter((c) => isOrcReply(c.body))
        .reduce<string | null>(
          (earliest, c) => (!earliest || c.createdAt < earliest ? c.createdAt : earliest),
          null,
        );
      const body = thread.comments.nodes
        .filter((c) => {
          if (isOrcReply(c.body)) return false;
          if (firstOrcReplyAt && isBotAuthor(c.author?.login ?? "") && c.createdAt > firstOrcReplyAt) return false;
          return true;
        })
        .map((c) => c.body)
        .join("\n\n---\n\n");
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

  private async fetchPRConversationComments(): Promise<FetchedComment[]> {
    const comments = await this.ghClient.getPRComments(this.prNumber);
    const results: FetchedComment[] = [];

    for (const comment of comments) {
      // Skip Orc's own replies
      if (isOrcReply(comment.body)) continue;

      // Skip bot comments that arrived after Orc was already active on this PR.
      // These are reactions to Orc's replies (e.g. claude[bot] "finished task"
      // messages), not fresh review feedback. Without this, Orc replies to the
      // bot reaction, which triggers another bot reaction — infinite loop.
      // Bot comments posted BEFORE any Orc reply are treated as original review
      // feedback (e.g. bugbot findings) and processed normally.
      if (isBotAuthor(comment.author.login)) {
        const orcWasActive = comments.some(
          (c) => isOrcReply(c.body) && c.createdAt < comment.createdAt,
        );
        if (orcWasActive) {
          logger.debug(`Skipping PR comment ${comment.id} — bot reaction after orc activity (${comment.author.login})`, this.branch);
          continue;
        }
      }

      // Skip bot commands like "@cursor review" — not review feedback
      if (isBotCommand(comment.body)) {
        logger.debug(`Skipping PR comment ${comment.id} — bot command`, this.branch);
        continue;
      }

      // Check if a later Orc reply addresses this specific comment.
      // Orc quotes the original comment body in its replies, so match on
      // that rather than a blanket timestamp comparison (which would
      // falsely shadow unrelated comments posted before any Orc reply).
      const alreadyReplied = comments.some(
        (c) =>
          isOrcReply(c.body) &&
          c.createdAt > comment.createdAt &&
          containsQuotedComment(c.body, comment.body),
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
}
