/**
 * Replies to review threads and PR conversation comments via GitHub API.
 * Does NOT auto-resolve threads — lets reviewers decide.
 */

import { GHClient } from "../github/gh-client.js";
import type { CategorizedComment } from "../types/index.js";
import { logger } from "../utils/logger.js";

export class ThreadResponder {
  private ghClient: GHClient;
  private branch: string;
  private prNumber: number;

  constructor(ghClient: GHClient, branch: string, prNumber: number) {
    this.ghClient = ghClient;
    this.branch = branch;
    this.prNumber = prNumber;
  }

  /** Reply to threads/comments that were addressed by fixes. */
  async replyToAddressed(comments: CategorizedComment[], commitSha?: string): Promise<void> {
    const { owner, repo } = await this.ghClient.getRepoInfo();
    const commitRef = commitSha
      ? `[${commitSha.slice(0, 7)}](https://github.com/${owner}/${repo}/commit/${commitSha})`
      : "latest commit";

    for (const comment of comments) {
      const body = this.buildAddressedReply(comment, commitRef);
      try {
        await this.reply(comment, body);
        logger.info(
          `Replied to addressed comment on ${comment.path}`,
          this.branch,
        );
      } catch (err) {
        logger.warn(
          `Failed to reply to comment ${comment.threadId}: ${err}`,
          this.branch,
        );
      }
    }
  }

  /** Reply to threads/comments that were skipped, explaining why. */
  async replyToSkipped(comments: CategorizedComment[]): Promise<void> {
    for (const comment of comments) {
      const body = this.buildSkippedReply(comment);
      try {
        await this.reply(comment, body);
        logger.debug(
          `Replied to skipped comment on ${comment.path}`,
          this.branch,
        );
      } catch (err) {
        logger.warn(
          `Failed to reply to skipped comment: ${err}`,
          this.branch,
        );
      }
    }
  }

  private buildAddressedReply(comment: CategorizedComment, commitRef: string): string {
    const isConversation = comment.path === "(conversation)";

    const parts: string[] = [];

    if (isConversation) {
      // Quote the original comment and tag the author
      const quotedBody = comment.body
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      parts.push(quotedBody);
      parts.push("");
      parts.push(`@${comment.author} Addressed in ${commitRef}.`);
    } else {
      parts.push(`Addressed in ${commitRef}.`);
    }

    parts.push("");
    parts.push(`*Orc — ${comment.category} (confidence: ${comment.confidence.toFixed(2)})*`);

    return parts.join("\n");
  }

  private buildSkippedReply(comment: CategorizedComment): string {
    const isConversation = comment.path === "(conversation)";

    const parts: string[] = [];

    if (isConversation) {
      const quotedBody = comment.body
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      parts.push(quotedBody);
      parts.push("");
      parts.push(`@${comment.author} Skipped — ${comment.reasoning}`);
    } else {
      parts.push(`Skipped — ${comment.reasoning}`);
    }

    parts.push("");
    parts.push(`*Orc — ${comment.category} (confidence: ${comment.confidence.toFixed(2)})*`);

    return parts.join("\n");
  }

  /** Route reply to the correct API based on comment type. */
  private async reply(comment: CategorizedComment, body: string): Promise<void> {
    if (comment.path === "(conversation)") {
      // PR conversation comment — reply as a new top-level comment
      await this.ghClient.addPRComment(this.prNumber, body);
    } else {
      // Inline review thread — reply in the thread
      await this.ghClient.addThreadReply(comment.threadId, body);
    }
  }
}
