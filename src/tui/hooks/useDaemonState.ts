import { useState, useEffect, useCallback, useRef } from "react";
import type { Daemon } from "../../core/daemon.js";
import type { BranchState, ReviewThread } from "../../types/index.js";
import type { GHPullRequest } from "../../github/types.js";

export interface PREntry {
  branch: string;
  pr: GHPullRequest;
  state: BranchState | null; // null = discovered but not running
  commentCount: number;
  commentThreads: ReviewThread[];
}

function buildEntries(daemon: Daemon): Map<string, PREntry> {
  const entries = new Map<string, PREntry>();
  const counts = daemon.getCommentCounts();
  const threads = daemon.getCommentThreads();
  const lastStates = daemon.getLastStates();
  const progressStore = daemon.getProgressStore();
  for (const [branch, pr] of daemon.getDiscoveredPRs()) {
    const session = daemon.getSessions().get(branch);
    let state = session ? session.getState() : (lastStates.get(branch) ?? null);

    // Inject persistent lifetime stats for idle branches
    if (!state) {
      const lifetime = progressStore.getLifetimeStats(branch);
      if (lifetime.cycleCount > 0) {
        state = {
          branch,
          prNumber: pr.number,
          prUrl: pr.url,
          status: "stopped",
          mode: "once",
          commentsAddressed: 0,
          totalCostUsd: 0,
          error: null,
          unresolvedCount: 0,
          commentSummary: null,
          lastPushAt: null,
          claudeActivity: [],
          lastSessionId: null,
          workDir: null,
          ...lifetime,
        };
      }
    }

    entries.set(branch, {
      branch,
      pr,
      state,
      commentCount: counts.get(branch) ?? 0,
      commentThreads: threads.get(branch) ?? [],
    });
  }
  return entries;
}

const THROTTLE_MS = 100;

export function useDaemonState(daemon: Daemon): Map<string, PREntry> {
  const [entries, setEntries] = useState<Map<string, PREntry>>(() => buildEntries(daemon));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef(false);

  const flush = useCallback(() => {
    timerRef.current = null;
    pendingRef.current = false;
    setEntries(buildEntries(daemon));
  }, [daemon]);

  const rebuild = useCallback(() => {
    if (timerRef.current) {
      pendingRef.current = true;
      return;
    }
    flush();
    timerRef.current = setTimeout(() => {
      if (pendingRef.current) {
        flush();
      } else {
        timerRef.current = null;
      }
    }, THROTTLE_MS);
  }, [flush]);

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
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [daemon, rebuild]);

  return entries;
}
