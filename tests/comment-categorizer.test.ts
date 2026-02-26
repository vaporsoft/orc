import { describe, it, expect, vi, beforeEach } from "vitest";
import { CommentCategorizer } from "../src/core/comment-categorizer.js";
import type { FetchedComment } from "../src/core/comment-fetcher.js";

vi.mock("../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock the Claude Code SDK
let mockStreamResults: Array<{ type: string; [key: string]: unknown }> = [];

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(() => ({
    async *[Symbol.asyncIterator]() {
      for (const msg of mockStreamResults) {
        yield msg;
      }
    },
  })),
}));

function makeComment(overrides: Partial<FetchedComment["thread"]> = {}): FetchedComment {
  return {
    thread: {
      id: "c1",
      threadId: "t1",
      path: "src/main.ts",
      line: 10,
      body: "This variable is unused",
      author: "reviewer",
      isResolved: false,
      diffHunk: "@@ -1,5 +1,5 @@",
      createdAt: "2024-01-01T00:00:00Z",
      ...overrides,
    },
    rawThread: null,
  };
}

function setStreamResult(resultJson: string, cost = 0.01, inputTokens = 100, outputTokens = 50) {
  mockStreamResults = [
    {
      type: "result",
      subtype: "success",
      result: resultJson,
      total_cost_usd: cost,
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    },
  ];
}

describe("CommentCategorizer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStreamResults = [];
  });

  it("classifies a comment using Claude and returns structured result", async () => {
    setStreamResult(JSON.stringify({
      confidence: 0.9,
      category: "should_fix",
      reasoning: "The variable is unused",
      suggestedAction: "Remove the unused variable",
    }));

    const categorizer = new CommentCategorizer("/repo");
    const result = await categorizer.categorize([makeComment()]);

    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].category).toBe("should_fix");
    expect(result.comments[0].confidence).toBe(0.9);
    expect(result.comments[0].reasoning).toBe("The variable is unused");
    expect(result.costUsd).toBe(0.01);
  });

  it("demotes low-confidence results to verify_and_fix", async () => {
    setStreamResult(JSON.stringify({
      confidence: 0.5,
      category: "should_fix",
      reasoning: "Might be unused",
      suggestedAction: "Check and remove",
    }));

    const categorizer = new CommentCategorizer("/repo", 0.75);
    const result = await categorizer.categorize([makeComment()]);

    expect(result.comments[0].category).toBe("verify_and_fix");
    expect(result.comments[0].reasoning).toContain("[low confidence — verify]");
  });

  it("does not demote low-confidence must_fix", async () => {
    setStreamResult(JSON.stringify({
      confidence: 0.5,
      category: "must_fix",
      reasoning: "Security vulnerability",
      suggestedAction: "Fix the vulnerability",
    }));

    const categorizer = new CommentCategorizer("/repo", 0.75);
    const result = await categorizer.categorize([makeComment()]);

    expect(result.comments[0].category).toBe("must_fix");
  });

  it("does not demote low-confidence needs_clarification", async () => {
    setStreamResult(JSON.stringify({
      confidence: 0.5,
      category: "needs_clarification",
      reasoning: "Unclear what the reviewer wants",
      suggestedAction: "Ask for clarification",
      clarificationQuestion: "Could you clarify?",
    }));

    const categorizer = new CommentCategorizer("/repo", 0.75);
    const result = await categorizer.categorize([makeComment()]);

    expect(result.comments[0].category).toBe("needs_clarification");
  });

  it("caps clarification rounds — promotes to should_fix on second round", async () => {
    setStreamResult(JSON.stringify({
      confidence: 0.9,
      category: "needs_clarification",
      reasoning: "Still unclear",
      suggestedAction: "Ask again",
      clarificationQuestion: "What do you mean?",
    }));

    const comment = makeComment();
    comment.rawThread = {
      id: "t1",
      isResolved: false,
      isOutdated: false,
      comments: {
        pageInfo: { hasNextPage: false },
        nodes: [
          {
            id: "c1",
            databaseId: 1,
            body: "Unclear comment",
            author: { login: "reviewer" },
            path: "src/main.ts",
            line: 10,
            diffHunk: "",
            createdAt: "2024-01-01T00:00:00Z",
          },
          {
            id: "c2",
            databaseId: 2,
            body: "Could you clarify?\n\n*Orc — needs_clarification (confidence: 0.85)*",
            author: { login: "pr-author" },
            path: "src/main.ts",
            line: 10,
            diffHunk: "",
            createdAt: "2024-01-01T01:00:00Z",
          },
        ],
      },
    };

    const categorizer = new CommentCategorizer("/repo");
    const result = await categorizer.categorize([comment]);

    expect(result.comments[0].category).toBe("should_fix");
    expect(result.comments[0].reasoning).toContain("[follow-up received — attempting fix]");
    expect(result.comments[0].clarificationQuestion).toBeUndefined();
  });

  it("handles JSON parse failure gracefully", async () => {
    mockStreamResults = [
      {
        type: "result",
        subtype: "success",
        result: "not valid json at all",
        total_cost_usd: 0.01,
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    ];

    const categorizer = new CommentCategorizer("/repo");
    const result = await categorizer.categorize([makeComment()]);

    // Falls back to should_fix at 0.5 confidence, then demoted to verify_and_fix
    // because 0.5 < default threshold 0.75
    expect(result.comments[0].category).toBe("verify_and_fix");
    expect(result.comments[0].confidence).toBe(0.5);
    expect(result.comments[0].reasoning).toContain("[low confidence — verify]");
  });

  it("handles SDK stream with no result message", async () => {
    mockStreamResults = [];

    const categorizer = new CommentCategorizer("/repo");
    const result = await categorizer.categorize([makeComment()]);

    // Empty resultText -> JSON.parse("") fails -> should_fix at 0.5
    // 0.5 < 0.75 threshold → demoted to verify_and_fix
    expect(result.comments[0].category).toBe("verify_and_fix");
    expect(result.comments[0].confidence).toBe(0.5);
  });

  it("strips markdown fences from response", async () => {
    mockStreamResults = [
      {
        type: "result",
        subtype: "success",
        result: '```json\n{"confidence": 0.9, "category": "should_fix", "reasoning": "Valid", "suggestedAction": "Do it"}\n```',
        total_cost_usd: 0.01,
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    ];

    const categorizer = new CommentCategorizer("/repo");
    const result = await categorizer.categorize([makeComment()]);

    expect(result.comments[0].category).toBe("should_fix");
    expect(result.comments[0].confidence).toBe(0.9);
  });

  it("respects abort signal", async () => {
    setStreamResult(JSON.stringify({
      confidence: 0.9,
      category: "should_fix",
      reasoning: "Valid",
      suggestedAction: "Do it",
    }));

    const abortController = new AbortController();
    abortController.abort();

    const categorizer = new CommentCategorizer("/repo");
    const result = await categorizer.categorize(
      [makeComment(), makeComment({ id: "c2", threadId: "t2" })],
      abortController.signal,
    );

    expect(result.comments).toHaveLength(0);
  });

  it("accumulates costs across multiple comments", async () => {
    setStreamResult(
      JSON.stringify({ confidence: 0.9, category: "should_fix", reasoning: "Valid", suggestedAction: "Fix" }),
      0.02,
      200,
      100,
    );

    const categorizer = new CommentCategorizer("/repo");
    const result = await categorizer.categorize([
      makeComment(),
      makeComment({ id: "c2", threadId: "t2" }),
    ]);

    expect(result.comments).toHaveLength(2);
    expect(result.costUsd).toBe(0.04);
    expect(result.inputTokens).toBe(400);
    expect(result.outputTokens).toBe(200);
  });
});
