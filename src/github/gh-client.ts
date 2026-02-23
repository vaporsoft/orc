/**
 * Wrapper around the `gh` CLI for GitHub API access.
 * Uses `gh api` for GraphQL and REST calls — inherits the user's auth.
 */

import { exec, type ExecResult } from "../utils/process.js";
import { withRetry, RateLimitError } from "../utils/retry.js";
import { logger } from "../utils/logger.js";
import {
  REVIEW_THREADS_QUERY,
  RESOLVE_THREAD_MUTATION,
  PR_COMMENTS_QUERY,
  PR_FOR_BRANCH_QUERY,
  MY_OPEN_PRS_QUERY,
  ALL_OPEN_PRS_QUERY,
} from "./queries.js";
import type {
  GHReviewThreadsResponse,
  GHReviewThread,
  GHPRComment,
  GHPRCommentsResponse,
  GHCheckRun,
  GHCheckRunsResponse,
  GHPullRequest,
} from "./types.js";

export interface RepoInfo {
  owner: string;
  repo: string;
}

const RATE_LIMIT_PATTERN = /rate limit|abuse detection/i;

export class GHClient {
  private repoInfo: RepoInfo | null = null;
  private cachedLogin: string | null = null;
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  /** Run a `gh` CLI command, converting rate-limit failures to RateLimitError. */
  private async execGH(
    args: string[],
    options?: Parameters<typeof exec>[2],
  ): Promise<ExecResult> {
    try {
      return await exec("gh", args, { cwd: this.cwd, ...options });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (RATE_LIMIT_PATTERN.test(message)) {
        throw new RateLimitError(message);
      }
      throw err;
    }
  }

  /** Discover owner/repo from the current git remote. */
  async getRepoInfo(): Promise<RepoInfo> {
    if (this.repoInfo) return this.repoInfo;

    const { stdout } = await this.execGH(
      ["repo", "view", "--json", "owner,name"],
    );
    const parsed = JSON.parse(stdout);
    this.repoInfo = { owner: parsed.owner.login, repo: parsed.name };
    return this.repoInfo;
  }

  /** Get the authenticated user's login. */
  async getCurrentUser(): Promise<string> {
    if (this.cachedLogin) return this.cachedLogin;

    const { stdout } = await this.execGH(
      ["api", "user", "--jq", ".login"],
    );
    this.cachedLogin = stdout.trim();
    return this.cachedLogin;
  }

  /** Find all open PRs authored by the current user. */
  async getMyOpenPRs(): Promise<GHPullRequest[]> {
    const { owner, repo } = await this.getRepoInfo();
    const login = await this.getCurrentUser();

    const searchQuery = `repo:${owner}/${repo} is:pr is:open author:${login}`;
    const result = await this.graphql<{
      data: {
        search: {
          nodes: GHPullRequest[];
        };
      };
    }>(MY_OPEN_PRS_QUERY, { searchQuery });

    return result.data.search.nodes.filter((node) => node.number !== undefined);
  }

  /** Find all open PRs in the repo (regardless of author). */
  async getAllOpenPRs(): Promise<GHPullRequest[]> {
    const { owner, repo } = await this.getRepoInfo();

    const searchQuery = `repo:${owner}/${repo} is:pr is:open`;
    const result = await this.graphql<{
      data: {
        search: {
          nodes: GHPullRequest[];
        };
      };
    }>(ALL_OPEN_PRS_QUERY, { searchQuery });

    return result.data.search.nodes.filter((node) => node.number !== undefined);
  }

  /** Execute a GraphQL query via `gh api graphql`. */
  async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const args = ["api", "graphql", "-f", `query=${query}`];
    for (const [key, value] of Object.entries(variables)) {
      if (typeof value === "number") {
        args.push("-F", `${key}=${value}`);
      } else {
        args.push("-f", `${key}=${String(value)}`);
      }
    }
    const { stdout } = await withRetry(
      () => this.execGH(args),
      "graphql",
    );
    return JSON.parse(stdout) as T;
  }

  /** Find the open PR for a branch. */
  async findPRForBranch(branch: string): Promise<GHPullRequest | null> {
    const { owner, repo } = await this.getRepoInfo();
    const result = await this.graphql<{
      data: {
        repository: {
          pullRequests: { nodes: GHPullRequest[] };
        };
      };
    }>(PR_FOR_BRANCH_QUERY, { owner, repo, branch });

    const nodes = result.data.repository.pullRequests.nodes;
    return nodes.length > 0 ? nodes[0] : null;
  }

  /** Fetch all unresolved review threads for a PR (paginated). */
  async getReviewThreads(prNumber: number): Promise<GHReviewThread[]> {
    const { owner, repo } = await this.getRepoInfo();
    const allThreads: GHReviewThread[] = [];
    let cursor: string | null = null;

    do {
      const variables: Record<string, unknown> = { owner, repo, prNumber };
      if (cursor) variables.cursor = cursor;

      const result = await this.graphql<GHReviewThreadsResponse>(
        REVIEW_THREADS_QUERY,
        variables,
      );

      const connection = result.data.repository.pullRequest.reviewThreads;
      allThreads.push(...connection.nodes);
      cursor = connection.pageInfo.hasNextPage
        ? connection.pageInfo.endCursor
        : null;
    } while (cursor);

    return allThreads;
  }

  /** Fetch all top-level PR conversation comments (paginated). */
  async getPRComments(prNumber: number): Promise<GHPRComment[]> {
    const { owner, repo } = await this.getRepoInfo();
    const allComments: GHPRComment[] = [];
    let cursor: string | null = null;

    do {
      const variables: Record<string, unknown> = { owner, repo, prNumber };
      if (cursor) variables.cursor = cursor;

      const result = await this.graphql<GHPRCommentsResponse>(
        PR_COMMENTS_QUERY,
        variables,
      );

      const connection = result.data.repository.pullRequest.comments;
      allComments.push(...connection.nodes);
      cursor = connection.pageInfo.hasNextPage
        ? connection.pageInfo.endCursor
        : null;
    } while (cursor);

    return allComments;
  }

  /** Add a top-level comment to a PR conversation. */
  async addPRComment(prNumber: number, body: string): Promise<void> {
    const { owner, repo } = await this.getRepoInfo();
    await withRetry(
      () =>
        this.execGH([
          "api",
          "--method", "POST",
          `repos/${owner}/${repo}/issues/${prNumber}/comments`,
          "-f", `body=${body}`,
        ]),
      "add-pr-comment",
    );
  }

  /** Fetch CI check runs for the latest commit on a PR. */
  async getCheckRuns(prNumber: number): Promise<GHCheckRun[]> {
    const { owner, repo } = await this.getRepoInfo();

    const { stdout } = await withRetry(
      () =>
        this.execGH([
          "api",
          `repos/${owner}/${repo}/pulls/${prNumber}`,
          "--jq",
          ".head.sha",
        ]),
      "fetch-pr-sha",
    );
    const sha = stdout.trim();

    const { stdout: checksJson } = await withRetry(
      () =>
        this.execGH([
          "api",
          `repos/${owner}/${repo}/commits/${sha}/check-runs`,
        ]),
      "fetch-checks",
    );

    const response: GHCheckRunsResponse = JSON.parse(checksJson);
    return response.check_runs;
  }

  /** Fetch failed CI run logs with smart truncation. */
  async getFailedRunLog(runId: number): Promise<string> {
    try {
      const { stdout } = await this.execGH(
        ["run", "view", String(runId), "--log-failed"],
      );
      return this.truncateLog(stdout);
    } catch (err) {
      if (err instanceof RateLimitError) {
        throw err;
      }
      logger.warn(`Failed to fetch logs for run ${runId}`);
      return "(logs unavailable)";
    }
  }

  /** List workflow runs for the HEAD commit of a PR. */
  async getWorkflowRuns(prNumber: number): Promise<{ databaseId: number; name: string; conclusion: string | null; status: string }[]> {
    const { owner, repo } = await this.getRepoInfo();

    const { stdout: shaOut } = await withRetry(
      () =>
        this.execGH([
          "api",
          `repos/${owner}/${repo}/pulls/${prNumber}`,
          "--jq",
          ".head.sha",
        ]),
      "fetch-pr-sha-for-runs",
    );
    const sha = shaOut.trim();

    const { stdout } = await this.execGH(
      ["run", "list", "--commit", sha, "--json", "databaseId,name,conclusion,status"],
    );
    return JSON.parse(stdout);
  }

  /** Truncate a log to the last portion, keeping errors visible. */
  private truncateLog(log: string, maxLength = 30000): string {
    if (log.length <= maxLength) return log;
    const lines = log.split("\n");
    const result: string[] = [];
    let size = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      size += lines[i].length + 1;
      if (size > maxLength) break;
      result.unshift(lines[i]);
    }
    return `... (truncated ${lines.length - result.length} lines) ...\n` + result.join("\n");
  }

  /** Resolve a review thread via GraphQL mutation. */
  async resolveThread(threadId: string): Promise<void> {
    await this.graphql(RESOLVE_THREAD_MUTATION, { threadId });
  }

  /** Add a reply comment to a PR review thread. */
  async addThreadReply(
    threadNodeId: string,
    body: string,
  ): Promise<void> {
    await withRetry(
      () =>
        this.execGH([
          "api",
          "graphql",
          "-f",
          `query=mutation { addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: "${threadNodeId}", body: "${body.replace(/"/g, '\\"').replace(/\n/g, "\\n")}" }) { comment { id } } }`,
        ]),
      "reply-to-thread",
    );
  }

  /** Re-request review from the given reviewers. */
  async requestReviewers(prNumber: number, reviewers: string[]): Promise<void> {
    if (reviewers.length === 0) return;
    const { owner, repo } = await this.getRepoInfo();
    try {
      // gh api -F passes typed JSON fields; repeating the key builds an array
      const args = [
        "api",
        "--method", "POST",
        `repos/${owner}/${repo}/pulls/${prNumber}/requested_reviewers`,
      ];
      for (const reviewer of reviewers) {
        args.push("-f", `reviewers[]=${reviewer}`);
      }
      await this.execGH(args);
      logger.info(`Re-requested review from: ${reviewers.join(", ")}`);
    } catch (err) {
      logger.warn(`Failed to re-request reviewers: ${err}`);
    }
  }

  /** Check whether a PR was merged. */
  async isPRMerged(prNumber: number): Promise<boolean> {
    const { owner, repo } = await this.getRepoInfo();
    try {
      const { stdout } = await this.execGH([
        "api",
        `repos/${owner}/${repo}/pulls/${prNumber}`,
        "--jq", ".merged",
      ]);
      return stdout.trim() === "true";
    } catch {
      return false;
    }
  }

  /** Validate that `gh` is authenticated and can reach the repo. */
  async validateAuth(): Promise<void> {
    await this.execGH(["auth", "status"]);
  }
}
