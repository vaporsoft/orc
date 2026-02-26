/**
 * Replies to inline review threads via GitHub API.
 * Auto-resolves threads after successful "addressed" or "verified fixed" replies.
 */

import { GHClient } from "../github/gh-client.js";
import type { CategorizedComment } from "../types/index.js";
import type { VerifyOutcome } from "./fix-executor.js";
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
  async replyToAddressed(
    comments: CategorizedComment[],
    commitSha?: string,
    fixSummaries?: Map<string, string>,
  ): Promise<void> {
    const { owner, repo } = await this.ghClient.getRepoInfo();
    const commitRef = commitSha
      ? `[${commitSha.slice(0, 7)}](https://github.com/${owner}/${repo}/commit/${commitSha})`
      : "latest commit";

    for (const comment of comments) {
      const summary = fixSummaries?.get(comment.threadId);
      const body = this.buildAddressedReply(comment, commitRef, summary);
      try {
        await this.reply(comment, body);
        logger.info(
          `Replied to addressed comment on ${comment.path}`,
          this.branch,
        );
        try {
          await this.ghClient.resolveThread(comment.threadId);
        } catch (err) {
          logger.warn(`Failed to resolve thread ${comment.threadId}: ${err}`, this.branch);
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
        if (outcome?.status === "fixed") {
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

  /** Reply to needs_clarification comments with a question tagging the original author. */
  async replyToClarifications(comments: CategorizedComment[]): Promise<void> {
    for (const comment of comments) {
      const body = this.buildClarificationReply(comment);
      try {
        await this.reply(comment, body);
        logger.info(
          `Asked clarification on ${comment.path}`,
          this.branch,
        );
      } catch (err) {
        logger.warn(
          `Failed to reply with clarification for ${comment.threadId}: ${err}`,
          this.branch,
        );
      }
    }
  }

  private buildClarificationReply(comment: CategorizedComment): string {
    const parts: string[] = [];

    const question = comment.clarificationQuestion ?? "Could you clarify what change you'd like here?";
    parts.push(question);

    parts.push("");
    parts.push(`*Orc — ${comment.category} (confidence: ${comment.confidence.toFixed(2)})*`);

    return parts.join("\n");
  }

  private buildAddressedReply(comment: CategorizedComment, commitRef: string, summary?: string): string {
    const parts: string[] = [];

    if (summary) {
      parts.push(`${summary} (${commitRef}).`);
    } else {
      parts.push(`Addressed in ${commitRef}.`);
    }

    parts.push("");
    parts.push(`*Orc — ${comment.category} (confidence: ${comment.confidence.toFixed(2)})*`);

    return parts.join("\n");
  }

  private buildSkippedReply(comment: CategorizedComment): string {
    const parts: string[] = [];

    if (comment.category === "false_positive") {
      parts.push(`Took a look — skipping this one. ${comment.reasoning}`);
    } else {
      parts.push(`Skipping this — auto-fix for \`${comment.category}\` is disabled. ${comment.reasoning}`);
    }

    parts.push("");
    // Use [skipped] suffix to distinguish from actual clarification questions,
    // so that hasAskedClarification detection doesn't falsely trigger on skipped replies.
    parts.push(`*Orc — ${comment.category} [skipped] (confidence: ${comment.confidence.toFixed(2)})*`);

    return parts.join("\n");
  }

  private buildVerifiedReply(
    comment: CategorizedComment,
    outcome: VerifyOutcome | undefined,
    commitRef: string,
  ): string {
    const parts: string[] = [];

    if (outcome?.status === "fixed") {
      if (outcome.summary) {
        parts.push(`${outcome.summary} (${commitRef}).`);
      } else {
        parts.push(`Verified and addressed in ${commitRef}.`);
      }
    } else if (outcome?.status === "not_applicable") {
      const reason = outcome.reason ? ` ${outcome.reason}` : "";
      parts.push(`Took a look — this doesn't appear to apply here.${reason}`);
    } else {
      // Unknown or missing outcome
      const reason = outcome?.reason ? ` ${outcome.reason}` : "";
      parts.push(`Wasn't able to verify whether this was fully addressed.${reason}`);
    }

    parts.push("");
    parts.push(`*Orc — ${comment.category} (confidence: ${comment.confidence.toFixed(2)})*`);

    return parts.join("\n");
  }

  /** Post reply to the inline review thread. */
  private async reply(comment: CategorizedComment, body: string): Promise<void> {
    await this.ghClient.addThreadReply(comment.threadId, body);
  }
}
