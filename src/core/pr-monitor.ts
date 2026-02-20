/**
 * Polls GitHub for new review threads and CI check results.
 * Diffs against previously-seen state to produce new PREvents.
 */

import { GHClient } from "../github/gh-client.js";
import type { GHReviewThread, GHCheckRun } from "../github/types.js";
import type { PREvent, ReviewThread, CICheck } from "../types/index.js";
import { logger } from "../utils/logger.js";

export interface PollResult {
  newEvents: PREvent[];
  /** All unresolved thread IDs (for state tracking). */
  allThreadIds: string[];
  /** All check IDs (for state tracking). */
  allCheckIds: string[];
}

export class PRMonitor {
  private ghClient: GHClient;
  private prNumber: number;
  private branch: string;

  constructor(ghClient: GHClient, prNumber: number, branch: string) {
    this.ghClient = ghClient;
    this.prNumber = prNumber;
    this.branch = branch;
  }

  /**
   * Poll GitHub for current review threads + CI checks and diff
   * against the seen sets to find new events.
   */
  async poll(
    seenThreadIds: Set<string>,
    seenCheckIds: Set<string>,
  ): Promise<PollResult> {
    const [threads, checks] = await Promise.all([
      this.ghClient.getReviewThreads(this.prNumber),
      this.ghClient.getCheckRuns(this.prNumber),
    ]);

    const newEvents: PREvent[] = [];
    const allThreadIds: string[] = [];
    const allCheckIds: string[] = [];

    // Process review threads
    for (const thread of threads) {
      if (thread.isResolved || thread.isOutdated) continue;

      const firstComment = thread.comments.nodes[0];
      if (!firstComment) continue;

      allThreadIds.push(thread.id);

      if (!seenThreadIds.has(thread.id)) {
        const reviewThread = this.toReviewThread(thread);
        newEvents.push({
          type: "review_comment",
          key: thread.id,
          thread: reviewThread,
        });
        logger.debug(
          `New review comment from ${firstComment.author.login} on ${firstComment.path}`,
          this.branch,
        );
      }
    }

    // Process CI checks
    for (const check of checks) {
      const checkKey = `${check.id}-${check.conclusion}`;
      allCheckIds.push(checkKey);

      if (
        check.status === "completed" &&
        check.conclusion === "failure" &&
        !seenCheckIds.has(checkKey)
      ) {
        newEvents.push({
          type: "ci_failure",
          key: checkKey,
          ciCheck: this.toCICheck(check),
        });
        logger.debug(`New CI failure: ${check.name}`, this.branch);
      }
    }

    logger.debug(
      `Poll complete: ${newEvents.length} new events (${threads.length} threads, ${checks.length} checks)`,
      this.branch,
    );

    return { newEvents, allThreadIds, allCheckIds };
  }

  /** Fetch failed CI logs for a check. */
  async fetchCILog(runId: number): Promise<string> {
    return this.ghClient.getFailedRunLog(runId);
  }

  private toReviewThread(ghThread: GHReviewThread): ReviewThread {
    const first = ghThread.comments.nodes[0];
    // Concatenate all comment bodies in the thread
    const body = ghThread.comments.nodes.map((c) => c.body).join("\n\n---\n\n");
    return {
      id: first.id,
      threadId: ghThread.id,
      path: first.path,
      line: first.line,
      body,
      author: first.author.login,
      isResolved: ghThread.isResolved,
      diffHunk: first.diffHunk,
      createdAt: first.createdAt,
    };
  }

  private toCICheck(ghCheck: GHCheckRun): CICheck {
    return {
      id: String(ghCheck.id),
      name: ghCheck.name,
      status: ghCheck.status as CICheck["status"],
      conclusion: ghCheck.conclusion as CICheck["conclusion"],
      detailsUrl: ghCheck.html_url,
      runId: ghCheck.id,
    };
  }
}
