import type { GHPullRequest } from "../types";

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
}
