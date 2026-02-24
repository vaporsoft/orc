import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock constants to use tiny backoff delays
vi.mock("../src/constants.js", () => ({
  RETRY_BACKOFF_MS: [1, 1, 1, 1],
  DEFAULT_POLL_INTERVAL: 60,
  DEFAULT_CONFIDENCE: 0.75,
  DEFAULT_CLAUDE_TIMEOUT: 900,
  DEFAULT_SESSION_TIMEOUT: 0,
  WORKTREE_BASE: "/tmp/orc",
  MAX_CI_FIX_ATTEMPTS: 2,
  ALLOWED_TOOLS: [],
}));

// Import after mocks
const { withRetry, RateLimitError, sleep } = await import("../src/utils/retry.js");

describe("RateLimitError", () => {
  it("is an instance of Error", () => {
    const err = new RateLimitError("rate limited");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("RateLimitError");
    expect(err.message).toBe("rate limited");
  });
});

describe("sleep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves after the specified delay", async () => {
    const p = sleep(1000);
    vi.advanceTimersByTime(1000);
    await p;
  });

  it("does not resolve before the delay", async () => {
    let resolved = false;
    const p = sleep(1000).then(() => {
      resolved = true;
    });
    vi.advanceTimersByTime(500);
    await Promise.resolve();
    expect(resolved).toBe(false);
    vi.advanceTimersByTime(500);
    await p;
    expect(resolved).toBe(true);
  });
});

describe("withRetry", () => {
  it("returns the result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, "test");
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws immediately on RateLimitError without retrying", async () => {
    const rateErr = new RateLimitError("rate limit exceeded");
    const fn = vi.fn().mockRejectedValue(rateErr);

    await expect(withRetry(fn, "test")).rejects.toThrow(RateLimitError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and returns eventual success", async () => {
    // With mocked RETRY_BACKOFF_MS = [1,1,1,1], delays are 1ms each
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValue("ok");

    const result = await withRetry(fn, "test");
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws the last error after exhausting retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));

    await expect(withRetry(fn, "test", 2)).rejects.toThrow("always fails");
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("respects custom maxRetries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));

    await expect(withRetry(fn, "test", 1)).rejects.toThrow("fail");
    expect(fn).toHaveBeenCalledTimes(2); // initial + 1 retry
  });
});
