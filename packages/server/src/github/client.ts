import type { GHPullRequest, GHReviewThread, ReviewThread } from "../types";

const GITHUB_API = "https://api.github.com";
const GITHUB_GRAPHQL = "https://api.github.com/graphql";

/**
 * Resolve a GitHub token. Tries (in order):
 * 1. GITHUB_TOKEN env var
 * 2. GH_TOKEN env var
 * 3. `gh auth token` command output
 *
 * Throws if no token can be found.
 */
export async function resolveToken(): Promise<string> {
  // Env vars first — fast, no subprocess
  const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (envToken) return envToken;

  // Fall back to gh CLI auth
  try {
    const proc = Bun.spawn(["gh", "auth", "token"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode === 0 && output.trim()) {
      return output.trim();
    }
  } catch {
    // gh not installed or not in PATH
  }

  throw new Error(
    "No GitHub token found. Set GITHUB_TOKEN env var or run `gh auth login`."
  );
}

export class GitHubClient {
  constructor(
    private owner: string,
    private repo: string,
    private token: string
  ) {}

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  private get repoSlug(): string {
    return `${this.owner}/${this.repo}`;
  }

  async listOpenPRs(): Promise<GHPullRequest[]> {
    // Use GraphQL to get all the data we need in a single request
    const query = `
      query($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          pullRequests(states: OPEN, first: 100, orderBy: {field: UPDATED_AT, direction: DESC}) {
            nodes {
              number
              title
              url
              headRefName
              state
              reviewDecision
              comments {
                totalCount
              }
              commits(last: 1) {
                nodes {
                  commit {
                    statusCheckRollup {
                      contexts(first: 100) {
                        nodes {
                          __typename
                          ... on CheckRun {
                            status
                            conclusion
                          }
                          ... on StatusContext {
                            state
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const data = await this.graphql<{
      repository: {
        pullRequests: {
          nodes: Array<{
            number: number;
            title: string;
            url: string;
            headRefName: string;
            state: string;
            reviewDecision: string | null;
            comments: { totalCount: number };
            commits: {
              nodes: Array<{
                commit: {
                  statusCheckRollup: {
                    contexts: {
                      nodes: Array<{
                        __typename: string;
                        status?: string;
                        conclusion?: string;
                        state?: string;
                      }>;
                    };
                  } | null;
                };
              }>;
            };
          }>;
        };
      };
    }>(query, { owner: this.owner, repo: this.repo });

    return data.repository.pullRequests.nodes.map((pr) => {
      const lastCommit = pr.commits.nodes[0]?.commit;
      const checks =
        lastCommit?.statusCheckRollup?.contexts?.nodes ?? [];

      return {
        number: pr.number,
        title: pr.title,
        url: pr.url,
        headRefName: pr.headRefName,
        state: pr.state,
        reviewDecision: pr.reviewDecision ?? "",
        statusCheckRollup: checks.map((c) => ({
          __typename: c.__typename,
          status: c.status,
          conclusion: c.conclusion?.toUpperCase(),
          state: c.state,
        })),
        comments: { totalCount: pr.comments.totalCount },
      };
    });
  }

  async getPR(number: number): Promise<GHPullRequest> {
    const query = `
      query($owner: String!, $repo: String!, $pr: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $pr) {
            number
            title
            url
            headRefName
            state
            reviewDecision
            comments {
              totalCount
            }
            commits(last: 1) {
              nodes {
                commit {
                  statusCheckRollup {
                    contexts(first: 100) {
                      nodes {
                        __typename
                        ... on CheckRun {
                          status
                          conclusion
                        }
                        ... on StatusContext {
                          state
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const data = await this.graphql<{
      repository: {
        pullRequest: {
          number: number;
          title: string;
          url: string;
          headRefName: string;
          state: string;
          reviewDecision: string | null;
          comments: { totalCount: number };
          commits: {
            nodes: Array<{
              commit: {
                statusCheckRollup: {
                  contexts: {
                    nodes: Array<{
                      __typename: string;
                      status?: string;
                      conclusion?: string;
                      state?: string;
                    }>;
                  };
                } | null;
              };
            }>;
          };
        };
      };
    }>(query, { owner: this.owner, repo: this.repo, pr: number });

    const pr = data.repository.pullRequest;
    const lastCommit = pr.commits.nodes[0]?.commit;
    const checks =
      lastCommit?.statusCheckRollup?.contexts?.nodes ?? [];

    return {
      number: pr.number,
      title: pr.title,
      url: pr.url,
      headRefName: pr.headRefName,
      state: pr.state,
      reviewDecision: pr.reviewDecision ?? "",
      statusCheckRollup: checks.map((c) => ({
        __typename: c.__typename,
        status: c.status,
        conclusion: c.conclusion?.toUpperCase(),
        state: c.state,
      })),
      comments: { totalCount: pr.comments.totalCount },
    };
  }

  async listReviewThreads(prNumber: number): Promise<ReviewThread[]> {
    const query = `
      query($owner: String!, $repo: String!, $pr: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $pr) {
            reviewThreads(first: 100) {
              nodes {
                id
                isResolved
                comments(first: 50) {
                  nodes {
                    id
                    author { login }
                    body
                    createdAt
                    url
                    path
                    line
                  }
                }
              }
            }
          }
        }
      }
    `;

    const data = await this.graphql<{
      repository: {
        pullRequest: {
          reviewThreads: { nodes: GHReviewThread[] };
        };
      };
    }>(query, { owner: this.owner, repo: this.repo, pr: prNumber });

    const threads = data.repository.pullRequest.reviewThreads.nodes;

    return threads.map((t): ReviewThread => {
      const firstComment = t.comments.nodes[0];
      return {
        id: t.id,
        isResolved: t.isResolved,
        path: firstComment?.path ?? null,
        line: firstComment?.line ?? null,
        comments: t.comments.nodes.map((c) => ({
          id: c.id,
          author: c.author.login,
          body: c.body,
          createdAt: c.createdAt,
          url: c.url,
        })),
      };
    });
  }

  /** Make a GraphQL request to the GitHub API */
  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await fetch(GITHUB_GRAPHQL, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GitHub GraphQL error (${res.status}): ${body.slice(0, 500)}`);
    }

    const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };

    if (json.errors?.length) {
      throw new Error(`GitHub GraphQL errors: ${json.errors.map((e) => e.message).join(", ")}`);
    }

    if (!json.data) {
      throw new Error("GitHub GraphQL: empty response data");
    }

    return json.data;
  }
}
