/**
 * Wrapper around the `gh` CLI for GitHub API access.
 * Uses `gh api` for GraphQL and REST calls — inherits the user's auth.
 */

import { exec } from "../utils/process.js";
import { withRetry } from "../utils/retry.js";
import { logger } from "../utils/logger.js";
import {
  REVIEW_THREADS_QUERY,
  RESOLVE_THREAD_MUTATION,
  PR_FOR_BRANCH_QUERY,
  MY_OPEN_PRS_QUERY,
} from "./queries.js";
import type {
  GHReviewThreadsResponse,
  GHReviewThread,
  GHCheckRun,
  GHCheckRunsResponse,
  GHPullRequest,
} from "./types.js";

export interface RepoInfo {
  owner: string;
  repo: string;
}

export class GHClient {
  private repoInfo: RepoInfo | null = null;
  private cachedLogin: string | null = null;
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  /** Discover owner/repo from the current git remote. */
  async getRepoInfo(): Promise<RepoInfo> {
    if (this.repoInfo) return this.repoInfo;

    const { stdout } = await exec(
      "gh",
      ["repo", "view", "--json", "owner,name"],
      { cwd: this.cwd },
    );
    const parsed = JSON.parse(stdout);
    this.repoInfo = { owner: parsed.owner.login, repo: parsed.name };
    return this.repoInfo;
  }

  /** Get the authenticated user's login. */
  async getCurrentUser(): Promise<string> {
    if (this.cachedLogin) return this.cachedLogin;

    const { stdout } = await exec(
      "gh",
      ["api", "user", "--jq", ".login"],
      { cwd: this.cwd },
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

    // Filter out empty nodes (non-PR results from the union type)
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
      () => exec("gh", args, { cwd: this.cwd }),
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

  /** Fetch CI check runs for the latest commit on a PR. */
  async getCheckRuns(prNumber: number): Promise<GHCheckRun[]> {
    const { owner, repo } = await this.getRepoInfo();

    const { stdout } = await withRetry(
      () =>
        exec("gh", [
          "api",
          `repos/${owner}/${repo}/pulls/${prNumber}`,
          "--jq",
          ".head.sha",
        ], { cwd: this.cwd }),
      "fetch-pr-sha",
    );
    const sha = stdout.trim();

    const { stdout: checksJson } = await withRetry(
      () =>
        exec("gh", [
          "api",
          `repos/${owner}/${repo}/commits/${sha}/check-runs`,
        ], { cwd: this.cwd }),
      "fetch-checks",
    );

    const response: GHCheckRunsResponse = JSON.parse(checksJson);
    return response.check_runs;
  }

  /** Fetch failed CI run logs. */
  async getFailedRunLog(runId: number): Promise<string> {
    try {
      const { stdout } = await exec(
        "gh",
        ["run", "view", String(runId), "--log-failed"],
        { cwd: this.cwd },
      );
      // Truncate to avoid overwhelming Claude
      return stdout.slice(0, 15000);
    } catch {
      logger.warn(`Failed to fetch logs for run ${runId}`);
      return "(logs unavailable)";
    }
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
    // Use REST API to reply to a pull request review thread
    // threadNodeId here is the GraphQL ID of the thread
    await withRetry(
      () =>
        exec("gh", [
          "api",
          "graphql",
          "-f",
          `query=mutation { addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: "${threadNodeId}", body: "${body.replace(/"/g, '\\"').replace(/\n/g, "\\n")}" }) { comment { id } } }`,
        ], { cwd: this.cwd }),
      "reply-to-thread",
    );
  }

  /** Validate that `gh` is authenticated and can reach the repo. */
  async validateAuth(): Promise<void> {
    await exec("gh", ["auth", "status"], { cwd: this.cwd });
  }
}
