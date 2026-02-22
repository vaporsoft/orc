import { RETRY_BACKOFF_MS } from "../constants.js";
import { logger } from "./logger.js";

/**
 * Thrown when a GitHub API call fails due to rate limiting.
 * Retrying immediately would waste quota, so callers should back off.
 */
export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

/**
 * Retry an async operation with exponential backoff.
 * Rate-limit errors are thrown immediately without retrying.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = RETRY_BACKOFF_MS.length,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof RateLimitError) {
        logger.warn(`${label} hit rate limit, not retrying`);
        throw err;
      }
      lastError = err;
      if (attempt < maxRetries) {
        const delay = RETRY_BACKOFF_MS[attempt] ?? 16000;
        logger.warn(
          `${label} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms`,
        );
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
