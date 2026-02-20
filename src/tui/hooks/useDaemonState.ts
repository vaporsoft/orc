import { useState, useEffect, useCallback } from "react";
import type { Daemon } from "../../core/daemon.js";
import type { BranchState } from "../../types/index.js";
import type { GHPullRequest } from "../../github/types.js";

export interface PREntry {
  branch: string;
  pr: GHPullRequest;
  state: BranchState | null; // null = discovered but not running
  commentCount: number;
}

function buildEntries(daemon: Daemon): Map<string, PREntry> {
  const entries = new Map<string, PREntry>();
  const counts = daemon.getCommentCounts();
  for (const [branch, pr] of daemon.getDiscoveredPRs()) {
    const session = daemon.getSessions().get(branch);
    entries.set(branch, {
      branch,
      pr,
      state: session ? session.getState() : null,
      commentCount: counts.get(branch) ?? 0,
    });
  }
  return entries;
}

export function useDaemonState(daemon: Daemon): Map<string, PREntry> {
  const [entries, setEntries] = useState<Map<string, PREntry>>(() => buildEntries(daemon));

  const rebuild = useCallback(() => {
    setEntries(buildEntries(daemon));
  }, [daemon]);

  useEffect(() => {
    daemon.on("prDiscovered", rebuild);
    daemon.on("prRemoved", rebuild);
    daemon.on("prUpdate", rebuild);
    daemon.on("sessionUpdate", rebuild);
    daemon.on("commentCountUpdate", rebuild);

    return () => {
      daemon.off("prDiscovered", rebuild);
      daemon.off("prRemoved", rebuild);
      daemon.off("prUpdate", rebuild);
      daemon.off("sessionUpdate", rebuild);
      daemon.off("commentCountUpdate", rebuild);
    };
  }, [daemon, rebuild]);

  return entries;
}
