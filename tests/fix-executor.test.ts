import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { FixExecutor } from "../src/core/fix-executor.js";
import { DEFAULT_CONFIG } from "../src/types/config.js";
import type { CategorizedComment, RepoConfig } from "../src/types/index.js";

vi.mock("../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock the Claude Code SDK
const mockQueryResults: Array<{ type: string; [key: string]: unknown }> = [];

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(() => ({
    async *[Symbol.asyncIterator]() {
      for (const msg of mockQueryResults) {
        yield msg;
      }
    },
  })),
}));

function makeRepoConfig(overrides: Partial<RepoConfig> = {}): RepoConfig {
  return {
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
    ...overrides,
  };
}

function makeComment(overrides: Partial<CategorizedComment> = {}): CategorizedComment {
  return {
    threadId: "t1",
    path: "src/main.ts",
    line: 10,
    body: "This variable is unused",
    author: "reviewer",
    diffHunk: "@@ -1,5 +1,5 @@",
    category: "should_fix",
    confidence: 0.9,
    reasoning: "Valid concern",
    suggestedAction: "Remove the unused variable",
    ...overrides,
  };
}

describe("FixExecutor", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orc-fix-test-"));
    mockQueryResults.length = 0;
    mockQueryResults.push({
      type: "result",
      subtype: "success",
      result: "Fixed the issue",
      total_cost_usd: 0.05,
      session_id: "sess-123",
      is_error: false,
      usage: { input_tokens: 500, output_tokens: 200 },
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("buildPrompt", () => {
    it("groups comments by severity", () => {
      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir);
      const comments = [
        makeComment({ category: "must_fix", threadId: "t1" }),
        makeComment({ category: "should_fix", threadId: "t2" }),
        makeComment({ category: "nice_to_have", threadId: "t3" }),
        makeComment({ category: "verify_and_fix", threadId: "t4" }),
      ];

      const prompt = (executor as any).buildPrompt(comments, makeRepoConfig());
      expect(prompt).toContain("## Must Fix");
      expect(prompt).toContain("## Should Fix");
      expect(prompt).toContain("## Nice to Have");
      expect(prompt).toContain("## Verify and Fix");
    });

    it("includes verify results file instructions for verify_and_fix comments", () => {
      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir);
      const comments = [
        makeComment({ category: "verify_and_fix", threadId: "t1" }),
      ];

      const prompt = (executor as any).buildPrompt(comments, makeRepoConfig());
      expect(prompt).toContain(".orc-verify.json");
      expect(prompt).toContain("`t1`");
    });

    it("includes fix summary file instructions for regular comments", () => {
      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir);
      const comments = [
        makeComment({ category: "should_fix", threadId: "t1" }),
      ];

      const prompt = (executor as any).buildPrompt(comments, makeRepoConfig());
      expect(prompt).toContain(".orc-fix-summary.json");
    });

    it("does not include fix summary section when only verify_and_fix comments", () => {
      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir);
      const comments = [
        makeComment({ category: "verify_and_fix", threadId: "t1" }),
      ];

      const prompt = (executor as any).buildPrompt(comments, makeRepoConfig());
      expect(prompt).not.toContain("## Fix Summaries");
    });

    it("includes repo instructions when present", () => {
      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir);
      const comments = [makeComment()];
      const config = makeRepoConfig({ instructions: "Use Prettier for formatting" });

      const prompt = (executor as any).buildPrompt(comments, config);
      expect(prompt).toContain("Use Prettier for formatting");
    });

    it("truncates long comment bodies in thread ID listing", () => {
      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir);
      const longBody = "x".repeat(100);
      const comments = [makeComment({ body: longBody })];

      const prompt = (executor as any).buildPrompt(comments, makeRepoConfig());
      expect(prompt).toContain("...");
    });
  });

  describe("buildSystemSuffix", () => {
    it("generates review mode suffix", () => {
      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir);
      const suffix = (executor as any).buildSystemSuffix(makeRepoConfig(), "review");
      expect(suffix).toContain("fixing PR review feedback");
      expect(suffix).toContain("fixup commits");
    });

    it("generates CI mode suffix with fixup commit instructions", () => {
      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir);
      const suffix = (executor as any).buildSystemSuffix(makeRepoConfig(), "ci");
      expect(suffix).toContain("CI/CD pipeline failures");
      expect(suffix).toContain("fixup commits");
      expect(suffix).toContain("git commit --fixup=<sha>");
      expect(suffix).not.toContain('fix(ci):');
    });

    it("generates conflict mode suffix", () => {
      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir);
      const suffix = (executor as any).buildSystemSuffix(makeRepoConfig(), "conflict");
      expect(suffix).toContain("merge conflicts");
      expect(suffix).toContain("Do NOT run git commands");
    });

    it("appends verify commands for review mode", () => {
      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir);
      const config = makeRepoConfig({ verifyCommands: ["yarn lint", "yarn test"] });
      const suffix = (executor as any).buildSystemSuffix(config, "review");
      expect(suffix).toContain("`yarn lint`");
      expect(suffix).toContain("`yarn test`");
    });

    it("does not append verify commands for conflict mode", () => {
      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir);
      const config = makeRepoConfig({ verifyCommands: ["yarn lint"] });
      const suffix = (executor as any).buildSystemSuffix(config, "conflict");
      expect(suffix).not.toContain("`yarn lint`");
    });

    it("mentions MCP servers in CI mode when configured", () => {
      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir);
      const config = makeRepoConfig({
        mcpServers: {
          buildkite: { command: "npx", args: ["-y", "@anthropic-ai/mcp-server-buildkite"], env: {} },
        },
      });
      const suffix = (executor as any).buildSystemSuffix(config, "ci");
      expect(suffix).toContain("MCP");
    });
  });

  describe("resolveEnvVars", () => {
    it("resolves allowed env vars from process.env", () => {
      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir);
      const original = process.env.ORC_TEST_VAR;
      process.env.ORC_TEST_VAR = "resolved-value";

      try {
        const result = (executor as any).resolveEnvVars(
          { KEY: "${ORC_TEST_VAR}" },
          ["ORC_TEST_VAR"],
        );
        expect(result.KEY).toBe("resolved-value");
      } finally {
        if (original === undefined) {
          delete process.env.ORC_TEST_VAR;
        } else {
          process.env.ORC_TEST_VAR = original;
        }
      }
    });

    it("replaces disallowed vars with empty string", () => {
      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir);
      const result = (executor as any).resolveEnvVars(
        { KEY: "${SECRET_KEY}" },
        [], // empty allowlist
      );
      expect(result.KEY).toBe("");
    });

    it("replaces missing env vars with empty string", () => {
      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir);
      delete process.env.NONEXISTENT_VAR_12345;

      const result = (executor as any).resolveEnvVars(
        { KEY: "${NONEXISTENT_VAR_12345}" },
        ["NONEXISTENT_VAR_12345"],
      );
      expect(result.KEY).toBe("");
    });
  });

  describe("readVerifyResults", () => {
    it("reads and parses .orc-verify.json", async () => {
      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir);
      const verifyData = {
        t1: { status: "fixed", summary: "Removed dead code" },
        t2: { status: "not_applicable", reason: "Code is used in tests" },
      };
      fs.writeFileSync(
        path.join(tmpDir, ".orc-verify.json"),
        JSON.stringify(verifyData),
      );

      const comments = [
        makeComment({ threadId: "t1", category: "verify_and_fix" }),
        makeComment({ threadId: "t2", category: "verify_and_fix" }),
      ];

      const results = await (executor as any).readVerifyResults(comments);
      expect(results.get("t1")).toEqual({ status: "fixed", summary: "Removed dead code" });
      expect(results.get("t2")).toEqual({ status: "not_applicable", reason: "Code is used in tests" });
    });

    it("cleans up the verify file after reading", async () => {
      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir);
      fs.writeFileSync(
        path.join(tmpDir, ".orc-verify.json"),
        JSON.stringify({ t1: { status: "fixed" } }),
      );

      const comments = [makeComment({ category: "verify_and_fix" })];
      await (executor as any).readVerifyResults(comments);

      expect(fs.existsSync(path.join(tmpDir, ".orc-verify.json"))).toBe(false);
    });

    it("returns empty map when no verify_and_fix comments", async () => {
      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir);
      const comments = [makeComment({ category: "should_fix" })];

      const results = await (executor as any).readVerifyResults(comments);
      expect(results.size).toBe(0);
    });

    it("returns 'unknown' fallback when file is missing", async () => {
      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir);
      const comments = [makeComment({ category: "verify_and_fix" })];

      const results = await (executor as any).readVerifyResults(comments);
      expect(results.get("t1")?.status).toBe("unknown");
    });
  });

  describe("readFixSummaries", () => {
    it("reads and parses .orc-fix-summary.json", async () => {
      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir);
      fs.writeFileSync(
        path.join(tmpDir, ".orc-fix-summary.json"),
        JSON.stringify({ t1: "Renamed variable to camelCase" }),
      );

      const comments = [makeComment({ category: "should_fix" })];
      const results = await (executor as any).readFixSummaries(comments);
      expect(results.get("t1")).toBe("Renamed variable to camelCase");
    });

    it("cleans up the summary file after reading", async () => {
      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir);
      fs.writeFileSync(
        path.join(tmpDir, ".orc-fix-summary.json"),
        JSON.stringify({ t1: "Done" }),
      );

      const comments = [makeComment({ category: "should_fix" })];
      await (executor as any).readFixSummaries(comments);

      expect(fs.existsSync(path.join(tmpDir, ".orc-fix-summary.json"))).toBe(false);
    });

    it("returns empty map when file is missing", async () => {
      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir);
      const comments = [makeComment({ category: "should_fix" })];

      const results = await (executor as any).readFixSummaries(comments);
      expect(results.size).toBe(0);
    });

    it("skips empty string summaries", async () => {
      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir);
      fs.writeFileSync(
        path.join(tmpDir, ".orc-fix-summary.json"),
        JSON.stringify({ t1: "", t2: "Valid summary" }),
      );

      const comments = [
        makeComment({ threadId: "t1", category: "should_fix" }),
        makeComment({ threadId: "t2", category: "should_fix" }),
      ];
      const results = await (executor as any).readFixSummaries(comments);
      expect(results.has("t1")).toBe(false);
      expect(results.get("t2")).toBe("Valid summary");
    });

    it("returns empty map for verify_and_fix-only comments", async () => {
      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir);
      const comments = [makeComment({ category: "verify_and_fix" })];

      const results = await (executor as any).readFixSummaries(comments);
      expect(results.size).toBe(0);
    });
  });

  describe("summarizeTool", () => {
    it("summarizes Read tool", () => {
      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir);
      expect((executor as any).summarizeTool("Read", { file_path: "/src/main.ts" })).toBe("Reading main.ts");
    });

    it("summarizes Edit tool", () => {
      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir);
      expect((executor as any).summarizeTool("Edit", { file_path: "/src/main.ts" })).toBe("Editing main.ts");
    });

    it("summarizes Bash tool with command truncation", () => {
      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir);
      const longCmd = "a".repeat(100);
      const result = (executor as any).summarizeTool("Bash", { command: longCmd });
      expect(result).toContain("Running:");
      expect(result).toContain("…"); // truncated
      expect(result.length).toBeLessThan(100);
    });

    it("summarizes Grep tool", () => {
      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir);
      expect((executor as any).summarizeTool("Grep", { pattern: "TODO" })).toBe("Searching: TODO");
    });

    it("summarizes unknown tools", () => {
      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir);
      expect((executor as any).summarizeTool("CustomTool", {})).toBe("Using CustomTool");
    });

    it("handles missing input", () => {
      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir);
      expect((executor as any).summarizeTool("Read", undefined)).toBe("Reading file");
    });
  });

  describe("buildExtraTools", () => {
    it("converts allowed commands to Bash tool permissions", () => {
      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir);
      const config = makeRepoConfig({ allowedCommands: ["yarn *", "npm run *"] });

      const tools = (executor as any).buildExtraTools(config);
      expect(tools).toEqual(["Bash(yarn *)", "Bash(npm run *)"]);
    });

    it("returns empty array when no allowed commands", () => {
      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir);
      const tools = (executor as any).buildExtraTools(makeRepoConfig());
      expect(tools).toEqual([]);
    });
  });

  describe("execute (integration with mock SDK)", () => {
    it("returns fix result with cost and session info", async () => {
      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir);
      const result = await executor.execute([makeComment()], makeRepoConfig());

      expect(result.sessionId).toBeTruthy();
      expect(result.isError).toBe(false);
    });

    it("handles SDK error gracefully", async () => {
      mockQueryResults.length = 0;
      // Simulate SDK throwing
      const { query } = await import("@anthropic-ai/claude-agent-sdk");
      (query as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw new Error("SDK crash");
      });

      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir);
      const result = await executor.execute([makeComment()], makeRepoConfig());

      expect(result.isError).toBe(true);
      expect(result.errors).toContain("SDK crash");
    });

    it("returns error when no result message received", async () => {
      mockQueryResults.length = 0;
      // Only non-result messages
      mockQueryResults.push({ type: "assistant", session_id: "sess-1" });

      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir);
      const result = await executor.execute([makeComment()], makeRepoConfig());

      expect(result.isError).toBe(true);
      expect(result.errors[0]).toContain("No result message");
    });

    it("invokes onActivity callback for tool use messages", async () => {
      mockQueryResults.length = 0;
      mockQueryResults.push({
        type: "assistant",
        session_id: "sess-1",
        message: {
          content: [{ type: "tool_use", name: "Read", input: { file_path: "/src/main.ts" } }],
        },
      });
      mockQueryResults.push({
        type: "result",
        subtype: "success",
        result: "Done",
        total_cost_usd: 0.01,
        is_error: false,
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const activities: string[] = [];
      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir);
      await executor.execute([makeComment()], makeRepoConfig(), undefined, (line) => {
        activities.push(line);
      });

      expect(activities).toContain("Reading main.ts");
    });

    it("logs Claude Code session messages to logger with branch tag", async () => {
      const { logger } = await import("../src/utils/logger.js");

      mockQueryResults.length = 0;
      mockQueryResults.push({
        type: "assistant",
        session_id: "sess-log",
        message: {
          content: [
            { type: "tool_use", name: "Edit", input: { file_path: "/src/index.ts" } },
          ],
        },
      });
      mockQueryResults.push({
        type: "assistant",
        session_id: "sess-log",
        message: {
          content: [
            { type: "text", text: "I fixed the build error" },
          ],
        },
      });
      mockQueryResults.push({
        type: "result",
        subtype: "success",
        result: "Done",
        total_cost_usd: 0.02,
        is_error: false,
        usage: { input_tokens: 200, output_tokens: 100 },
      });

      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir, "feat/my-branch");
      await executor.execute([makeComment()], makeRepoConfig());

      const infoCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls;
      const editCall = infoCalls.find((c: unknown[]) => c[0] === "[claude] Editing index.ts");
      expect(editCall).toBeDefined();
      expect(editCall![1]).toBe("feat/my-branch");

      const textCall = infoCalls.find((c: unknown[]) => c[0] === "[claude] I fixed the build error");
      expect(textCall).toBeDefined();
      expect(textCall![1]).toBe("feat/my-branch");
    });

    it("logs Claude Code session messages even without onActivity callback", async () => {
      const { logger } = await import("../src/utils/logger.js");

      mockQueryResults.length = 0;
      mockQueryResults.push({
        type: "assistant",
        session_id: "sess-no-cb",
        message: {
          content: [
            { type: "tool_use", name: "Bash", input: { command: "yarn build" } },
          ],
        },
      });
      mockQueryResults.push({
        type: "result",
        subtype: "success",
        result: "Done",
        total_cost_usd: 0.01,
        is_error: false,
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const executor = new FixExecutor(DEFAULT_CONFIG, tmpDir, "feat/ci-branch");
      // Call executeCIFix which doesn't always pass onActivity
      await executor.executeCIFix("CI failing", makeRepoConfig());

      const infoCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls;
      const bashCall = infoCalls.find((c: unknown[]) => c[0] === "[claude] Running: yarn build");
      expect(bashCall).toBeDefined();
      expect(bashCall![1]).toBe("feat/ci-branch");
    });
  });
});
