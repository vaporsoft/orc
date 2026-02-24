import { describe, it, expect, vi, beforeEach } from "vitest";
import { ThreadResponder } from "../src/core/thread-responder.js";
import type { GHClient } from "../src/github/gh-client.js";
import type { CategorizedComment } from "../src/types/index.js";

vi.mock("../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function makeComment(overrides: Partial<CategorizedComment> = {}): CategorizedComment {
  return {
    threadId: "t1",
    path: "src/main.ts",
    line: 10,
    body: "Fix this bug",
    author: "reviewer",
    diffHunk: "@@ -1,5 +1,5 @@",
    category: "should_fix",
    confidence: 0.9,
    reasoning: "Valid concern",
    suggestedAction: "Fix the bug",
    ...overrides,
  };
}

function makeGHClient(): GHClient & {
  addThreadReply: ReturnType<typeof vi.fn>;
  addPRComment: ReturnType<typeof vi.fn>;
  resolveThread: ReturnType<typeof vi.fn>;
  getRepoInfo: ReturnType<typeof vi.fn>;
} {
  return {
    addThreadReply: vi.fn().mockResolvedValue(undefined),
    addPRComment: vi.fn().mockResolvedValue(undefined),
    resolveThread: vi.fn().mockResolvedValue(undefined),
    getRepoInfo: vi.fn().mockResolvedValue({ owner: "acme", repo: "app" }),
  } as unknown as GHClient & {
    addThreadReply: ReturnType<typeof vi.fn>;
    addPRComment: ReturnType<typeof vi.fn>;
    resolveThread: ReturnType<typeof vi.fn>;
    getRepoInfo: ReturnType<typeof vi.fn>;
  };
}

describe("ThreadResponder", () => {
  let client: ReturnType<typeof makeGHClient>;
  let responder: ThreadResponder;

  beforeEach(() => {
    vi.clearAllMocks();
    client = makeGHClient();
    responder = new ThreadResponder(client as unknown as GHClient, "feature-branch", 42);
  });

  describe("replyToAddressed", () => {
    it("replies to inline thread and resolves it", async () => {
      const comment = makeComment();
      await responder.replyToAddressed([comment], "abc123def");

      expect(client.addThreadReply).toHaveBeenCalledTimes(1);
      const body = client.addThreadReply.mock.calls[0][1] as string;
      expect(body).toContain("Addressed in");
      expect(body).toContain("[abc123d]");
      expect(body).toContain("*Orc — should_fix (confidence: 0.90)*");

      expect(client.resolveThread).toHaveBeenCalledWith("t1");
    });

    it("uses fix summary when available", async () => {
      const comment = makeComment();
      const summaries = new Map([["t1", "Renamed the variable to camelCase"]]);
      await responder.replyToAddressed([comment], "abc123def", summaries);

      const body = client.addThreadReply.mock.calls[0][1] as string;
      expect(body).toContain("Renamed the variable to camelCase");
      expect(body).toContain("[abc123d]");
    });

    it("uses 'latest commit' when no SHA provided", async () => {
      const comment = makeComment();
      await responder.replyToAddressed([comment]);

      const body = client.addThreadReply.mock.calls[0][1] as string;
      expect(body).toContain("Addressed in latest commit.");
    });

    it("uses addPRComment for conversation comments and does not resolve", async () => {
      const comment = makeComment({ path: "(conversation)", body: "Please fix tests" });
      await responder.replyToAddressed([comment], "abc123def");

      expect(client.addPRComment).toHaveBeenCalledTimes(1);
      expect(client.addThreadReply).not.toHaveBeenCalled();
      expect(client.resolveThread).not.toHaveBeenCalled();

      const body = client.addPRComment.mock.calls[0][1] as string;
      // Conversation replies quote the original and tag the author
      expect(body).toContain("> Please fix tests");
      expect(body).toContain("@reviewer");
    });

    it("continues on reply failure", async () => {
      client.addThreadReply.mockRejectedValueOnce(new Error("API error"));
      const comments = [makeComment(), makeComment({ threadId: "t2" })];
      await responder.replyToAddressed(comments, "abc123def");

      // Should still attempt the second comment
      expect(client.addThreadReply).toHaveBeenCalledTimes(2);
    });

    it("continues on resolve failure", async () => {
      client.resolveThread.mockRejectedValueOnce(new Error("resolve failed"));
      await responder.replyToAddressed([makeComment()], "abc123def");

      // Reply should still succeed even if resolve fails
      expect(client.addThreadReply).toHaveBeenCalledTimes(1);
    });
  });

  describe("replyToSkipped", () => {
    it("posts skip reply for false_positive", async () => {
      const comment = makeComment({
        category: "false_positive",
        reasoning: "The code IS used in the test suite",
      });
      await responder.replyToSkipped([comment]);

      const body = client.addThreadReply.mock.calls[0][1] as string;
      expect(body).toContain("Took a look — skipping this one.");
      expect(body).toContain("The code IS used in the test suite");
      expect(body).toContain("[skipped]");
    });

    it("posts skip reply for disabled category", async () => {
      const comment = makeComment({ category: "nice_to_have" });
      await responder.replyToSkipped([comment]);

      const body = client.addThreadReply.mock.calls[0][1] as string;
      expect(body).toContain("auto-fix for `nice_to_have` is disabled");
      expect(body).toContain("[skipped]");
    });

    it("does not resolve thread on skip", async () => {
      await responder.replyToSkipped([makeComment()]);
      expect(client.resolveThread).not.toHaveBeenCalled();
    });

    it("quotes and tags author for conversation comments", async () => {
      const comment = makeComment({
        path: "(conversation)",
        body: "Some feedback",
        category: "false_positive",
        reasoning: "Not applicable",
      });
      await responder.replyToSkipped([comment]);

      const body = client.addPRComment.mock.calls[0][1] as string;
      expect(body).toContain("> Some feedback");
      expect(body).toContain("@reviewer");
    });
  });

  describe("replyToVerified", () => {
    it("replies with 'fixed' outcome and resolves thread", async () => {
      const comment = makeComment({ category: "verify_and_fix" });
      const results = new Map([["t1", { status: "fixed" as const, summary: "Removed the dead code" }]]);
      await responder.replyToVerified([comment], results, "abc123def");

      const body = client.addThreadReply.mock.calls[0][1] as string;
      expect(body).toContain("Removed the dead code");
      expect(body).toContain("[abc123d]");
      expect(client.resolveThread).toHaveBeenCalledWith("t1");
    });

    it("replies with generic message for fixed without summary", async () => {
      const comment = makeComment({ category: "verify_and_fix" });
      const results = new Map([["t1", { status: "fixed" as const }]]);
      await responder.replyToVerified([comment], results, "abc123def");

      const body = client.addThreadReply.mock.calls[0][1] as string;
      expect(body).toContain("Verified and addressed in");
    });

    it("replies with 'not_applicable' outcome without resolving", async () => {
      const comment = makeComment({ category: "verify_and_fix" });
      const results = new Map([["t1", { status: "not_applicable" as const, reason: "The method is actually called from tests" }]]);
      await responder.replyToVerified([comment], results, "abc123def");

      const body = client.addThreadReply.mock.calls[0][1] as string;
      expect(body).toContain("doesn't appear to apply here");
      expect(body).toContain("The method is actually called from tests");
      expect(client.resolveThread).not.toHaveBeenCalled();
    });

    it("replies with unknown outcome when no result exists", async () => {
      const comment = makeComment({ category: "verify_and_fix" });
      const results = new Map<string, never>(); // Empty map
      await responder.replyToVerified([comment], results, "abc123def");

      const body = client.addThreadReply.mock.calls[0][1] as string;
      expect(body).toContain("Wasn't able to verify");
    });

    it("does not resolve thread for conversation comments even when fixed", async () => {
      const comment = makeComment({ category: "verify_and_fix", path: "(conversation)" });
      const results = new Map([["t1", { status: "fixed" as const }]]);
      await responder.replyToVerified([comment], results, "abc123def");

      expect(client.resolveThread).not.toHaveBeenCalled();
    });
  });

  describe("replyToClarifications", () => {
    it("posts clarification question from comment", async () => {
      const comment = makeComment({
        category: "needs_clarification",
        clarificationQuestion: "Could you elaborate on what type you'd prefer?",
      });
      await responder.replyToClarifications([comment]);

      const body = client.addThreadReply.mock.calls[0][1] as string;
      expect(body).toContain("Could you elaborate on what type you'd prefer?");
      expect(body).toContain("*Orc — needs_clarification");
    });

    it("uses default question when clarificationQuestion is missing", async () => {
      const comment = makeComment({ category: "needs_clarification" });
      await responder.replyToClarifications([comment]);

      const body = client.addThreadReply.mock.calls[0][1] as string;
      expect(body).toContain("Could you clarify what change you'd like here?");
    });

    it("quotes and tags author for conversation clarifications", async () => {
      const comment = makeComment({
        path: "(conversation)",
        category: "needs_clarification",
        body: "Vague feedback here",
        clarificationQuestion: "What specifically should change?",
      });
      await responder.replyToClarifications([comment]);

      const body = client.addPRComment.mock.calls[0][1] as string;
      expect(body).toContain("> Vague feedback here");
      expect(body).toContain("@reviewer What specifically should change?");
    });
  });

  describe("reply routing", () => {
    it("routes inline comments via addThreadReply", async () => {
      await responder.replyToAddressed([makeComment()], "abc123def");
      expect(client.addThreadReply).toHaveBeenCalledTimes(1);
      expect(client.addPRComment).not.toHaveBeenCalled();
    });

    it("routes conversation comments via addPRComment", async () => {
      await responder.replyToAddressed(
        [makeComment({ path: "(conversation)" })],
        "abc123def",
      );
      expect(client.addPRComment).toHaveBeenCalledTimes(1);
      expect(client.addThreadReply).not.toHaveBeenCalled();
    });
  });
});
