/**
 * Replies to review threads and PR conversation comments via GitHub API.
 * Auto-resolves inline threads after successful "addressed" or "verified fixed" replies.
 */

import { GHClient } from "../github/gh-client.js";
import type { CategorizedComment } from "../types/index.js";
import type { VerifyOutcome } from "./fix-executor.js";
import { logger } from "../utils/logger.js";
import { quoteCommentBody } from "../utils/quoting.js";

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
        if (comment.path !== "(conversation)") {
          try {
            await this.ghClient.resolveThread(comment.threadId);
          } catch (err) {
            logger.warn(`Failed to resolve thread ${comment.threadId}: ${err}`, this.branch);
          }
        }
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

  /** Reply to verify_and_fix comments based on actual verification outcomes. */
  async replyToVerified(
    comments: CategorizedComment[],
    verifyResults: Map<string, VerifyOutcome>,
    commitSha?: string,
  ): Promise<void> {
    const { owner, repo } = await this.ghClient.getRepoInfo();
    const commitRef = commitSha
      ? `[${commitSha.slice(0, 7)}](https://github.com/${owner}/${repo}/commit/${commitSha})`
      : "latest commit";

    for (const comment of comments) {
      const outcome = verifyResults.get(comment.threadId);
      const body = this.buildVerifiedReply(comment, outcome, commitRef);
      try {
        await this.reply(comment, body);
        logger.info(
          `Replied to verified comment on ${comment.path} (${outcome?.status ?? "unknown"})`,
          this.branch,
        );
        if (outcome?.status === "fixed" && comment.path !== "(conversation)") {
          try {
            await this.ghClient.resolveThread(comment.threadId);
          } catch (err) {
            logger.warn(`Failed to resolve thread ${comment.threadId}: ${err}`, this.branch);
          }
        }
      } catch (err) {
        logger.warn(
          `Failed to reply to verified comment ${comment.threadId}: ${err}`,
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
      const quotedBody = quoteCommentBody(comment.body);
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
      const quotedBody = quoteCommentBody(comment.body);
      parts.push(quotedBody);
      parts.push("");
    }

    const prefix = isConversation ? `@${comment.author} ` : "";

    if (comment.category === "false_positive") {
      parts.push(`${prefix}Won't fix — ${comment.reasoning}`);
    } else {
      parts.push(`${prefix}Won't fix — auto-fix for \`${comment.category}\` is disabled. ${comment.reasoning}`);
    }

    parts.push("");
    parts.push(`*Orc — ${comment.category} (confidence: ${comment.confidence.toFixed(2)})*`);

    return parts.join("\n");
  }

  private buildVerifiedReply(
    comment: CategorizedComment,
    outcome: VerifyOutcome | undefined,
    commitRef: string,
  ): string {
    const isConversation = comment.path === "(conversation)";
    const parts: string[] = [];

    if (isConversation) {
      const quotedBody = quoteCommentBody(comment.body);
      parts.push(quotedBody);
      parts.push("");
    }

    if (outcome?.status === "fixed") {
      const summary = outcome.summary ? ` ${outcome.summary}` : "";
      if (isConversation) {
        parts.push(`@${comment.author} Verified and addressed in ${commitRef}.${summary}`);
      } else {
        parts.push(`Verified and addressed in ${commitRef}.${summary}`);
      }
    } else if (outcome?.status === "not_applicable") {
      const reason = outcome.reason ? ` ${outcome.reason}` : "";
      if (isConversation) {
        parts.push(`@${comment.author} Verified — not applicable.${reason}`);
      } else {
        parts.push(`Verified — not applicable.${reason}`);
      }
    } else {
      // Unknown or missing outcome
      const reason = outcome?.reason ? ` ${outcome.reason}` : " Status could not be determined.";
      if (isConversation) {
        parts.push(`@${comment.author} Could not verify completion.${reason}`);
      } else {
        parts.push(`Could not verify completion.${reason}`);
      }
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
