import type { RepoInfo } from "../types";

export async function getRepoRoot(path: string): Promise<string> {
  const proc = Bun.spawn(["git", "rev-parse", "--show-toplevel"], {
    cwd: path,
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Not a git repository: ${path}`);
  }
  return output.trim();
}

export async function getRepoInfo(repoPath: string): Promise<RepoInfo> {
  // Get remote URL
  const remoteProc = Bun.spawn(["git", "remote", "get-url", "origin"], {
    cwd: repoPath,
    stdout: "pipe",
    stderr: "pipe",
  });
  const remoteUrl = (await new Response(remoteProc.stdout).text()).trim();
  await remoteProc.exited;

  // Parse owner/repo from remote URL
  // Supports: https://github.com/owner/repo.git, git@github.com:owner/repo.git
  const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (!match) {
    throw new Error(`Cannot parse GitHub remote URL: ${remoteUrl}`);
  }

  const owner = match[1];
  const repo = match[2];

  // Get default branch via gh CLI
  const defProc = Bun.spawn(
    [
      "gh",
      "repo",
      "view",
      `${owner}/${repo}`,
      "--json",
      "defaultBranchRef",
      "--jq",
      ".defaultBranchRef.name",
    ],
    { cwd: repoPath, stdout: "pipe", stderr: "pipe" }
  );
  const defaultBranch =
    (await new Response(defProc.stdout).text()).trim() || "main";
  await defProc.exited;

  return { owner, repo, root: repoPath, defaultBranch };
}
