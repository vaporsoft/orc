import { execOrThrow } from "../utils/exec";

export interface LocalBranch {
  name: string;
  isHead: boolean;
  commit: string;
  upstream?: string;
}

export async function listLocalBranches(
  repoPath: string
): Promise<LocalBranch[]> {
  const output = await execOrThrow(
    "git",
    [
      "for-each-ref",
      "--format=%(refname:short)|%(HEAD)|%(objectname:short)|%(upstream:short)",
      "refs/heads/",
    ],
    { cwd: repoPath }
  );

  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, head, commit, upstream] = line.split("|");
      return {
        name,
        isHead: head === "*",
        commit,
        upstream: upstream || undefined,
      };
    });
}
