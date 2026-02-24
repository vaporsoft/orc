import { describe, it, expect, vi, beforeEach } from "vitest";
import { GHClient } from "../src/github/gh-client.js";
import { RateLimitError } from "../src/utils/retry.js";
import * as processUtil from "../src/utils/process.js";

vi.mock("../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("GHClient", () => {
  let execSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    execSpy = vi.spyOn(processUtil, "exec");
  });

  describe("rate limit detection", () => {
    it("converts rate limit errors to RateLimitError", async () => {
      execSpy.mockRejectedValue(new Error("API rate limit exceeded for user"));
      const client = new GHClient("/repo");

      await expect(client.getRepoInfo()).rejects.toThrow(RateLimitError);
    });

    it("converts abuse detection errors to RateLimitError", async () => {
      execSpy.mockRejectedValue(new Error("abuse detection mechanism triggered"));
      const client = new GHClient("/repo");

      await expect(client.getRepoInfo()).rejects.toThrow(RateLimitError);
    });

    it("passes through non-rate-limit errors as-is", async () => {
      execSpy.mockRejectedValue(new Error("network timeout"));
      const client = new GHClient("/repo");

      await expect(client.getRepoInfo()).rejects.toThrow("network timeout");
      await expect(client.getRepoInfo()).rejects.not.toThrow(RateLimitError);
    });
  });

  describe("getRepoInfo", () => {
    it("parses owner and repo from gh output", async () => {
      execSpy.mockResolvedValue({
        stdout: JSON.stringify({ owner: { login: "acme" }, name: "app" }),
        stderr: "",
        exitCode: 0,
      });

      const client = new GHClient("/repo");
      const info = await client.getRepoInfo();
      expect(info).toEqual({ owner: "acme", repo: "app" });
    });

    it("caches repo info after first call", async () => {
      execSpy.mockResolvedValue({
        stdout: JSON.stringify({ owner: { login: "acme" }, name: "app" }),
        stderr: "",
        exitCode: 0,
      });

      const client = new GHClient("/repo");
      await client.getRepoInfo();
      await client.getRepoInfo();

      // gh should only be called once
      expect(execSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("getCurrentUser", () => {
    it("parses login from gh output", async () => {
      execSpy.mockResolvedValue({
        stdout: "octocat\n",
        stderr: "",
        exitCode: 0,
      });

      const client = new GHClient("/repo");
      const user = await client.getCurrentUser();
      expect(user).toBe("octocat");
    });

    it("caches user login", async () => {
      execSpy.mockResolvedValue({
        stdout: "octocat\n",
        stderr: "",
        exitCode: 0,
      });

      const client = new GHClient("/repo");
      await client.getCurrentUser();
      await client.getCurrentUser();
      expect(execSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("truncateLog", () => {
    it("returns short logs unchanged", () => {
      const client = new GHClient("/repo");
      const log = "short log output";
      const result = (client as any).truncateLog(log, 1000);
      expect(result).toBe(log);
    });

    it("truncates long logs keeping the tail (where errors usually are)", () => {
      const client = new GHClient("/repo");
      const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}: ${"x".repeat(50)}`);
      const log = lines.join("\n");
      const result = (client as any).truncateLog(log, 500);

      expect(result).toContain("... (truncated");
      expect(result).toContain("Line 100");
      expect(result.length).toBeLessThan(log.length);
    });
  });

  describe("getReviewThreads", () => {
    it("paginates through multiple pages", async () => {
      const client = new GHClient("/repo");

      // Mock getRepoInfo
      execSpy.mockResolvedValueOnce({
        stdout: JSON.stringify({ owner: { login: "acme" }, name: "app" }),
        stderr: "",
        exitCode: 0,
      });

      // Page 1
      execSpy.mockResolvedValueOnce({
        stdout: JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  pageInfo: { hasNextPage: true, endCursor: "cursor1" },
                  nodes: [{ id: "t1", isResolved: false, isOutdated: false, comments: { pageInfo: { hasNextPage: false }, nodes: [] } }],
                },
              },
            },
          },
        }),
        stderr: "",
        exitCode: 0,
      });

      // Page 2
      execSpy.mockResolvedValueOnce({
        stdout: JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [{ id: "t2", isResolved: false, isOutdated: false, comments: { pageInfo: { hasNextPage: false }, nodes: [] } }],
                },
              },
            },
          },
        }),
        stderr: "",
        exitCode: 0,
      });

      const threads = await client.getReviewThreads(1);
      expect(threads).toHaveLength(2);
      expect(threads[0].id).toBe("t1");
      expect(threads[1].id).toBe("t2");
    });
  });

  describe("isPRMerged", () => {
    it("returns true for merged PRs", async () => {
      const client = new GHClient("/repo");

      // Mock getRepoInfo
      execSpy.mockResolvedValueOnce({
        stdout: JSON.stringify({ owner: { login: "acme" }, name: "app" }),
        stderr: "",
        exitCode: 0,
      });

      execSpy.mockResolvedValueOnce({
        stdout: "true\n",
        stderr: "",
        exitCode: 0,
      });

      expect(await client.isPRMerged(1)).toBe(true);
    });

    it("returns false for non-merged PRs", async () => {
      const client = new GHClient("/repo");

      execSpy.mockResolvedValueOnce({
        stdout: JSON.stringify({ owner: { login: "acme" }, name: "app" }),
        stderr: "",
        exitCode: 0,
      });

      execSpy.mockResolvedValueOnce({
        stdout: "false\n",
        stderr: "",
        exitCode: 0,
      });

      expect(await client.isPRMerged(1)).toBe(false);
    });

    it("returns false on API error", async () => {
      const client = new GHClient("/repo");

      execSpy.mockResolvedValueOnce({
        stdout: JSON.stringify({ owner: { login: "acme" }, name: "app" }),
        stderr: "",
        exitCode: 0,
      });

      execSpy.mockRejectedValueOnce(new Error("network error"));

      expect(await client.isPRMerged(1)).toBe(false);
    });
  });

  describe("requestReviewers", () => {
    it("does nothing for empty reviewer list", async () => {
      const client = new GHClient("/repo");
      await client.requestReviewers(1, []);
      // No exec calls beyond what might be cached
      expect(execSpy).not.toHaveBeenCalled();
    });
  });

  describe("graphql", () => {
    it("passes number variables with -F flag", async () => {
      const client = new GHClient("/repo");

      execSpy.mockResolvedValue({
        stdout: JSON.stringify({ data: {} }),
        stderr: "",
        exitCode: 0,
      });

      await client.graphql("query { test }", { count: 10, name: "test" });

      const callArgs = execSpy.mock.calls[0][1] as string[];
      // Number values should use -F flag
      expect(callArgs).toContain("-F");
      expect(callArgs).toContain("count=10");
      // String values should use -f flag
      const fIndices = callArgs.reduce<number[]>((acc, arg, i) => {
        if (arg === "-f") acc.push(i);
        return acc;
      }, []);
      const fValues = fIndices.map((i) => callArgs[i + 1]);
      expect(fValues).toContain("name=test");
    });
  });
});
