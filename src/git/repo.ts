import type { RepoInfo } from "../types";
import { execOrThrow } from "../utils/exec";

export async function getRepoRoot(path: string): Promise<string> {
  return execOrThrow("git", ["rev-parse", "--show-toplevel"], {
    cwd: path,
    errorMessage: `Not a git repository: ${path}`,
  });
}

export async function getRepoInfo(repoPath: string): Promise<RepoInfo> {
  const remoteUrl = await execOrThrow("git", ["remote", "get-url", "origin"], {
    cwd: repoPath,
    errorMessage: "Failed to get git remote URL",
  });

  // Supports: https://github.com/owner/repo.git, git@github.com:owner/repo.git
  const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (!match) {
    throw new Error(`Cannot parse GitHub remote URL: ${remoteUrl}`);
  }

  const owner = match[1];
  const repo = match[2];

  // Get default branch — try git symbolic-ref first (no gh dependency)
  let defaultBranch = "main";
  try {
    const ref = await execOrThrow(
      "git",
      ["symbolic-ref", "refs/remotes/origin/HEAD"],
      { cwd: repoPath }
    );
    defaultBranch = ref.split("/").pop() || "main";
  } catch {
    try {
      const ghResult = await execOrThrow(
        "gh",
        [
          "repo", "view", `${owner}/${repo}`,
          "--json", "defaultBranchRef",
          "--jq", ".defaultBranchRef.name",
        ],
        { cwd: repoPath }
      );
      if (ghResult) defaultBranch = ghResult;
    } catch {
      // Fall back to "main"
    }
  }

  return { owner, repo, root: repoPath, defaultBranch };
}
