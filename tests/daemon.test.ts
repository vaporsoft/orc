import { describe, it, expect, vi, beforeEach } from "vitest";
import { Daemon } from "../src/core/daemon.js";
import { DEFAULT_CONFIG } from "../src/types/config.js";
import type { GHPullRequest } from "../src/github/types.js";
import { RateLimitError } from "../src/utils/retry.js";

vi.mock("../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../src/utils/settings.js", () => ({
  loadSettings: vi.fn().mockReturnValue(null),
  saveSettings: vi.fn(),
}));

vi.mock("../src/utils/notify.js", () => ({
  notify: vi.fn(),
}));

vi.mock("../src/utils/process.js", () => ({
  exec: vi.fn().mockResolvedValue({ stdout: "main\n", stderr: "", exitCode: 0 }),
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

function makePR(overrides: Partial<GHPullRequest> = {}): GHPullRequest {
  return {
    number: 1,
    url: "https://github.com/acme/app/pull/1",
    title: "Feature PR",
    state: "OPEN",
    headRefName: "feature-branch",
    baseRefName: "main",
    headRefOid: "abc123",
    author: { login: "developer" },
    ...overrides,
  };
}

function setupDaemon(): {
  daemon: Daemon;
  ghClient: any;
} {
  const daemon = new Daemon(DEFAULT_CONFIG, "/repo");
  const ghClient = (daemon as any).ghClient;

  vi.spyOn(ghClient, "validateAuth").mockResolvedValue(undefined);
  vi.spyOn(ghClient, "getCurrentUser").mockResolvedValue("developer");
  vi.spyOn(ghClient, "getRepoInfo").mockResolvedValue({ owner: "acme", repo: "app" });
  vi.spyOn(ghClient, "unresolveThread").mockResolvedValue(undefined);
  vi.spyOn(ghClient, "findPRForBranch").mockResolvedValue(null);
  vi.spyOn(ghClient, "isPRMerged").mockResolvedValue(false);

  // Mock progress store
  const store = (daemon as any).progressStore;
  vi.spyOn(store, "load").mockResolvedValue(undefined);
  vi.spyOn(store, "getLifetimeStats").mockReturnValue({
    lifetimeSeen: 0,
    lifetimeAddressed: 0,
    cycleCount: 0,
    cycleHistory: [],
  });

  // Mock worktree manager
  const wm = (daemon as any).worktreeManager;
  vi.spyOn(wm, "purgeStale").mockResolvedValue(undefined);
  vi.spyOn(wm, "cleanup").mockResolvedValue(undefined);
  vi.spyOn(wm, "create").mockResolvedValue("/tmp/orc/test");
  vi.spyOn(wm, "remove").mockResolvedValue(undefined);

  return { daemon, ghClient };
}

describe("Daemon", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("PR discovery", () => {
    it("discovers new PRs and emits prDiscovered event", async () => {
      const { daemon, ghClient } = setupDaemon();
      const pr = makePR();
      vi.spyOn(ghClient, "getMyOpenPRs").mockResolvedValue([pr]);
      vi.spyOn(ghClient, "getReviewThreads").mockResolvedValue([]);
      vi.spyOn(ghClient, "getPRComments").mockResolvedValue([]);

      const discovered: string[] = [];
      daemon.on("prDiscovered", (branch: string) => discovered.push(branch));

      // Run one discovery cycle then stop
      await (daemon as any).discover();

      expect(discovered).toContain("feature-branch");
      expect(daemon.getDiscoveredPRs().has("feature-branch")).toBe(true);
    });

    it("does not emit prDiscovered for already-known PRs", async () => {
      const { daemon, ghClient } = setupDaemon();
      const pr = makePR();
      vi.spyOn(ghClient, "getMyOpenPRs").mockResolvedValue([pr]);
      vi.spyOn(ghClient, "getReviewThreads").mockResolvedValue([]);
      vi.spyOn(ghClient, "getPRComments").mockResolvedValue([]);

      const discovered: string[] = [];
      daemon.on("prDiscovered", (branch: string) => discovered.push(branch));

      await (daemon as any).discover();
      await (daemon as any).discover();

      expect(discovered).toHaveLength(1); // Only once
    });

    it("handles rate limit errors gracefully during discovery", async () => {
      const { daemon, ghClient } = setupDaemon();
      vi.spyOn(ghClient, "getMyOpenPRs").mockRejectedValue(
        new RateLimitError("rate limit exceeded"),
      );

      // Should not throw
      await (daemon as any).discover();
    });
  });

  describe("merged PR detection", () => {
    it("detects merged PRs and emits prMerged", async () => {
      const { daemon, ghClient } = setupDaemon();
      const pr = makePR();

      // First discovery: PR is open
      vi.spyOn(ghClient, "getMyOpenPRs")
        .mockResolvedValueOnce([pr])
        .mockResolvedValueOnce([]); // Second call: PR gone

      vi.spyOn(ghClient, "isPRMerged").mockResolvedValue(true);
      vi.spyOn(ghClient, "getReviewThreads").mockResolvedValue([]);
      vi.spyOn(ghClient, "getPRComments").mockResolvedValue([]);

      const merged: string[] = [];
      daemon.on("prMerged", (branch: string) => merged.push(branch));

      await (daemon as any).discover(); // Discover PR
      await (daemon as any).discover(); // PR disappears

      expect(merged).toContain("feature-branch");
      expect(daemon.getMergedPRs().has("feature-branch")).toBe(true);
    });

    it("detects closed (non-merged) PRs and emits prRemoved", async () => {
      const { daemon, ghClient } = setupDaemon();
      const pr = makePR();

      vi.spyOn(ghClient, "getMyOpenPRs")
        .mockResolvedValueOnce([pr])
        .mockResolvedValueOnce([]);

      vi.spyOn(ghClient, "isPRMerged").mockResolvedValue(false);
      vi.spyOn(ghClient, "getReviewThreads").mockResolvedValue([]);
      vi.spyOn(ghClient, "getPRComments").mockResolvedValue([]);

      const removed: string[] = [];
      daemon.on("prRemoved", (branch: string) => removed.push(branch));

      await (daemon as any).discover();
      await (daemon as any).discover();

      expect(removed).toContain("feature-branch");
    });
  });

  describe("comment count updates", () => {
    it("emits commentCountUpdate when counts change", async () => {
      const { daemon, ghClient } = setupDaemon();
      // Set botLogin so updateCommentCounts doesn't bail early
      (daemon as any).botLogin = "developer";
      const pr = makePR();
      vi.spyOn(ghClient, "getMyOpenPRs").mockResolvedValue([pr]);
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
      vi.spyOn(ghClient, "getPRComments").mockResolvedValue([]);

      const counts: Array<[string, number]> = [];
      daemon.on("commentCountUpdate", (branch: string, count: number) => {
        counts.push([branch, count]);
      });

      await (daemon as any).discover();

      expect(counts).toHaveLength(1);
      expect(counts[0]).toEqual(["feature-branch", 1]);
    });
  });

  describe("CI status updates", () => {
    it("extracts CI status from PR data and emits ciStatusUpdate", async () => {
      const { daemon, ghClient } = setupDaemon();
      const pr = makePR({
        commits: {
          nodes: [{
            commit: {
              statusCheckRollup: {
                contexts: {
                  nodes: [
                    { name: "build", status: "COMPLETED", conclusion: "SUCCESS" },
                    { name: "test", status: "COMPLETED", conclusion: "SUCCESS" },
                  ],
                },
              },
            },
          }],
        },
      });

      vi.spyOn(ghClient, "getMyOpenPRs").mockResolvedValue([pr]);
      vi.spyOn(ghClient, "getReviewThreads").mockResolvedValue([]);
      vi.spyOn(ghClient, "getPRComments").mockResolvedValue([]);

      const statuses: Array<[string, string]> = [];
      daemon.on("ciStatusUpdate", (branch: string, status: string) => {
        statuses.push([branch, status]);
      });

      await (daemon as any).discover();

      expect(statuses).toHaveLength(1);
      expect(statuses[0]).toEqual(["feature-branch", "passing"]);
    });

    it("detects failing CI immediately when any check fails", async () => {
      const { daemon, ghClient } = setupDaemon();
      const pr = makePR({
        commits: {
          nodes: [{
            commit: {
              statusCheckRollup: {
                contexts: {
                  nodes: [
                    { name: "build", status: "COMPLETED", conclusion: "FAILURE" },
                    { name: "test", status: "IN_PROGRESS", conclusion: null },
                  ],
                },
              },
            },
          }],
        },
      });

      vi.spyOn(ghClient, "getMyOpenPRs").mockResolvedValue([pr]);
      vi.spyOn(ghClient, "getReviewThreads").mockResolvedValue([]);
      vi.spyOn(ghClient, "getPRComments").mockResolvedValue([]);

      const statuses: Array<[string, string]> = [];
      daemon.on("ciStatusUpdate", (branch: string, status: string) => {
        statuses.push([branch, status]);
      });

      await (daemon as any).discover();

      expect(statuses[0][1]).toBe("failing");
    });

    it("reports pending when checks are still running", async () => {
      const { daemon, ghClient } = setupDaemon();
      const pr = makePR({
        commits: {
          nodes: [{
            commit: {
              statusCheckRollup: {
                contexts: {
                  nodes: [
                    { name: "build", status: "IN_PROGRESS", conclusion: null },
                  ],
                },
              },
            },
          }],
        },
      });

      vi.spyOn(ghClient, "getMyOpenPRs").mockResolvedValue([pr]);
      vi.spyOn(ghClient, "getReviewThreads").mockResolvedValue([]);
      vi.spyOn(ghClient, "getPRComments").mockResolvedValue([]);

      const statuses: Array<[string, string]> = [];
      daemon.on("ciStatusUpdate", (branch: string, status: string) => {
        statuses.push([branch, status]);
      });

      await (daemon as any).discover();

      expect(statuses[0][1]).toBe("pending");
    });
  });

  describe("session management", () => {
    it("prevents starting session on currently checked-out branch", async () => {
      const { daemon, ghClient } = setupDaemon();
      const pr = makePR({ headRefName: "main" });
      vi.spyOn(ghClient, "getMyOpenPRs").mockResolvedValue([pr]);
      vi.spyOn(ghClient, "getReviewThreads").mockResolvedValue([]);
      vi.spyOn(ghClient, "getPRComments").mockResolvedValue([]);

      // The exec mock returns "main" as current branch
      await (daemon as any).discover();

      const events: string[] = [];
      daemon.on("prUpdate", () => events.push("update"));

      await daemon.startBranch("main");

      const lastState = daemon.getLastStates().get("main");
      expect(lastState?.status).toBe("error");
      expect(lastState?.error).toContain("checked out locally");
    });

    it("prevents duplicate sessions for same branch", async () => {
      const { daemon, ghClient } = setupDaemon();
      const pr = makePR();
      vi.spyOn(ghClient, "getMyOpenPRs").mockResolvedValue([pr]);
      vi.spyOn(ghClient, "getReviewThreads").mockResolvedValue([]);
      vi.spyOn(ghClient, "getPRComments").mockResolvedValue([]);

      await (daemon as any).discover();

      // Mock getCurrentBranch to return something different
      vi.spyOn(daemon as any, "getCurrentBranch").mockResolvedValue("other-branch");

      // Prevent actual session launch by spying on launchSession
      vi.spyOn(daemon as any, "launchSession").mockResolvedValue(undefined);

      await daemon.startBranch("feature-branch");
      // Simulate session being in the map
      (daemon as any).sessions.set("feature-branch", { controller: null, promise: Promise.resolve() });

      await daemon.startBranch("feature-branch"); // Should be a no-op
      expect((daemon as any).launchSession).toHaveBeenCalledTimes(1);
    });

    it("does nothing when starting session for unknown branch", async () => {
      const { daemon } = setupDaemon();

      const launchSpy = vi.spyOn(daemon as any, "launchSession");
      await daemon.startBranch("nonexistent-branch");
      expect(launchSpy).not.toHaveBeenCalled();
    });

    it("prevents concurrent startBranch calls for the same branch", async () => {
      const { daemon, ghClient } = setupDaemon();
      const pr = makePR();
      vi.spyOn(ghClient, "getMyOpenPRs").mockResolvedValue([pr]);
      vi.spyOn(ghClient, "getReviewThreads").mockResolvedValue([]);
      vi.spyOn(ghClient, "getPRComments").mockResolvedValue([]);

      await (daemon as any).discover();

      vi.spyOn(daemon as any, "getCurrentBranch").mockResolvedValue("other-branch");

      // Make launchSession take some time so both calls overlap
      let launchCount = 0;
      vi.spyOn(daemon as any, "launchSession").mockImplementation(async () => {
        launchCount++;
        await new Promise((r) => setTimeout(r, 50));
      });

      // Fire two concurrent startBranch calls (simulates rapid button presses)
      await Promise.all([
        daemon.startBranch("feature-branch"),
        daemon.startBranch("feature-branch"),
      ]);

      expect(launchCount).toBe(1);
    });

    it("startAll launches branches concurrently via mapWithConcurrency", async () => {
      const { daemon, ghClient } = setupDaemon();
      const prs = [
        makePR({ headRefName: "branch-a", number: 1 }),
        makePR({ headRefName: "branch-b", number: 2 }),
        makePR({ headRefName: "branch-c", number: 3 }),
      ];
      vi.spyOn(ghClient, "getMyOpenPRs").mockResolvedValue(prs);
      vi.spyOn(ghClient, "getReviewThreads").mockResolvedValue([]);
      vi.spyOn(ghClient, "getPRComments").mockResolvedValue([]);

      await (daemon as any).discover();

      // Track startBranch calls
      const started: string[] = [];
      vi.spyOn(daemon, "startBranch").mockImplementation(async (branch: string) => {
        started.push(branch);
      });

      await daemon.startAll("once");

      expect(started).toEqual(expect.arrayContaining(["branch-a", "branch-b", "branch-c"]));
      expect(started).toHaveLength(3);
    });

    it("startAll respects maxConcurrentSessions from settings", async () => {
      const { daemon, ghClient } = setupDaemon();
      const prs = [
        makePR({ headRefName: "branch-a", number: 1 }),
        makePR({ headRefName: "branch-b", number: 2 }),
      ];
      vi.spyOn(ghClient, "getMyOpenPRs").mockResolvedValue(prs);
      vi.spyOn(ghClient, "getReviewThreads").mockResolvedValue([]);
      vi.spyOn(ghClient, "getPRComments").mockResolvedValue([]);

      await (daemon as any).discover();

      // Mock settings to return a custom max
      const { loadSettings } = await import("../src/utils/settings.js");
      (loadSettings as ReturnType<typeof vi.fn>).mockReturnValue({ maxConcurrentSessions: 5 });

      const started: string[] = [];
      vi.spyOn(daemon, "startBranch").mockImplementation(async (branch: string) => {
        started.push(branch);
      });

      await daemon.startAll("once");

      expect(started).toHaveLength(2);
    });
  });

  describe("config management", () => {
    it("updates config and propagates to existing sessions", () => {
      const { daemon } = setupDaemon();
      const events: any[] = [];
      daemon.on("configUpdate", (config: any) => events.push(config));

      daemon.updateConfig({ pollInterval: 60 });

      expect(daemon.getConfig().pollInterval).toBe(60);
      expect(events).toHaveLength(1);
    });
  });

  describe("external branches", () => {
    it("tracks external branches and fetches their data", async () => {
      const { daemon, ghClient } = setupDaemon();

      vi.spyOn(ghClient, "getMyOpenPRs").mockResolvedValue([]);
      vi.spyOn(ghClient, "getReviewThreads").mockResolvedValue([]);
      vi.spyOn(ghClient, "getPRComments").mockResolvedValue([]);

      const discovered: string[] = [];
      daemon.on("prDiscovered", (branch: string) => discovered.push(branch));

      const externalPR = makePR({ headRefName: "external-branch", author: { login: "other-dev" } });
      await daemon.addExternalBranch(externalPR);

      expect(discovered).toContain("external-branch");
      expect(daemon.getDiscoveredPRs().has("external-branch")).toBe(true);
    });

    it("does not add duplicate external branches", async () => {
      const { daemon, ghClient } = setupDaemon();

      vi.spyOn(ghClient, "getMyOpenPRs").mockResolvedValue([]);
      vi.spyOn(ghClient, "getReviewThreads").mockResolvedValue([]);
      vi.spyOn(ghClient, "getPRComments").mockResolvedValue([]);

      const externalPR = makePR({ headRefName: "external-branch" });
      await daemon.addExternalBranch(externalPR);
      await daemon.addExternalBranch(externalPR);

      // Should only be in discoveredPRs once
      expect(daemon.getDiscoveredPRs().size).toBe(1);
    });
  });

  describe("ready status", () => {
    it("sets status to ready when CI passes and 0 unresolved comments", async () => {
      const { daemon, ghClient } = setupDaemon();
      const pr = makePR({
        commits: {
          nodes: [{
            commit: {
              statusCheckRollup: {
                contexts: {
                  nodes: [{ name: "build", status: "COMPLETED", conclusion: "SUCCESS" }],
                },
              },
            },
          }],
        },
      });

      vi.spyOn(ghClient, "getMyOpenPRs").mockResolvedValue([pr]);
      vi.spyOn(ghClient, "getReviewThreads").mockResolvedValue([]);
      vi.spyOn(ghClient, "getPRComments").mockResolvedValue([]);

      await (daemon as any).discover();

      // Set a stopped last state
      (daemon as any).lastStates.set("feature-branch", {
        status: "stopped",
        branch: "feature-branch",
      });

      // Re-run discovery to trigger ready check
      await (daemon as any).discover();

      const lastState = daemon.getLastStates().get("feature-branch");
      expect(lastState?.status).toBe("ready");
    });
  });

  describe("initialDiscoveryComplete", () => {
    it("emits initialDiscoveryComplete after first discovery", async () => {
      const { daemon, ghClient } = setupDaemon();
      vi.spyOn(ghClient, "getMyOpenPRs").mockResolvedValue([]);
      vi.spyOn(ghClient, "getReviewThreads").mockResolvedValue([]);
      vi.spyOn(ghClient, "getPRComments").mockResolvedValue([]);

      let initialComplete = false;
      daemon.on("initialDiscoveryComplete", () => {
        initialComplete = true;
      });

      expect(daemon.hasCompletedInitialDiscovery()).toBe(false);
      await (daemon as any).discover();
      expect(daemon.hasCompletedInitialDiscovery()).toBe(true);
      expect(initialComplete).toBe(true);
    });
  });

  describe("refreshNow", () => {
    it("sets skipNextSleep flag and aborts current sleep", async () => {
      const { daemon } = setupDaemon();
      await daemon.refreshNow();
      expect((daemon as any).skipNextSleep).toBe(true);
    });
  });

  describe("clearMergedPRs", () => {
    it("clears merged PRs and emits prUpdate", () => {
      const { daemon } = setupDaemon();
      (daemon as any).mergedPRs.set("branch", { pr: makePR(), mergedAt: Date.now() });

      const events: string[] = [];
      daemon.on("prUpdate", () => events.push("update"));

      daemon.clearMergedPRs();

      expect(daemon.getMergedPRs().size).toBe(0);
      expect(events).toHaveLength(1);
    });
  });
});
