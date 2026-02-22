/**
 * Shared utilities for quoting comment bodies in GitHub replies.
 * This ensures consistent quoting format across comment-fetcher and thread-responder.
 */

/**
 * Quote a comment body for inclusion in a reply.
 * Converts each line to markdown quote format (prefixed with "> ").
 */
export function quoteCommentBody(originalBody: string): string {
  return originalBody
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

/**
 * Check whether a reply contains an exact quote of the given original comment body.
 * Uses precise matching to avoid false positives from substring matching.
 */
export function containsQuotedComment(replyBody: string, originalBody: string): boolean {
  const quotedBody = quoteCommentBody(originalBody);

  // Split reply into lines to check for exact quote block boundaries
  const replyLines = replyBody.split("\n");
  const quotedLines = quotedBody.split("\n");

  // Look for the quoted content as a contiguous block
  for (let i = 0; i <= replyLines.length - quotedLines.length; i++) {
    let matches = true;
    for (let j = 0; j < quotedLines.length; j++) {
      if (replyLines[i + j] !== quotedLines[j]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return true;
    }
  }

  return false;
}