import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitManager } from "../src/core/git-manager.js";
import * as processUtil from "../src/utils/process.js";

vi.mock("../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("GitManager", () => {
  let execSpy: ReturnType<typeof vi.spyOn>;
  let manager: GitManager;

  beforeEach(() => {
    vi.restoreAllMocks();
    execSpy = vi.spyOn(processUtil, "exec");
    manager = new GitManager("/worktree/path", "feature-branch");
  });

  describe("rebaseAutosquash", () => {
    it("skips rebase when no fixup commits exist", async () => {
      execSpy.mockResolvedValueOnce({
        stdout: "", // no fixup commits
        stderr: "",
        exitCode: 0,
      });

      const result = await manager.rebaseAutosquash("main");
      expect(result).toBe(true);
      // Should only have the log check, not the actual rebase
      expect(execSpy).toHaveBeenCalledTimes(1);
    });

    it("performs rebase when fixup commits exist", async () => {
      execSpy
        .mockResolvedValueOnce({
          stdout: "fixup! initial commit\n",
          stderr: "",
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          stdout: "",
          stderr: "",
          exitCode: 0,
        });

      const result = await manager.rebaseAutosquash("main");
      expect(result).toBe(true);

      const rebaseCall = execSpy.mock.calls[1];
      expect(rebaseCall[1]).toContain("--autosquash");
    });

    it("aborts and returns false on rebase failure", async () => {
      execSpy
        .mockResolvedValueOnce({
          stdout: "fixup! some commit\n",
          stderr: "",
          exitCode: 0,
        })
        .mockRejectedValueOnce(new Error("rebase conflict"))
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }); // rebase --abort

      const result = await manager.rebaseAutosquash("main");
      expect(result).toBe(false);
    });

    it("skips rebase when log check fails (e.g. base branch not found)", async () => {
      execSpy.mockRejectedValueOnce(new Error("fatal: bad revision"));

      const result = await manager.rebaseAutosquash("nonexistent");
      expect(result).toBe(true); // gracefully skips
    });
  });

  describe("forcePushWithLease", () => {
    it("returns true on successful push", async () => {
      execSpy.mockResolvedValueOnce({
        stdout: "",
        stderr: "",
        exitCode: 0,
      });

      const result = await manager.forcePushWithLease();
      expect(result).toBe(true);

      const args = execSpy.mock.calls[0][1] as string[];
      expect(args).toContain("--force-with-lease");
      expect(args).toContain("HEAD:feature-branch");
    });

    it("returns false when push is rejected (does not retry)", async () => {
      execSpy.mockRejectedValueOnce(new Error("rejected by --force-with-lease"));

      const result = await manager.forcePushWithLease();
      expect(result).toBe(false);

      // Should NOT retry — critical safety behavior
      expect(execSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("hasUncommittedChanges", () => {
    it("returns false when working tree is clean", async () => {
      execSpy.mockResolvedValueOnce({
        stdout: "",
        stderr: "",
        exitCode: 0,
      });

      expect(await manager.hasUncommittedChanges()).toBe(false);
    });

    it("returns true when there are changes", async () => {
      execSpy.mockResolvedValueOnce({
        stdout: " M src/main.ts\n?? new-file.ts\n",
        stderr: "",
        exitCode: 0,
      });

      expect(await manager.hasUncommittedChanges()).toBe(true);
    });
  });

  describe("getHeadSha", () => {
    it("returns trimmed SHA", async () => {
      execSpy.mockResolvedValueOnce({
        stdout: "abc123def456\n",
        stderr: "",
        exitCode: 0,
      });

      expect(await manager.getHeadSha()).toBe("abc123def456");
    });
  });

  describe("isAheadOfRemote", () => {
    it("returns true when local has unpushed commits", async () => {
      execSpy.mockResolvedValueOnce({
        stdout: "3\n",
        stderr: "",
        exitCode: 0,
      });

      expect(await manager.isAheadOfRemote()).toBe(true);
    });

    it("returns false when local matches remote", async () => {
      execSpy.mockResolvedValueOnce({
        stdout: "0\n",
        stderr: "",
        exitCode: 0,
      });

      expect(await manager.isAheadOfRemote()).toBe(false);
    });

    it("returns true when determination fails (safe default)", async () => {
      execSpy.mockRejectedValueOnce(new Error("no tracking branch"));

      expect(await manager.isAheadOfRemote()).toBe(true);
    });
  });

  describe("discardChanges", () => {
    it("runs checkout . and clean -fd", async () => {
      execSpy.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

      await manager.discardChanges();

      expect(execSpy).toHaveBeenCalledTimes(2);
      expect(execSpy.mock.calls[0][1]).toContain("checkout");
      expect(execSpy.mock.calls[1][1]).toContain("clean");
    });
  });

  describe("pullRebase", () => {
    it("fetches and rebases onto target branch", async () => {
      execSpy
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // status (hasUncommittedChanges)
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // fetch
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }); // rebase

      const result = await manager.pullRebase("main");
      expect(result).toBe(true);

      // Verify fetch and rebase were called with correct args
      expect(execSpy.mock.calls[1][1]).toEqual(["fetch", "origin", "main"]);
      expect(execSpy.mock.calls[2][1]).toEqual(["rebase", "origin/main"]);
    });

    it("stashes changes before rebase and pops after", async () => {
      execSpy
        .mockResolvedValueOnce({ stdout: "M file.ts\n", stderr: "", exitCode: 0 }) // hasUncommittedChanges (dirty)
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // stash
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // fetch
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // rebase
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }); // stash pop

      const result = await manager.pullRebase("main");
      expect(result).toBe(true);

      // Verify stash was called
      expect(execSpy.mock.calls[1][1]).toEqual(["stash", "--include-untracked"]);
      // Verify stash pop was called last
      expect(execSpy.mock.calls[4][1]).toEqual(["stash", "pop"]);
    });

    it("aborts rebase on failure and returns false", async () => {
      execSpy
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // hasUncommittedChanges (clean)
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // fetch
        .mockRejectedValueOnce(new Error("conflict")) // rebase fails
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }); // rebase --abort

      const result = await manager.pullRebase("main");
      expect(result).toBe(false);
    });

    it("uses own branch name when no target specified", async () => {
      execSpy
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // hasUncommittedChanges
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // fetch
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }); // rebase

      await manager.pullRebase();
      expect(execSpy.mock.calls[1][1]).toEqual(["fetch", "origin", "feature-branch"]);
    });
  });

  describe("startConflictingRebase", () => {
    it("returns null when rebase succeeds without conflicts", async () => {
      execSpy
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // hasUncommittedChanges
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // fetch
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }); // rebase succeeds

      const result = await manager.startConflictingRebase("main");
      expect(result).toBeNull();
    });

    it("returns conflicting file list when rebase has conflicts", async () => {
      execSpy
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // hasUncommittedChanges
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // fetch
        .mockRejectedValueOnce(new Error("conflict")) // rebase fails
        .mockResolvedValueOnce({ stdout: "src/main.ts\nsrc/utils.ts\n", stderr: "", exitCode: 0 }); // diff --name-only

      const result = await manager.startConflictingRebase("main");
      expect(result).toEqual(["src/main.ts", "src/utils.ts"]);
    });

    it("returns empty array for non-conflict rebase failure", async () => {
      execSpy
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // hasUncommittedChanges
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // fetch
        .mockRejectedValueOnce(new Error("rebase error")) // rebase fails
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // diff shows no unmerged files
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }); // rebase --abort

      const result = await manager.startConflictingRebase("main");
      expect(result).toEqual([]);
    });
  });

  describe("continueRebase", () => {
    it("stages and continues, returns true on success", async () => {
      execSpy
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // git add .
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }); // rebase --continue

      const result = await manager.continueRebase();
      expect(result).toBe(true);
    });

    it("returns false when more conflicts arise", async () => {
      execSpy
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // git add .
        .mockRejectedValueOnce(new Error("conflict in next commit")) // rebase --continue fails
        .mockResolvedValueOnce({ stdout: "src/other.ts\n", stderr: "", exitCode: 0 }); // diff shows unmerged

      const result = await manager.continueRebase();
      expect(result).toBe(false);
    });
  });

  describe("getChangedFilesSince", () => {
    it("returns list of changed files", async () => {
      execSpy.mockResolvedValueOnce({
        stdout: "src/main.ts\nsrc/utils.ts\n",
        stderr: "",
        exitCode: 0,
      });

      const files = await manager.getChangedFilesSince("abc123");
      expect(files).toEqual(["src/main.ts", "src/utils.ts"]);
    });

    it("handles no changes", async () => {
      execSpy.mockResolvedValueOnce({
        stdout: "",
        stderr: "",
        exitCode: 0,
      });

      const files = await manager.getChangedFilesSince("abc123");
      expect(files).toEqual([]);
    });
  });

  describe("all commands use correct cwd", () => {
    it("passes worktree path as cwd", async () => {
      execSpy.mockResolvedValue({ stdout: "abc123\n", stderr: "", exitCode: 0 });
      await manager.getHeadSha();

      expect(execSpy.mock.calls[0][2]).toEqual({ cwd: "/worktree/path" });
    });
  });
});
