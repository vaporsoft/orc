import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync } from "fs";
import { join } from "path";

// Point ThreadStore at a temp directory so tests don't touch ~/.orc
const TEST_DIR = join(import.meta.dirname, "../.test-data");
process.env.HOME = TEST_DIR;

// Import after setting HOME so the store picks up the test path
const { ThreadStore } = await import("./thread-store");

function cleanup() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
}

describe("ThreadStore", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  test("markThread creates a new disposition", () => {
    const store = new ThreadStore();
    const result = store.markThread(1, "thread-1", "fixed");

    expect(result.disposition).toBe("fixed");
    expect(result.attempts).toBe(1);
    expect(result.lastAttemptAt).toBeTruthy();
  });

  test("markThread increments attempts on repeated calls", () => {
    const store = new ThreadStore();
    store.markThread(1, "thread-1", "fixed");
    const result = store.markThread(1, "thread-1", "errored");

    expect(result.disposition).toBe("errored");
    expect(result.attempts).toBe(2);
  });

  test("getDispositions returns all dispositions for a PR", () => {
    const store = new ThreadStore();
    store.markThread(1, "thread-1", "fixed");
    store.markThread(1, "thread-2", "skipped");
    store.markThread(2, "thread-3", "addressed");

    const pr1 = store.getDispositions(1);
    expect(Object.keys(pr1)).toHaveLength(2);
    expect(pr1["thread-1"].disposition).toBe("fixed");
    expect(pr1["thread-2"].disposition).toBe("skipped");

    const pr2 = store.getDispositions(2);
    expect(Object.keys(pr2)).toHaveLength(1);
  });

  test("getDispositions returns empty object for unknown PR", () => {
    const store = new ThreadStore();
    expect(store.getDispositions(999)).toEqual({});
  });

  test("unmarkThread removes a disposition", () => {
    const store = new ThreadStore();
    store.markThread(1, "thread-1", "addressed");
    store.unmarkThread(1, "thread-1");

    expect(store.getDispositions(1)).toEqual({});
  });

  test("unmarkThread is a no-op for missing thread", () => {
    const store = new ThreadStore();
    store.unmarkThread(1, "nonexistent");
    expect(store.getDispositions(1)).toEqual({});
  });

  test("shouldSkip returns false for unknown thread", () => {
    const store = new ThreadStore();
    expect(store.shouldSkip(1, "thread-1")).toEqual({ skip: false });
  });

  test("shouldSkip returns true when max attempts reached", () => {
    const store = new ThreadStore();
    store.markThread(1, "thread-1", "fixed");
    store.markThread(1, "thread-1", "errored"); // attempts = 2

    const result = store.shouldSkip(1, "thread-1", new Date().toISOString());
    expect(result.skip).toBe(true);
    expect(result.reason).toBe("max_attempts");
  });

  test("shouldSkip returns true when no new activity", () => {
    const store = new ThreadStore();
    store.markThread(1, "thread-1", "fixed");

    const oldTimestamp = new Date(Date.now() - 60_000).toISOString();
    const result = store.shouldSkip(1, "thread-1", oldTimestamp);
    expect(result.skip).toBe(true);
    expect(result.reason).toBe("no_new_activity");
  });

  test("shouldSkip returns false when new follow-up exists", () => {
    const store = new ThreadStore();
    store.markThread(1, "thread-1", "fixed");

    const futureTimestamp = new Date(Date.now() + 60_000).toISOString();
    const result = store.shouldSkip(1, "thread-1", futureTimestamp);
    expect(result.skip).toBe(false);
  });

  test("pruneClosedPRs removes dispositions for closed PRs", () => {
    const store = new ThreadStore();
    store.markThread(1, "thread-1", "fixed");
    store.markThread(2, "thread-2", "addressed");
    store.markThread(3, "thread-3", "skipped");

    store.pruneClosedPRs([1, 3]); // PR 2 is closed

    expect(Object.keys(store.getDispositions(1))).toHaveLength(1);
    expect(store.getDispositions(2)).toEqual({});
    expect(Object.keys(store.getDispositions(3))).toHaveLength(1);
  });

  test("persistence survives store recreation", () => {
    const store1 = new ThreadStore();
    store1.markThread(1, "thread-1", "fixed");
    store1.markThread(1, "thread-2", "addressed");

    const store2 = new ThreadStore();
    const disps = store2.getDispositions(1);
    expect(Object.keys(disps)).toHaveLength(2);
    expect(disps["thread-1"].disposition).toBe("fixed");
    expect(disps["thread-2"].disposition).toBe("addressed");
  });
});
