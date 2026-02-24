import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionController } from "../src/core/session-controller.js";
import { GitManager } from "../src/core/git-manager.js";
import { FixExecutor, type FixResult } from "../src/core/fix-executor.js";
import type { CategorizationResult } from "../src/core/comment-categorizer.js";
import { ProgressStore } from "../src/core/progress-store.js";
import { DEFAULT_CONFIG } from "../src/types/config.js";
import type { RepoConfig } from "../src/types/index.js";

vi.mock("../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    dumpBranchLogs: vi.fn(),
  },
}));

vi.mock("../src/utils/settings.js", () => ({
  loadSettings: vi.fn().mockReturnValue(null),
  saveSettings: vi.fn(),
}));

vi.mock("../src/utils/process.js", () => ({
  exec: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
}));

vi.mock("../src/core/repo-config.js", () => ({
  loadRepoConfig: vi.fn().mockResolvedValue({
    instructions: "",
    setupCommands: [],
    verifyCommands: [],
    allowedCommands: [],
    autoFix: {
      must_fix: true,
      should_fix: true,
      nice_to_have: false,
      verify_and_fix: true,
      needs_clarification: true,
    },
    mcpServers: {},
    allowedEnvVars: [],
  }),
}));

const MOCK_REPO_CONFIG: RepoConfig = {
  instructions: "",
  setupCommands: [],
  verifyCommands: [],
  allowedCommands: [],
  autoFix: {
    must_fix: true,
    should_fix: true,
    nice_to_have: false,
    verify_and_fix: true,
    needs_clarification: true,
  },
  mcpServers: {},
  allowedEnvVars: [],
};

function makeFakeFixResult(overrides: Partial<FixResult> = {}): FixResult {
  return {
    sessionId: "test-session",
    costUsd: 0.05,
    inputTokens: 500,
    outputTokens: 200,
    durationMs: 1000,
    isError: false,
    changedFiles: [],
    errors: [],
    verifyResults: new Map(),
    fixSummaries: new Map(),
    ...overrides,
  };
}

function createController(mode: "once" | "watch" = "once", setupFn?: () => Promise<void>): SessionController {
  const store = new ProgressStore("/tmp/orc-test");
  vi.spyOn(store, "getLifetimeStats").mockReturnValue({
    lifetimeSeen: 0,
    lifetimeAddressed: 0,
    cycleCount: 0,
    cycleHistory: [],
  });
  vi.spyOn(store, "recordCycleStart").mockResolvedValue(undefined);
  vi.spyOn(store, "recordCycleEnd").mockResolvedValue(undefined);

  const ctrl = new SessionController(
    "test-branch",
    DEFAULT_CONFIG,
    "/tmp/orc-test",
    mode,
    store,
    undefined, // gitLock
    setupFn,
  );

  return ctrl;
}

function setupFullCycle(ctrl: SessionController) {
  const gitManager: GitManager = (ctrl as any).gitManager;
  const executor: FixExecutor = (ctrl as any).executor;
  const ghClient = (ctrl as any).ghClient;

  // Auth and PR discovery
  vi.spyOn(ghClient, "validateAuth").mockResolvedValue(undefined);
  vi.spyOn(ghClient, "findPRForBranch").mockResolvedValue({
    number: 1,
    url: "https://github.com/acme/app/pull/1",
    title: "Test PR",
    state: "OPEN",
    headRefName: "test-branch",
    baseRefName: "main",
    headRefOid: "abc123",
    author: { login: "pr-author" },
  });
  vi.spyOn(ghClient, "getCurrentUser").mockResolvedValue("bot-user");
  vi.spyOn(ghClient, "getRepoInfo").mockResolvedValue({ owner: "acme", repo: "app" });
  vi.spyOn(ghClient, "requestReviewers").mockResolvedValue(undefined);
  vi.spyOn(ghClient, "getCheckRuns").mockResolvedValue([
    { id: 1, name: "build", status: "completed", conclusion: "success", html_url: "", app: { slug: "github-actions" } },
  ]);
  vi.spyOn(ghClient, "getReviewThreads").mockResolvedValue([]);
  vi.spyOn(ghClient, "getPRComments").mockResolvedValue([]);
  vi.spyOn(ghClient, "addThreadReply").mockResolvedValue(undefined);
  vi.spyOn(ghClient, "addPRComment").mockResolvedValue(undefined);
  vi.spyOn(ghClient, "resolveThread").mockResolvedValue(undefined);
  vi.spyOn(ghClient, "getWorkflowRuns").mockResolvedValue([]);

  // Git operations
  vi.spyOn(gitManager, "pullRebase").mockResolvedValue(true);
  vi.spyOn(gitManager, "hasUncommittedChanges").mockResolvedValue(false);
  vi.spyOn(gitManager, "rebaseAutosquash").mockResolvedValue(true);
  vi.spyOn(gitManager, "forcePushWithLease").mockResolvedValue(true);
  vi.spyOn(gitManager, "discardChanges").mockResolvedValue(undefined);
  vi.spyOn(gitManager, "getHeadSha").mockResolvedValue("abc123");
  vi.spyOn(gitManager, "getChangedFilesSince").mockResolvedValue([]);
  vi.spyOn(gitManager, "isAheadOfRemote").mockResolvedValue(false);

  // Fix executor
  vi.spyOn(executor, "execute").mockResolvedValue(makeFakeFixResult());
  vi.spyOn(executor, "executeCIFix").mockResolvedValue(makeFakeFixResult());
  vi.spyOn(executor, "executeConflictFix").mockResolvedValue(makeFakeFixResult());

  return { gitManager, executor, ghClient };
}

describe("SessionController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("initialization", () => {
    it("starts with 'initializing' status", () => {
      const ctrl = createController();
      expect(ctrl.getState().status).toBe("initializing");
    });

    it("loads lifetime stats from progress store", () => {
      const store = new ProgressStore("/tmp/orc-test");
      vi.spyOn(store, "getLifetimeStats").mockReturnValue({
        lifetimeSeen: 5,
        lifetimeAddressed: 3,
        cycleCount: 2,
        cycleHistory: [],
      });

      const ctrl = new SessionController("test-branch", DEFAULT_CONFIG, "/tmp/orc-test", "once", store);
      const state = ctrl.getState();
      expect(state.lifetimeSeen).toBe(5);
      expect(state.lifetimeAddressed).toBe(3);
      expect(state.cycleCount).toBe(2);
    });
  });

  describe("state transitions", () => {
    it("emits statusChange events on no-comments cycle", async () => {
      const ctrl = createController();
      setupFullCycle(ctrl);

      const statuses: string[] = [];
      ctrl.on("statusChange", (_branch: string, status: string) => {
        statuses.push(status);
      });

      await ctrl.start();

      expect(statuses[0]).toBe("initializing");
      expect(statuses).toContain("stopped");
    });

    it("transitions to error when no PR found", async () => {
      const ctrl = createController();
      const ghClient = (ctrl as any).ghClient;
      vi.spyOn(ghClient, "validateAuth").mockResolvedValue(undefined);
      vi.spyOn(ghClient, "findPRForBranch").mockResolvedValue(null);

      await ctrl.start();

      const state = ctrl.getState();
      expect(state.status).toBe("error");
      expect(state.error).toContain("No open PR found");
    });

    it("transitions to error when PR is not open", async () => {
      const ctrl = createController();
      const ghClient = (ctrl as any).ghClient;
      vi.spyOn(ghClient, "validateAuth").mockResolvedValue(undefined);
      vi.spyOn(ghClient, "findPRForBranch").mockResolvedValue({
        number: 1,
        url: "https://github.com/acme/app/pull/1",
        title: "Test PR",
        state: "MERGED",
        headRefName: "test-branch",
        baseRefName: "main",
        headRefOid: "abc123",
        author: { login: "pr-author" },
      });

      await ctrl.start();

      const state = ctrl.getState();
      expect(state.status).toBe("error");
      expect(state.error).toContain("MERGED");
    });
  });

  describe("full pipeline (once mode)", () => {
    it("runs fetch → categorize → fix → push → reply for actionable comments", async () => {
      const ctrl = createController();
      const { gitManager, executor, ghClient } = setupFullCycle(ctrl);

      // Return an unresolved thread
      vi.spyOn(ghClient, "getReviewThreads").mockResolvedValue([
        {
          id: "t1",
          isResolved: false,
          isOutdated: false,
          comments: {
            pageInfo: { hasNextPage: false },
            nodes: [{
              id: "c1",
              databaseId: 1,
              body: "Fix this bug",
              author: { login: "reviewer" },
              path: "src/main.ts",
              line: 10,
              diffHunk: "@@ -1,5 +1,5 @@",
              createdAt: "2024-01-01T00:00:00Z",
            }],
          },
        },
      ]);

      // Mock the categorizer on the instance
      const categorizer = (ctrl as any).categorizer;
      vi.spyOn(categorizer, "categorize").mockResolvedValue({
        comments: [{
          threadId: "t1",
          path: "src/main.ts",
          line: 10,
          body: "Fix this bug",
          author: "reviewer",
          diffHunk: "@@ -1,5 +1,5 @@",
          category: "should_fix",
          confidence: 0.9,
          reasoning: "Valid",
          suggestedAction: "Fix it",
        }],
        costUsd: 0.01,
        inputTokens: 100,
        outputTokens: 50,
      });

      // Claude makes commits (head changes)
      let headCallCount = 0;
      vi.spyOn(gitManager, "getHeadSha").mockImplementation(async () => {
        headCallCount++;
        return headCallCount <= 1 ? "abc123" : "def456";
      });

      await ctrl.start();

      const state = ctrl.getState();
      expect(state.status).toBe("stopped");
      expect(executor.execute).toHaveBeenCalled();
      expect(gitManager.forcePushWithLease).toHaveBeenCalled();
      expect(state.commentsAddressed).toBe(1);
    });

    it("skips push when fix executor reports an error", async () => {
      const ctrl = createController();
      const { gitManager, executor, ghClient } = setupFullCycle(ctrl);

      vi.spyOn(ghClient, "getReviewThreads").mockResolvedValue([
        {
          id: "t1",
          isResolved: false,
          isOutdated: false,
          comments: {
            pageInfo: { hasNextPage: false },
            nodes: [{
              id: "c1",
              databaseId: 1,
              body: "Fix this",
              author: { login: "reviewer" },
              path: "src/main.ts",
              line: 10,
              diffHunk: "",
              createdAt: "2024-01-01T00:00:00Z",
            }],
          },
        },
      ]);

      const categorizer = (ctrl as any).categorizer;
      vi.spyOn(categorizer, "categorize").mockResolvedValue({
        comments: [{
          threadId: "t1",
          path: "src/main.ts",
          line: 10,
          body: "Fix this",
          author: "reviewer",
          diffHunk: "",
          category: "should_fix",
          confidence: 0.9,
          reasoning: "Valid",
          suggestedAction: "Fix it",
        }],
        costUsd: 0.01,
        inputTokens: 100,
        outputTokens: 50,
      });

      vi.spyOn(executor, "execute").mockResolvedValue(
        makeFakeFixResult({ isError: true, errors: ["Claude error"] }),
      );

      await ctrl.start();

      expect(gitManager.forcePushWithLease).not.toHaveBeenCalled();
    });

    it("handles no actionable comments after filtering", async () => {
      const ctrl = createController();
      const { executor, ghClient } = setupFullCycle(ctrl);

      vi.spyOn(ghClient, "getReviewThreads").mockResolvedValue([
        {
          id: "t1",
          isResolved: false,
          isOutdated: false,
          comments: {
            pageInfo: { hasNextPage: false },
            nodes: [{
              id: "c1",
              databaseId: 1,
              body: "Minor suggestion",
              author: { login: "reviewer" },
              path: "src/main.ts",
              line: 10,
              diffHunk: "",
              createdAt: "2024-01-01T00:00:00Z",
            }],
          },
        },
      ]);

      const categorizer = (ctrl as any).categorizer;
      vi.spyOn(categorizer, "categorize").mockResolvedValue({
        comments: [{
          threadId: "t1",
          path: "src/main.ts",
          line: 10,
          body: "Minor suggestion",
          author: "reviewer",
          diffHunk: "",
          category: "nice_to_have",
          confidence: 0.9,
          reasoning: "Nice but optional",
          suggestedAction: "Consider it",
        }],
        costUsd: 0.01,
        inputTokens: 100,
        outputTokens: 50,
      });

      await ctrl.start();

      // nice_to_have is not actionable by default
      expect(executor.execute).not.toHaveBeenCalled();
    });
  });

  describe("abort handling", () => {
    it("stops cleanly when stop() is called", async () => {
      const ctrl = createController("watch");
      setupFullCycle(ctrl);

      // Stop the controller after a short delay
      setTimeout(() => ctrl.stop(), 50);

      await ctrl.start();

      const state = ctrl.getState();
      expect(["stopped", "watching"]).toContain(state.status);
    });

    it("resolves pending conflict prompt when stopped", () => {
      const ctrl = createController();
      setupFullCycle(ctrl);

      let conflictResolved = false;
      (ctrl as any).conflictResolve = (_action: string) => {
        conflictResolved = true;
      };

      ctrl.stop();
      expect(conflictResolved).toBe(true);
    });
  });

  describe("updateConfig", () => {
    it("updates config and recreates dependent objects", () => {
      const ctrl = createController();
      const newConfig = { ...DEFAULT_CONFIG, confidence: 0.5 };

      ctrl.updateConfig(newConfig);

      expect((ctrl as any).config.confidence).toBe(0.5);
    });
  });

  describe("setConflicted", () => {
    it("updates state and emits sessionUpdate", () => {
      const ctrl = createController();
      const events: string[] = [];
      ctrl.on("sessionUpdate", () => events.push("update"));

      ctrl.setConflicted(["src/file.ts"]);

      expect(ctrl.getState().conflicted).toEqual(["src/file.ts"]);
      expect(events).toHaveLength(1);
    });
  });

  describe("push rejection during CI fix", () => {
    it("stops retrying when force-push-with-lease is rejected", async () => {
      const ctrl = createController();
      const { gitManager, executor } = setupFullCycle(ctrl);

      // Set up internal state as if we're mid-cycle
      (ctrl as any).state.prNumber = 1;
      (ctrl as any).running = true;
      (ctrl as any).repoConfig = MOCK_REPO_CONFIG;

      vi.spyOn(ctrl as any, "pollCIStatus").mockResolvedValue({
        status: "failing",
        failedChecks: [{ id: 1, name: "build", htmlUrl: "", logSnippet: null, appSlug: null }],
      });
      vi.spyOn(ctrl as any, "buildCIContext").mockResolvedValue({
        context: "CI failing",
        firstLogSnippet: "error",
      });

      // Claude makes commits
      let callCount = 0;
      vi.spyOn(gitManager, "getHeadSha").mockImplementation(async () => {
        callCount++;
        return callCount <= 1 ? "abc123" : "def456";
      });

      // Push is rejected
      vi.spyOn(gitManager, "forcePushWithLease").mockResolvedValue(false);

      await (ctrl as any).checkAndFixCI("main");

      // Should not retry after push rejection
      expect(executor.executeCIFix).toHaveBeenCalledTimes(1);
    });
  });

  describe("dry run mode", () => {
    it("logs actionable comments but does not execute fixes", async () => {
      const ctrl = createController();
      (ctrl as any).config = { ...DEFAULT_CONFIG, dryRun: true };
      const { executor, ghClient } = setupFullCycle(ctrl);

      vi.spyOn(ghClient, "getReviewThreads").mockResolvedValue([
        {
          id: "t1",
          isResolved: false,
          isOutdated: false,
          comments: {
            pageInfo: { hasNextPage: false },
            nodes: [{
              id: "c1",
              databaseId: 1,
              body: "Fix this",
              author: { login: "reviewer" },
              path: "src/main.ts",
              line: 10,
              diffHunk: "",
              createdAt: "2024-01-01T00:00:00Z",
            }],
          },
        },
      ]);

      const categorizer = (ctrl as any).categorizer;
      vi.spyOn(categorizer, "categorize").mockResolvedValue({
        comments: [{
          threadId: "t1",
          path: "src/main.ts",
          line: 10,
          body: "Fix this",
          author: "reviewer",
          diffHunk: "",
          category: "should_fix",
          confidence: 0.9,
          reasoning: "Valid",
          suggestedAction: "Fix it",
        }],
        costUsd: 0.01,
        inputTokens: 100,
        outputTokens: 50,
      });

      await ctrl.start();

      expect(executor.execute).not.toHaveBeenCalled();
    });
  });

  describe("lazy setup", () => {
    it("does not call setupFn when no comments to fix", async () => {
      const setupFn = vi.fn().mockResolvedValue(undefined);
      const ctrl = createController("once", setupFn);
      setupFullCycle(ctrl);

      await ctrl.start();

      expect(setupFn).not.toHaveBeenCalled();
    });

    it("calls setupFn before executing fixes", async () => {
      const setupFn = vi.fn().mockResolvedValue(undefined);
      const ctrl = createController("once", setupFn);
      const { gitManager, ghClient } = setupFullCycle(ctrl);

      vi.spyOn(ghClient, "getReviewThreads").mockResolvedValue([
        {
          id: "t1",
          isResolved: false,
          isOutdated: false,
          comments: {
            pageInfo: { hasNextPage: false },
            nodes: [{
              id: "c1",
              databaseId: 1,
              body: "Fix this bug",
              author: { login: "reviewer" },
              path: "src/main.ts",
              line: 10,
              diffHunk: "@@ -1,5 +1,5 @@",
              createdAt: "2024-01-01T00:00:00Z",
            }],
          },
        },
      ]);

      const categorizer = (ctrl as any).categorizer;
      vi.spyOn(categorizer, "categorize").mockResolvedValue({
        comments: [{
          threadId: "t1",
          path: "src/main.ts",
          line: 10,
          body: "Fix this bug",
          author: "reviewer",
          diffHunk: "@@ -1,5 +1,5 @@",
          category: "should_fix",
          confidence: 0.9,
          reasoning: "Valid",
          suggestedAction: "Fix it",
        }],
        costUsd: 0.01,
        inputTokens: 100,
        outputTokens: 50,
      });

      let headCallCount = 0;
      vi.spyOn(gitManager, "getHeadSha").mockImplementation(async () => {
        headCallCount++;
        return headCallCount <= 1 ? "abc123" : "def456";
      });

      await ctrl.start();

      expect(setupFn).toHaveBeenCalledTimes(1);
    });

    it("emits installing_deps status during setup", async () => {
      const setupFn = vi.fn().mockResolvedValue(undefined);
      const ctrl = createController("once", setupFn);
      const { gitManager, ghClient } = setupFullCycle(ctrl);

      vi.spyOn(ghClient, "getReviewThreads").mockResolvedValue([
        {
          id: "t1",
          isResolved: false,
          isOutdated: false,
          comments: {
            pageInfo: { hasNextPage: false },
            nodes: [{
              id: "c1",
              databaseId: 1,
              body: "Fix this",
              author: { login: "reviewer" },
              path: "src/main.ts",
              line: 10,
              diffHunk: "",
              createdAt: "2024-01-01T00:00:00Z",
            }],
          },
        },
      ]);

      const categorizer = (ctrl as any).categorizer;
      vi.spyOn(categorizer, "categorize").mockResolvedValue({
        comments: [{
          threadId: "t1",
          path: "src/main.ts",
          line: 10,
          body: "Fix this",
          author: "reviewer",
          diffHunk: "",
          category: "should_fix",
          confidence: 0.9,
          reasoning: "Valid",
          suggestedAction: "Fix it",
        }],
        costUsd: 0.01,
        inputTokens: 100,
        outputTokens: 50,
      });

      let headCallCount = 0;
      vi.spyOn(gitManager, "getHeadSha").mockImplementation(async () => {
        headCallCount++;
        return headCallCount <= 1 ? "abc123" : "def456";
      });

      const statuses: string[] = [];
      ctrl.on("statusChange", (_branch: string, status: string) => {
        statuses.push(status);
      });

      await ctrl.start();

      expect(statuses).toContain("installing_deps");
      // installing_deps should come before fixing
      const depsIdx = statuses.indexOf("installing_deps");
      const fixIdx = statuses.indexOf("fixing");
      expect(depsIdx).toBeLessThan(fixIdx);
    });

    it("only calls setupFn once even with multiple fix paths", async () => {
      const setupFn = vi.fn().mockResolvedValue(undefined);
      const ctrl = createController("once", setupFn);
      const { gitManager, executor } = setupFullCycle(ctrl);

      // Set up internal state for direct checkAndFixCI call
      (ctrl as any).state.prNumber = 1;
      (ctrl as any).running = true;
      (ctrl as any).repoConfig = MOCK_REPO_CONFIG;

      vi.spyOn(ctrl as any, "pollCIStatus")
        .mockResolvedValueOnce({
          status: "failing",
          failedChecks: [{ id: 1, name: "build", htmlUrl: "", logSnippet: null, appSlug: null }],
        })
        .mockResolvedValueOnce({ status: "passing", failedChecks: [] });
      vi.spyOn(ctrl as any, "buildCIContext").mockResolvedValue({
        context: "CI failing",
        firstLogSnippet: "error",
      });

      let callCount = 0;
      vi.spyOn(gitManager, "getHeadSha").mockImplementation(async () => {
        callCount++;
        return callCount <= 1 ? "abc123" : "def456";
      });

      await (ctrl as any).checkAndFixCI("main");

      expect(setupFn).toHaveBeenCalledTimes(1);
    });
  });

  describe("cost tracking", () => {
    it("accumulates categorization and fix costs", async () => {
      const ctrl = createController();
      const { gitManager, executor, ghClient } = setupFullCycle(ctrl);

      vi.spyOn(ghClient, "getReviewThreads").mockResolvedValue([
        {
          id: "t1",
          isResolved: false,
          isOutdated: false,
          comments: {
            pageInfo: { hasNextPage: false },
            nodes: [{
              id: "c1",
              databaseId: 1,
              body: "Fix this",
              author: { login: "reviewer" },
              path: "src/main.ts",
              line: 10,
              diffHunk: "",
              createdAt: "2024-01-01T00:00:00Z",
            }],
          },
        },
      ]);

      const categorizer = (ctrl as any).categorizer;
      vi.spyOn(categorizer, "categorize").mockResolvedValue({
        comments: [{
          threadId: "t1",
          path: "src/main.ts",
          line: 10,
          body: "Fix this",
          author: "reviewer",
          diffHunk: "",
          category: "should_fix",
          confidence: 0.9,
          reasoning: "Valid",
          suggestedAction: "Fix it",
        }],
        costUsd: 0.02,
        inputTokens: 200,
        outputTokens: 100,
      });

      // Claude makes commits
      let headCount = 0;
      vi.spyOn(gitManager, "getHeadSha").mockImplementation(async () => {
        headCount++;
        return headCount <= 1 ? "abc123" : "def456";
      });

      vi.spyOn(executor, "execute").mockResolvedValue(
        makeFakeFixResult({ costUsd: 0.10, inputTokens: 1000, outputTokens: 500 }),
      );

      await ctrl.start();

      const state = ctrl.getState();
      expect(state.totalCostUsd).toBeGreaterThanOrEqual(0.12);
      expect(state.totalInputTokens).toBeGreaterThanOrEqual(1200);
    });
  });
});
