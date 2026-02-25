import type { GHPullRequest, GHReviewThread, ReviewThread } from "../types";

export class GitHubClient {
  constructor(
    private owner: string,
    private repo: string
  ) {}

  async listOpenPRs(): Promise<GHPullRequest[]> {
    const proc = Bun.spawn(
      [
        "gh",
        "pr",
        "list",
        "--repo",
        `${this.owner}/${this.repo}`,
        "--state",
        "open",
        "--json",
        "number,title,url,headRefName,state,reviewDecision,statusCheckRollup,comments",
        "--limit",
        "100",
      ],
      { stdout: "pipe", stderr: "pipe" }
    );
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`gh pr list failed: ${stderr}`);
    }

    try {
      return JSON.parse(output) as GHPullRequest[];
    } catch {
      throw new Error(`Failed to parse gh output: ${output.slice(0, 200)}`);
    }
  }

  async getPR(number: number): Promise<GHPullRequest> {
    const proc = Bun.spawn(
      [
        "gh",
        "pr",
        "view",
        String(number),
        "--repo",
        `${this.owner}/${this.repo}`,
        "--json",
        "number,title,url,headRefName,state,reviewDecision,statusCheckRollup,comments",
      ],
      { stdout: "pipe", stderr: "pipe" }
    );
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`gh pr view failed: ${stderr}`);
    }

    return JSON.parse(output) as GHPullRequest;
  }

  /** Fetch all review threads for a PR using gh GraphQL API */
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

    const proc = Bun.spawn(
      [
        "gh",
        "api",
        "graphql",
        "-f",
        `query=${query}`,
        "-F",
        `owner=${this.owner}`,
        "-F",
        `repo=${this.repo}`,
        "-F",
        `pr=${prNumber}`,
      ],
      { stdout: "pipe", stderr: "pipe" }
    );
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`gh api graphql failed: ${stderr}`);
    }

    const result = JSON.parse(output) as {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: { nodes: GHReviewThread[] };
          };
        };
      };
    };

    const threads =
      result.data.repository.pullRequest.reviewThreads.nodes;

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
}
