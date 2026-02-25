import { describe, it, expect, vi, beforeEach } from "vitest";
import { CommentFetcher } from "../src/core/comment-fetcher.js";
import type { GHClient } from "../src/github/gh-client.js";
import type { GHReviewThread, GHPRComment } from "../src/github/types.js";

vi.mock("../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function makeThread(overrides: Partial<GHReviewThread> & { id: string }): GHReviewThread {
  return {
    isResolved: false,
    isOutdated: false,
    comments: {
      pageInfo: { hasNextPage: false },
      nodes: [
        {
          id: `comment-${overrides.id}`,
          databaseId: 1,
          body: "Fix this bug",
          author: { login: "reviewer" },
          path: "src/main.ts",
          line: 10,
          diffHunk: "@@ -1,5 +1,5 @@",
          createdAt: "2024-01-01T00:00:00Z",
        },
      ],
    },
    ...overrides,
  };
}

function makePRComment(overrides: Partial<GHPRComment> & { id: string }): GHPRComment {
  return {
    databaseId: 1,
    body: "Please refactor this",
    author: { login: "reviewer" },
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeGHClient(
  threads: GHReviewThread[] = [],
  prComments: GHPRComment[] = [],
): GHClient {
  return {
    getReviewThreads: vi.fn().mockResolvedValue(threads),
    getPRComments: vi.fn().mockResolvedValue(prComments),
  } as unknown as GHClient;
}

describe("CommentFetcher", () => {
  describe("filterActionableThreads", () => {
    it("returns unresolved, non-outdated threads", async () => {
      const threads = [
        makeThread({ id: "t1" }),
      ];
      const client = makeGHClient(threads);
      const fetcher = new CommentFetcher(client, 1, "bot-user", "main");

      const { comments } = await fetcher.fetchWithCounts();
      expect(comments).toHaveLength(1);
      expect(comments[0].thread.threadId).toBe("t1");
    });

    it("filters out resolved threads", async () => {
      const threads = [
        makeThread({ id: "t1", isResolved: true }),
      ];
      const client = makeGHClient(threads);
      const fetcher = new CommentFetcher(client, 1, "bot-user", "main");

      const { comments } = await fetcher.fetchWithCounts();
      expect(comments).toHaveLength(0);
    });

    it("filters out outdated threads", async () => {
      const threads = [
        makeThread({ id: "t1", isOutdated: true }),
      ];
      const client = makeGHClient(threads);
      const fetcher = new CommentFetcher(client, 1, "bot-user", "main");

      const { comments } = await fetcher.fetchWithCounts();
      expect(comments).toHaveLength(0);
    });

    it("filters out threads where ORC already replied and no new reviewer comment followed", async () => {
      const threads: GHReviewThread[] = [
        {
          id: "t1",
          isResolved: false,
          isOutdated: false,
          comments: {
            pageInfo: { hasNextPage: false },
            nodes: [
              {
                id: "c1",
                databaseId: 1,
                body: "Fix this bug",
                author: { login: "reviewer" },
                path: "src/main.ts",
                line: 10,
                diffHunk: "@@ -1,5 +1,5 @@",
                createdAt: "2024-01-01T00:00:00Z",
              },
              {
                id: "c2",
                databaseId: 2,
                body: "Addressed in abc1234.\n\n*Orc — should_fix (confidence: 0.90)*",
                author: { login: "pr-author" },
                path: "src/main.ts",
                line: 10,
                diffHunk: "@@ -1,5 +1,5 @@",
                createdAt: "2024-01-01T01:00:00Z",
              },
            ],
          },
        },
      ];
      const client = makeGHClient(threads);
      const fetcher = new CommentFetcher(client, 1, "bot-user", "main");

      const { comments } = await fetcher.fetchWithCounts();
      expect(comments).toHaveLength(0);
    });

    it("re-picks up threads where reviewer commented after ORC's reply", async () => {
      const threads: GHReviewThread[] = [
        {
          id: "t1",
          isResolved: false,
          isOutdated: false,
          comments: {
            pageInfo: { hasNextPage: false },
            nodes: [
              {
                id: "c1",
                databaseId: 1,
                body: "Fix this bug",
                author: { login: "reviewer" },
                path: "src/main.ts",
                line: 10,
                diffHunk: "@@ -1,5 +1,5 @@",
                createdAt: "2024-01-01T00:00:00Z",
              },
              {
                id: "c2",
                databaseId: 2,
                body: "Addressed in abc1234.\n\n*Orc — should_fix (confidence: 0.90)*",
                author: { login: "pr-author" },
                path: "src/main.ts",
                line: 10,
                diffHunk: "@@ -1,5 +1,5 @@",
                createdAt: "2024-01-01T01:00:00Z",
              },
              {
                id: "c3",
                databaseId: 3,
                body: "No, this is still wrong",
                author: { login: "reviewer" },
                path: "src/main.ts",
                line: 10,
                diffHunk: "@@ -1,5 +1,5 @@",
                createdAt: "2024-01-01T02:00:00Z",
              },
            ],
          },
        },
      ];
      const client = makeGHClient(threads);
      const fetcher = new CommentFetcher(client, 1, "bot-user", "main");

      const { comments } = await fetcher.fetchWithCounts();
      expect(comments).toHaveLength(1);
      // The body should include all non-ORC comments
      expect(comments[0].thread.body).toContain("Fix this bug");
      expect(comments[0].thread.body).toContain("No, this is still wrong");
      expect(comments[0].thread.body).not.toContain("*Orc —");
    });

    it("joins non-ORC comment bodies with separator", async () => {
      const threads: GHReviewThread[] = [
        {
          id: "t1",
          isResolved: false,
          isOutdated: false,
          comments: {
            pageInfo: { hasNextPage: false },
            nodes: [
              {
                id: "c1",
                databaseId: 1,
                body: "Comment 1",
                author: { login: "reviewer" },
                path: "src/main.ts",
                line: 10,
                diffHunk: "@@ -1,5 +1,5 @@",
                createdAt: "2024-01-01T00:00:00Z",
              },
              {
                id: "c2",
                databaseId: 2,
                body: "Comment 2",
                author: { login: "reviewer2" },
                path: "src/main.ts",
                line: 10,
                diffHunk: "@@ -1,5 +1,5 @@",
                createdAt: "2024-01-01T01:00:00Z",
              },
            ],
          },
        },
      ];
      const client = makeGHClient(threads);
      const fetcher = new CommentFetcher(client, 1, "bot-user", "main");

      const { comments } = await fetcher.fetchWithCounts();
      expect(comments[0].thread.body).toBe("Comment 1\n\n---\n\nComment 2");
    });

    it("skips threads with no comments", async () => {
      const threads: GHReviewThread[] = [
        {
          id: "t1",
          isResolved: false,
          isOutdated: false,
          comments: {
            pageInfo: { hasNextPage: false },
            nodes: [],
          },
        },
      ];
      const client = makeGHClient(threads);
      const fetcher = new CommentFetcher(client, 1, "bot-user", "main");

      const { comments } = await fetcher.fetchWithCounts();
      expect(comments).toHaveLength(0);
    });
  });

  describe("PR conversation comments", () => {
    it("includes non-ORC PR conversation comments", async () => {
      const prComments = [
        makePRComment({ id: "pc1", body: "Can you refactor this?" }),
      ];
      const client = makeGHClient([], prComments);
      const fetcher = new CommentFetcher(client, 1, "bot-user", "main");

      const { comments } = await fetcher.fetchWithCounts();
      expect(comments).toHaveLength(1);
      expect(comments[0].thread.path).toBe("(conversation)");
      expect(comments[0].rawThread).toBeNull();
    });

    it("filters out ORC replies from PR comments", async () => {
      const prComments = [
        makePRComment({
          id: "pc1",
          body: "Addressed in abc1234.\n\n*Orc — should_fix (confidence: 0.90)*",
        }),
      ];
      const client = makeGHClient([], prComments);
      const fetcher = new CommentFetcher(client, 1, "bot-user", "main");

      const { comments } = await fetcher.fetchWithCounts();
      expect(comments).toHaveLength(0);
    });

    it("filters out bot commands like '@cursor review'", async () => {
      const prComments = [
        makePRComment({ id: "pc1", body: "@cursor review" }),
        makePRComment({ id: "pc2", body: "@copilot fix" }),
        makePRComment({ id: "pc3", body: "@bot" }),
      ];
      const client = makeGHClient([], prComments);
      const fetcher = new CommentFetcher(client, 1, "bot-user", "main");

      const { comments } = await fetcher.fetchWithCounts();
      expect(comments).toHaveLength(0);
    });

    it("does not filter multi-word comments as bot commands", async () => {
      const prComments = [
        makePRComment({ id: "pc1", body: "@reviewer can you look at this too?" }),
      ];
      const client = makeGHClient([], prComments);
      const fetcher = new CommentFetcher(client, 1, "bot-user", "main");

      const { comments } = await fetcher.fetchWithCounts();
      expect(comments).toHaveLength(1);
    });

    it("skips conversation comments already replied to by ORC (quoted body match)", async () => {
      const prComments = [
        makePRComment({
          id: "pc1",
          body: "Please fix the tests",
          createdAt: "2024-01-01T00:00:00Z",
        }),
        makePRComment({
          id: "pc2",
          body: "> Please fix the tests\n\nAddressed in abc1234.\n\n*Orc — should_fix (confidence: 0.90)*",
          createdAt: "2024-01-01T01:00:00Z",
        }),
      ];
      const client = makeGHClient([], prComments);
      const fetcher = new CommentFetcher(client, 1, "bot-user", "main");

      const { comments } = await fetcher.fetchWithCounts();
      expect(comments).toHaveLength(0);
    });

    it("does not skip conversation comments when ORC reply quotes a different comment", async () => {
      const prComments = [
        makePRComment({
          id: "pc1",
          body: "Please fix the tests",
          createdAt: "2024-01-01T00:00:00Z",
        }),
        makePRComment({
          id: "pc2",
          body: "Also fix the linting",
          createdAt: "2024-01-01T00:30:00Z",
        }),
        makePRComment({
          id: "pc3",
          body: "> Also fix the linting\n\nDone.\n\n*Orc — should_fix (confidence: 0.90)*",
          createdAt: "2024-01-01T01:00:00Z",
        }),
      ];
      const client = makeGHClient([], prComments);
      const fetcher = new CommentFetcher(client, 1, "bot-user", "main");

      const { comments } = await fetcher.fetchWithCounts();
      // "Please fix the tests" should still be returned — the ORC reply was for a different comment
      expect(comments).toHaveLength(1);
      expect(comments[0].thread.body).toBe("Please fix the tests");
    });
  });

  describe("bot comment filtering", () => {
    it("processes bot conversation comments posted before any orc activity", async () => {
      const prComments = [
        makePRComment({
          id: "pc1",
          body: "Potential null dereference at line 42",
          author: { login: "bugbot[bot]" },
          createdAt: "2024-01-01T00:00:00Z",
        }),
      ];
      const client = makeGHClient([], prComments);
      const fetcher = new CommentFetcher(client, 1, "bot-user", "main");

      const { comments } = await fetcher.fetchWithCounts();
      expect(comments).toHaveLength(1);
      expect(comments[0].thread.body).toBe("Potential null dereference at line 42");
    });

    it("skips bot conversation comments posted after orc was active", async () => {
      const prComments = [
        makePRComment({
          id: "pc1",
          body: "Please fix the tests",
          author: { login: "reviewer" },
          createdAt: "2024-01-01T00:00:00Z",
        }),
        makePRComment({
          id: "pc2",
          body: "> Please fix the tests\n\nAddressed in abc1234.\n\n*Orc — should_fix (confidence: 0.90)*",
          author: { login: "pr-author" },
          createdAt: "2024-01-01T01:00:00Z",
        }),
        makePRComment({
          id: "pc3",
          body: "Claude finished @tonycassara's task in 10s\n\nNo action needed",
          author: { login: "claude[bot]" },
          createdAt: "2024-01-01T01:01:00Z",
        }),
      ];
      const client = makeGHClient([], prComments);
      const fetcher = new CommentFetcher(client, 1, "bot-user", "main");

      const { comments } = await fetcher.fetchWithCounts();
      expect(comments).toHaveLength(0);
    });

    it("always processes human comments regardless of timing", async () => {
      const prComments = [
        makePRComment({
          id: "pc1",
          body: "> old\n\nDone.\n\n*Orc — should_fix (confidence: 0.90)*",
          author: { login: "pr-author" },
          createdAt: "2024-01-01T01:00:00Z",
        }),
        makePRComment({
          id: "pc2",
          body: "Actually, this still looks wrong",
          author: { login: "reviewer" },
          createdAt: "2024-01-01T02:00:00Z",
        }),
      ];
      const client = makeGHClient([], prComments);
      const fetcher = new CommentFetcher(client, 1, "bot-user", "main");

      const { comments } = await fetcher.fetchWithCounts();
      expect(comments).toHaveLength(1);
      expect(comments[0].thread.body).toBe("Actually, this still looks wrong");
    });

    it("does not re-trigger inline thread when bot replies after orc", async () => {
      const threads: GHReviewThread[] = [
        {
          id: "t1",
          isResolved: false,
          isOutdated: false,
          comments: {
            pageInfo: { hasNextPage: false },
            nodes: [
              {
                id: "c1",
                databaseId: 1,
                body: "Fix this bug",
                author: { login: "reviewer" },
                path: "src/main.ts",
                line: 10,
                diffHunk: "@@ -1,5 +1,5 @@",
                createdAt: "2024-01-01T00:00:00Z",
              },
              {
                id: "c2",
                databaseId: 2,
                body: "Addressed in abc1234.\n\n*Orc — should_fix (confidence: 0.90)*",
                author: { login: "pr-author" },
                path: "src/main.ts",
                line: 10,
                diffHunk: "@@ -1,5 +1,5 @@",
                createdAt: "2024-01-01T01:00:00Z",
              },
              {
                id: "c3",
                databaseId: 3,
                body: "Claude finished task",
                author: { login: "claude[bot]" },
                path: "src/main.ts",
                line: 10,
                diffHunk: "@@ -1,5 +1,5 @@",
                createdAt: "2024-01-01T01:01:00Z",
              },
            ],
          },
        },
      ];
      const client = makeGHClient(threads);
      const fetcher = new CommentFetcher(client, 1, "bot-user", "main");

      const { comments } = await fetcher.fetchWithCounts();
      expect(comments).toHaveLength(0);
    });

    it("excludes bot reaction text from thread body but keeps original bot review", async () => {
      const threads: GHReviewThread[] = [
        {
          id: "t1",
          isResolved: false,
          isOutdated: false,
          comments: {
            pageInfo: { hasNextPage: false },
            nodes: [
              {
                id: "c1",
                databaseId: 1,
                body: "Potential null dereference",
                author: { login: "bugbot[bot]" },
                path: "src/main.ts",
                line: 10,
                diffHunk: "@@ -1,5 +1,5 @@",
                createdAt: "2024-01-01T00:00:00Z",
              },
              {
                id: "c2",
                databaseId: 2,
                body: "Addressed in abc1234.\n\n*Orc — should_fix (confidence: 0.90)*",
                author: { login: "pr-author" },
                path: "src/main.ts",
                line: 10,
                diffHunk: "@@ -1,5 +1,5 @@",
                createdAt: "2024-01-01T01:00:00Z",
              },
              {
                id: "c3",
                databaseId: 3,
                body: "Still seeing the issue after fix",
                author: { login: "reviewer" },
                path: "src/main.ts",
                line: 10,
                diffHunk: "@@ -1,5 +1,5 @@",
                createdAt: "2024-01-01T02:00:00Z",
              },
              {
                id: "c4",
                databaseId: 4,
                body: "Claude finished task",
                author: { login: "claude[bot]" },
                path: "src/main.ts",
                line: 10,
                diffHunk: "@@ -1,5 +1,5 @@",
                createdAt: "2024-01-01T02:01:00Z",
              },
            ],
          },
        },
      ];
      const client = makeGHClient(threads);
      const fetcher = new CommentFetcher(client, 1, "bot-user", "main");

      const { comments } = await fetcher.fetchWithCounts();
      expect(comments).toHaveLength(1);
      // Original bot review (before orc) should be included
      expect(comments[0].thread.body).toContain("Potential null dereference");
      // Human follow-up should be included
      expect(comments[0].thread.body).toContain("Still seeing the issue after fix");
      // Bot reaction after orc should be excluded
      expect(comments[0].thread.body).not.toContain("Claude finished task");
    });

    it("does not count bot reply as follow-up on resolved thread", async () => {
      const threads: GHReviewThread[] = [
        {
          id: "t1",
          isResolved: true,
          isOutdated: false,
          comments: {
            pageInfo: { hasNextPage: false },
            nodes: [
              {
                id: "c1",
                databaseId: 1,
                body: "Fix this",
                author: { login: "reviewer" },
                path: "src/main.ts",
                line: 10,
                diffHunk: "",
                createdAt: "2024-01-01T00:00:00Z",
              },
              {
                id: "c2",
                databaseId: 2,
                body: "Done.\n\n*Orc — should_fix (confidence: 0.85)*",
                author: { login: "pr-author" },
                path: "src/main.ts",
                line: 10,
                diffHunk: "",
                createdAt: "2024-01-01T01:00:00Z",
              },
              {
                id: "c3",
                databaseId: 3,
                body: "Claude finished task",
                author: { login: "claude[bot]" },
                path: "src/main.ts",
                line: 10,
                diffHunk: "",
                createdAt: "2024-01-01T02:00:00Z",
              },
            ],
          },
        },
      ];
      const client = makeGHClient(threads);
      const fetcher = new CommentFetcher(client, 1, "bot-user", "main");

      const { followUpResolvedThreadIds } = await fetcher.fetchWithCounts();
      expect(followUpResolvedThreadIds).not.toContain("t1");
    });
  });

  describe("threadCounts", () => {
    it("counts resolved and total threads", async () => {
      const threads = [
        makeThread({ id: "t1", isResolved: false }),
        makeThread({ id: "t2", isResolved: true }),
        makeThread({ id: "t3", isResolved: true }),
        makeThread({ id: "t4", isResolved: false }),
      ];
      const client = makeGHClient(threads);
      const fetcher = new CommentFetcher(client, 1, "bot-user", "main");

      const { threadCounts } = await fetcher.fetchWithCounts();
      expect(threadCounts.resolved).toBe(2);
      expect(threadCounts.total).toBe(4);
    });
  });

  describe("orcRepliedResolvedThreadIds", () => {
    it("identifies resolved threads with ORC replies", async () => {
      const threads: GHReviewThread[] = [
        {
          id: "t1",
          isResolved: true,
          isOutdated: false,
          comments: {
            pageInfo: { hasNextPage: false },
            nodes: [
              {
                id: "c1",
                databaseId: 1,
                body: "Fix this",
                author: { login: "reviewer" },
                path: "src/main.ts",
                line: 10,
                diffHunk: "",
                createdAt: "2024-01-01T00:00:00Z",
              },
              {
                id: "c2",
                databaseId: 2,
                body: "Done.\n\n*Orc — should_fix (confidence: 0.85)*",
                author: { login: "pr-author" },
                path: "src/main.ts",
                line: 10,
                diffHunk: "",
                createdAt: "2024-01-01T01:00:00Z",
              },
            ],
          },
        },
      ];
      const client = makeGHClient(threads);
      const fetcher = new CommentFetcher(client, 1, "bot-user", "main");

      const { orcRepliedResolvedThreadIds } = await fetcher.fetchWithCounts();
      expect(orcRepliedResolvedThreadIds).toContain("t1");
    });

    it("puts resolved threads without ORC reply in resolvedNoOrcReplyThreadIds", async () => {
      const threads: GHReviewThread[] = [
        {
          id: "t1",
          isResolved: true,
          isOutdated: false,
          comments: {
            pageInfo: { hasNextPage: false },
            nodes: [
              {
                id: "c1",
                databaseId: 1,
                body: "Fix this",
                author: { login: "reviewer" },
                path: "src/main.ts",
                line: 10,
                diffHunk: "",
                createdAt: "2024-01-01T00:00:00Z",
              },
            ],
          },
        },
      ];
      const client = makeGHClient(threads);
      const fetcher = new CommentFetcher(client, 1, "bot-user", "main");

      const { resolvedNoOrcReplyThreadIds } = await fetcher.fetchWithCounts();
      expect(resolvedNoOrcReplyThreadIds).toContain("t1");
    });

    it("detects follow-up comments on resolved threads with ORC replies", async () => {
      const threads: GHReviewThread[] = [
        {
          id: "t1",
          isResolved: true,
          isOutdated: false,
          comments: {
            pageInfo: { hasNextPage: false },
            nodes: [
              {
                id: "c1",
                databaseId: 1,
                body: "Fix this",
                author: { login: "reviewer" },
                path: "src/main.ts",
                line: 10,
                diffHunk: "",
                createdAt: "2024-01-01T00:00:00Z",
              },
              {
                id: "c2",
                databaseId: 2,
                body: "Done.\n\n*Orc — should_fix (confidence: 0.85)*",
                author: { login: "pr-author" },
                path: "src/main.ts",
                line: 10,
                diffHunk: "",
                createdAt: "2024-01-01T01:00:00Z",
              },
              {
                id: "c3",
                databaseId: 3,
                body: "Actually I prefer the original approach",
                author: { login: "reviewer" },
                path: "src/main.ts",
                line: 10,
                diffHunk: "",
                createdAt: "2024-01-01T02:00:00Z",
              },
            ],
          },
        },
      ];
      const client = makeGHClient(threads);
      const fetcher = new CommentFetcher(client, 1, "bot-user", "main");

      const { followUpResolvedThreadIds, orcRepliedResolvedThreadIds } = await fetcher.fetchWithCounts();
      expect(followUpResolvedThreadIds).toContain("t1");
      expect(orcRepliedResolvedThreadIds).toContain("t1");
    });

    it("does not flag resolved threads without follow-up comments", async () => {
      const threads: GHReviewThread[] = [
        {
          id: "t1",
          isResolved: true,
          isOutdated: false,
          comments: {
            pageInfo: { hasNextPage: false },
            nodes: [
              {
                id: "c1",
                databaseId: 1,
                body: "Fix this",
                author: { login: "reviewer" },
                path: "src/main.ts",
                line: 10,
                diffHunk: "",
                createdAt: "2024-01-01T00:00:00Z",
              },
              {
                id: "c2",
                databaseId: 2,
                body: "Done.\n\n*Orc — should_fix (confidence: 0.85)*",
                author: { login: "pr-author" },
                path: "src/main.ts",
                line: 10,
                diffHunk: "",
                createdAt: "2024-01-01T01:00:00Z",
              },
            ],
          },
        },
      ];
      const client = makeGHClient(threads);
      const fetcher = new CommentFetcher(client, 1, "bot-user", "main");

      const { followUpResolvedThreadIds } = await fetcher.fetchWithCounts();
      expect(followUpResolvedThreadIds).not.toContain("t1");
    });

    it("skips resolved threads with truncated comments (hasNextPage) for safety", async () => {
      const threads: GHReviewThread[] = [
        {
          id: "t1",
          isResolved: true,
          isOutdated: false,
          comments: {
            pageInfo: { hasNextPage: true },
            nodes: [
              {
                id: "c1",
                databaseId: 1,
                body: "Fix this",
                author: { login: "reviewer" },
                path: "src/main.ts",
                line: 10,
                diffHunk: "",
                createdAt: "2024-01-01T00:00:00Z",
              },
            ],
          },
        },
      ];
      const client = makeGHClient(threads);
      const fetcher = new CommentFetcher(client, 1, "bot-user", "main");

      const result = await fetcher.fetchWithCounts();
      expect(result.orcRepliedResolvedThreadIds).not.toContain("t1");
      expect(result.resolvedNoOrcReplyThreadIds).not.toContain("t1");
    });
  });
});
