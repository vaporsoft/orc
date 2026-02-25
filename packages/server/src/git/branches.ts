export interface LocalBranch {
  name: string;
  isHead: boolean;
  commit: string;
  upstream?: string;
}

export async function listLocalBranches(
  repoPath: string
): Promise<LocalBranch[]> {
  const proc = Bun.spawn(
    [
      "git",
      "for-each-ref",
      "--format=%(refname:short)|%(HEAD)|%(objectname:short)|%(upstream:short)",
      "refs/heads/",
    ],
    { cwd: repoPath, stdout: "pipe", stderr: "pipe" }
  );
  const output = await new Response(proc.stdout).text();
  await proc.exited;

  return output
    .trim()
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
