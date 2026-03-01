import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionController } from "../src/core/session-controller.js";
import { GitManager } from "../src/core/git-manager.js";
import { FixExecutor } from "../src/core/fix-executor.js";
import { ProgressStore } from "../src/core/progress-store.js";
import { DEFAULT_CONFIG } from "../src/types/config.js";
import type { FixResult } from "../src/core/fix-executor.js";

// Suppress logger output during tests
vi.mock("../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

/**
 * Tests the CI fix loop in SessionController to verify push behavior when
 * a rebase has already incorporated base branch changes. Exercises the real
 * checkAndFixCI code path with mocked git/executor dependencies.
 */

function makeFakeFixResult(overrides: Partial<FixResult> = {}): FixResult {
  return {
    sessionId: "test-session",
    durationMs: 0,
    isError: false,
    changedFiles: [],
    errors: [],
    verifyResults: new Map(),
    fixSummaries: new Map(),
    ...overrides,
  };
}

function createController(): SessionController {
  const store = new ProgressStore("/tmp/orc-test");
  vi.spyOn(store, "getLifetimeStats").mockReturnValue({
    lifetimeSeen: 0,
    lifetimeAddressed: 0,
    cycleCount: 0,
    cycleHistory: [],
  });

  const ctrl = new SessionController(
    "test-branch",
    DEFAULT_CONFIG,
    "/tmp/orc-test",
    "once",
    store,
  );

  // Set prNumber so checkAndFixCI doesn't bail early
  const state = ctrl.getState();
  (ctrl as any).state.prNumber = 1;
  (ctrl as any).running = true;

  return ctrl;
}

describe("SessionController CI fix loop", () => {
  let ctrl: SessionController;
  let gitManager: GitManager;
  let executor: FixExecutor;

  beforeEach(() => {
    ctrl = createController();
    gitManager = (ctrl as any).gitManager;
    executor = (ctrl as any).executor;

    // Default mocks — override per-test as needed
    vi.spyOn(gitManager, "hasUncommittedChanges").mockResolvedValue(false);
    vi.spyOn(gitManager, "rebaseAutosquash").mockResolvedValue(true);
    vi.spyOn(gitManager, "forcePushWithLease").mockResolvedValue(true);
    vi.spyOn(gitManager, "discardChanges").mockResolvedValue(undefined);

    vi.spyOn(executor, "executeCIFix").mockResolvedValue(makeFakeFixResult());
  });

  it("pushes rebased branch when Claude makes no commits but local is ahead of remote", async () => {
    // CI is failing
    vi.spyOn(ctrl as any, "pollCIStatus").mockResolvedValue({
      status: "failing",
      failedChecks: [{ name: "build", conclusion: "failure" }],
    });
    vi.spyOn(ctrl as any, "buildCIContext").mockResolvedValue({
      context: "CI failing",
      firstLogSnippet: "error",
    });

    // Claude makes no commits (HEAD unchanged)
    vi.spyOn(gitManager, "getHeadSha").mockResolvedValue("abc123");

    // But local is ahead of remote (rebase incorporated base branch changes)
    vi.spyOn(gitManager, "isAheadOfRemote").mockResolvedValue(true);

    const pushSpy = vi.spyOn(gitManager, "forcePushWithLease");

    await (ctrl as any).checkAndFixCI("main");

    expect(pushSpy).toHaveBeenCalled();
    expect(ctrl.getState().lastPushAt).not.toBeNull();
  });

  it("does not push when Claude makes no commits and local matches remote", async () => {
    vi.spyOn(ctrl as any, "pollCIStatus").mockResolvedValue({
      status: "failing",
      failedChecks: [{ name: "build", conclusion: "failure" }],
    });
    vi.spyOn(ctrl as any, "buildCIContext").mockResolvedValue({
      context: "CI failing",
      firstLogSnippet: "error",
    });

    // Claude makes no commits
    vi.spyOn(gitManager, "getHeadSha").mockResolvedValue("abc123");

    // Local matches remote — nothing to push
    vi.spyOn(gitManager, "isAheadOfRemote").mockResolvedValue(false);

    const pushSpy = vi.spyOn(gitManager, "forcePushWithLease");

    await (ctrl as any).checkAndFixCI("main");

    expect(pushSpy).not.toHaveBeenCalled();
    expect(ctrl.getState().lastPushAt).toBeNull();
  });

  it("pushes Claude's fix commits through normal path when Claude makes commits", async () => {
    vi.spyOn(ctrl as any, "pollCIStatus").mockResolvedValue({
      status: "failing",
      failedChecks: [{ name: "build", conclusion: "failure" }],
    });
    vi.spyOn(ctrl as any, "buildCIContext").mockResolvedValue({
      context: "CI failing",
      firstLogSnippet: "error",
    });

    // Claude makes a commit (HEAD changes)
    let callCount = 0;
    vi.spyOn(gitManager, "getHeadSha").mockImplementation(async () => {
      callCount++;
      return callCount <= 1 ? "abc123" : "def456";
    });

    const pushSpy = vi.spyOn(gitManager, "forcePushWithLease");
    const rebaseSpy = vi.spyOn(gitManager, "rebaseAutosquash");

    await (ctrl as any).checkAndFixCI("main");

    // Should go through autosquash rebase path, not isAheadOfRemote path
    expect(rebaseSpy).toHaveBeenCalledWith("main");
    expect(pushSpy).toHaveBeenCalled();
  });

  it("breaks without pushing when executor returns an error", async () => {
    vi.spyOn(ctrl as any, "pollCIStatus").mockResolvedValue({
      status: "failing",
      failedChecks: [{ name: "build", conclusion: "failure" }],
    });
    vi.spyOn(ctrl as any, "buildCIContext").mockResolvedValue({
      context: "CI failing",
      firstLogSnippet: "error",
    });

    vi.spyOn(executor, "executeCIFix").mockResolvedValue(
      makeFakeFixResult({ isError: true }),
    );
    vi.spyOn(gitManager, "getHeadSha").mockResolvedValue("abc123");

    const pushSpy = vi.spyOn(gitManager, "forcePushWithLease");

    await (ctrl as any).checkAndFixCI("main");

    expect(pushSpy).not.toHaveBeenCalled();
  });

  it("does not check isAheadOfRemote when Claude made commits", async () => {
    vi.spyOn(ctrl as any, "pollCIStatus").mockResolvedValue({
      status: "failing",
      failedChecks: [{ name: "build", conclusion: "failure" }],
    });
    vi.spyOn(ctrl as any, "buildCIContext").mockResolvedValue({
      context: "CI failing",
      firstLogSnippet: "error",
    });

    let callCount = 0;
    vi.spyOn(gitManager, "getHeadSha").mockImplementation(async () => {
      callCount++;
      return callCount <= 1 ? "abc123" : "def456";
    });

    const aheadSpy = vi.spyOn(gitManager, "isAheadOfRemote");

    await (ctrl as any).checkAndFixCI("main");

    // isAheadOfRemote should not be called — only used when Claude made no commits
    expect(aheadSpy).not.toHaveBeenCalled();
  });

  it("sets ciStatus to pending after pushing rebased branch", async () => {
    vi.spyOn(ctrl as any, "pollCIStatus").mockResolvedValue({
      status: "failing",
      failedChecks: [{ name: "build", conclusion: "failure" }],
    });
    vi.spyOn(ctrl as any, "buildCIContext").mockResolvedValue({
      context: "CI failing",
      firstLogSnippet: "error",
    });

    // Claude makes no commits
    vi.spyOn(gitManager, "getHeadSha").mockResolvedValue("abc123");

    // But local is ahead of remote
    vi.spyOn(gitManager, "isAheadOfRemote").mockResolvedValue(true);

    await (ctrl as any).checkAndFixCI("main");

    // ciStatus should be "pending" (not stale "failing") so daemon doesn't
    // prematurely schedule another fix cycle
    expect(ctrl.getState().ciStatus).toBe("pending");
  });

  it("skips fix attempt entirely when CI is not failing", async () => {
    vi.spyOn(ctrl as any, "pollCIStatus").mockResolvedValue({
      status: "passing",
      failedChecks: [],
    });

    const executeSpy = vi.spyOn(executor, "executeCIFix");

    await (ctrl as any).checkAndFixCI("main");

    expect(executeSpy).not.toHaveBeenCalled();
  });
});
