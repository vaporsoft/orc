import { useState, useEffect, useCallback, useRef } from "react";
import type { Daemon } from "../../core/daemon.js";
import type { CIStatus, FailedCheck, ReviewThread } from "../../types/index.js";
import type { ThreadCounts } from "../../core/comment-fetcher.js";
import type { GHPullRequest } from "../../github/types.js";

export interface PREntry {
  branch: string;
  pr: GHPullRequest;
  state: import("../../types/index.js").BranchState | null; // null = discovered but not running
  commentCount: number;
  commentThreads: ReviewThread[];
  threadCounts: ThreadCounts | null;
  ciStatus: CIStatus;
  failedChecks: FailedCheck[];
  conflicted: string[];
  /** Timestamp (ms) when the PR was detected as merged. Undefined for open PRs. */
  mergedAt?: number;
}

function buildEntries(daemon: Daemon): Map<string, PREntry> {
  const entries = new Map<string, PREntry>();
  const counts = daemon.getCommentCounts();
  const threads = daemon.getCommentThreads();
  const lastStates = daemon.getLastStates();
  const progressStore = daemon.getProgressStore();
  const allThreadCounts = daemon.getThreadCounts();
  const ciStatuses = daemon.getCIStatuses();
  const ciFailedChecks = daemon.getCIFailedChecks();
  const conflictStatuses = daemon.getConflictStatuses();
  for (const [branch, pr] of daemon.getDiscoveredPRs()) {
    const session = daemon.getSessions().get(branch);
    let state = session ? session.getState() : (lastStates.get(branch) ?? null);

    // Inject persistent lifetime stats for idle branches
    if (!state) {
      const lifetime = progressStore.getLifetimeStats(branch);
      if (lifetime.cycleCount > 0) {
        const totalCostUsd = lifetime.cycleHistory.reduce((sum, cycle) => sum + cycle.costUsd, 0);
        const totalInputTokens = lifetime.cycleHistory.reduce((sum, cycle) => sum + (cycle.inputTokens ?? 0), 0);
        const totalOutputTokens = lifetime.cycleHistory.reduce((sum, cycle) => sum + (cycle.outputTokens ?? 0), 0);
        state = {
          branch,
          prNumber: pr.number,
          prUrl: pr.url,
          status: "stopped",
          mode: "once",
          commentsAddressed: 0,
          totalCostUsd,
          totalInputTokens,
          totalOutputTokens,
          error: null,
          unresolvedCount: 0,
          commentSummary: null,
          lastPushAt: null,
          claudeActivity: [],
          lastSessionId: null,
          workDir: null,
          ...lifetime,
          ciStatus: "unknown",
          failedChecks: [],
          ciFixAttempts: 0,
          conflicted: [],
          hasFixupCommits: false,
          sessionExpiresAt: null,
        };
      }
    }

    // Active sessions own their CI/conflict state; idle branches use daemon-polled data
    const isActive = session != null;
    entries.set(branch, {
      branch,
      pr,
      state,
      commentCount: counts.get(branch) ?? state?.unresolvedCount ?? 0,
      commentThreads: threads.get(branch) ?? [],
      threadCounts: allThreadCounts.get(branch) ?? null,
      ciStatus: isActive && state!.ciStatus !== "unknown" ? state!.ciStatus : (ciStatuses.get(branch) ?? "unknown"),
      failedChecks: isActive && state!.ciStatus !== "unknown" ? (state!.failedChecks ?? []) : (ciFailedChecks.get(branch) ?? []),
      conflicted: isActive ? (state!.conflicted ?? []) : (conflictStatuses.get(branch) ?? []),
    });
  }
  // Include merged PRs (but skip if there's already an open PR for the same branch)
  for (const [branch, { pr, mergedAt }] of daemon.getMergedPRs()) {
    if (!entries.has(branch)) {
      entries.set(branch, {
        branch,
        pr,
        state: lastStates.get(branch) ?? null,
        commentCount: 0,
        commentThreads: [],
        threadCounts: null,
        ciStatus: "unknown" as const,
        failedChecks: [],
        conflicted: [],
        mergedAt,
      });
    }
  }
  return entries;
}

const THROTTLE_MS = 200;

export function useDaemonState(daemon: Daemon): Map<string, PREntry> {
  const [entries, setEntries] = useState<Map<string, PREntry>>(() => buildEntries(daemon));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef(false);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
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
    daemon.on("prMerged", rebuild);
    daemon.on("sessionUpdate", rebuild);
    daemon.on("commentCountUpdate", rebuild);
    daemon.on("ciStatusUpdate", rebuild);
    daemon.on("conflictStatusUpdate", rebuild);

    return () => {
      daemon.off("prDiscovered", rebuild);
      daemon.off("prRemoved", rebuild);
      daemon.off("prUpdate", rebuild);
      daemon.off("prMerged", rebuild);
      daemon.off("sessionUpdate", rebuild);
      daemon.off("commentCountUpdate", rebuild);
      daemon.off("ciStatusUpdate", rebuild);
      daemon.off("conflictStatusUpdate", rebuild);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [daemon, rebuild]);

  return entries;
}
