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
  PR_COMMENTS_QUERY,
  PR_FOR_BRANCH_QUERY,
  MY_OPEN_PRS_QUERY,
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
        exec("gh", [
          "api",
          "--method", "POST",
          `repos/${owner}/${repo}/issues/${prNumber}/comments`,
          "-f", `body=${body}`,
        ], { cwd: this.cwd }),
      "add-pr-comment",
    );
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

  /** Fetch failed CI run logs with smart truncation. */
  async getFailedRunLog(runId: number): Promise<string> {
    try {
      const { stdout } = await exec(
        "gh",
        ["run", "view", String(runId), "--log-failed"],
        { cwd: this.cwd },
      );
      return this.truncateLog(stdout);
    } catch {
      logger.warn(`Failed to fetch logs for run ${runId}`);
      return "(logs unavailable)";
    }
  }

  /** List workflow runs for the HEAD commit of a PR. */
  async getWorkflowRuns(prNumber: number): Promise<{ databaseId: number; name: string; conclusion: string | null; status: string }[]> {
    const { owner, repo } = await this.getRepoInfo();

    const { stdout: shaOut } = await withRetry(
      () =>
        exec("gh", [
          "api",
          `repos/${owner}/${repo}/pulls/${prNumber}`,
          "--jq",
          ".head.sha",
        ], { cwd: this.cwd }),
      "fetch-pr-sha-for-runs",
    );
    const sha = shaOut.trim();

    const { stdout } = await exec(
      "gh",
      ["run", "list", "--commit", sha, "--json", "databaseId,name,conclusion,status"],
      { cwd: this.cwd },
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
        exec("gh", [
          "api",
          "graphql",
          "-f",
          `query=mutation { addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: "${threadNodeId}", body: "${body.replace(/"/g, '\\"').replace(/\n/g, "\\n")}" }) { comment { id } } }`,
        ], { cwd: this.cwd }),
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
      await exec("gh", args, { cwd: this.cwd });
      logger.info(`Re-requested review from: ${reviewers.join(", ")}`);
    } catch (err) {
      logger.warn(`Failed to re-request reviewers: ${err}`);
    }
  }

  /** Check whether a PR was merged. */
  async isPRMerged(prNumber: number): Promise<boolean> {
    const { owner, repo } = await this.getRepoInfo();
    try {
      const { stdout } = await exec("gh", [
        "api",
        `repos/${owner}/${repo}/pulls/${prNumber}`,
        "--jq", ".merged",
      ], { cwd: this.cwd });
      return stdout.trim() === "true";
    } catch {
      return false;
    }
  }

  /** Validate that `gh` is authenticated and can reach the repo. */
  async validateAuth(): Promise<void> {
    await exec("gh", ["auth", "status"], { cwd: this.cwd });
  }
}
