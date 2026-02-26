import React, { useState, useEffect, useCallback } from "react";
import { Box, useInput, useApp, useStdout } from "ink";
import type { GitHubClient } from "../github/client";
import type { BranchStore, ThreadSummary } from "../state/store";
import type { ThreadStore } from "../state/thread-store";
import type { Branch, DashboardState, ReviewThread, ThreadDisposition } from "../types";
import { listLocalBranches } from "../git/branches";
import { Header } from "./Header";
import { PRTable } from "./PRTable";
import { PRDetail } from "./PRDetail";
import { Footer } from "./Footer";
import { exec } from "child_process";

interface AppProps {
  github: GitHubClient;
  store: BranchStore;
  threadStore: ThreadStore;
  repoRoot: string;
}

export function App({ github, store, threadStore, repoRoot }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [state, setState] = useState<DashboardState>(store.getState());
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [selectedPR, setSelectedPR] = useState<Branch | null>(null);
  const [threads, setThreads] = useState<ReviewThread[]>([]);
  const [dispositions, setDispositions] = useState<Record<string, ThreadDisposition>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [termWidth, setTermWidth] = useState(stdout?.columns ?? 80);

  const prBranches = state.branches.filter((b) => b.pr);

  // Track terminal resize
  useEffect(() => {
    const handler = () => setTermWidth(stdout?.columns ?? 80);
    stdout?.on("resize", handler);
    return () => { stdout?.off("resize", handler); };
  }, [stdout]);

  const refresh = useCallback(async () => {
    try {
      const [branches, prs, recentlyMerged] = await Promise.all([
        listLocalBranches(repoRoot),
        github.listOpenPRs(),
        github.listRecentlyMergedPRs(24).catch(() => []),
      ]);

      const threadSummaries = new Map<number, ThreadSummary>();
      const summaryResults = await Promise.allSettled(
        prs.map(async (pr) => {
          const t = await github.listReviewThreads(pr.number);
          const d = threadStore.getDispositions(pr.number);
          const resolvedCount = t.filter((th) => th.isResolved).length;
          const addressedCount = t.filter(
            (th) => !th.isResolved && d[th.id]
          ).length;
          return {
            prNumber: pr.number,
            summary: { threadCount: t.length, resolvedCount, addressedCount },
          };
        })
      );
      for (const result of summaryResults) {
        if (result.status === "fulfilled") {
          threadSummaries.set(result.value.prNumber, result.value.summary);
        }
      }

      store.update(branches, prs, threadSummaries);
      store.setRecentlyMerged(recentlyMerged);
      threadStore.pruneClosedPRs(prs.map((pr) => pr.number));
      setState(store.getState());
      setError(null);
      setLastRefresh(new Date());
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }, [github, store, threadStore, repoRoot]);

  // Initial refresh + interval
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30_000);
    return () => clearInterval(interval);
  }, [refresh]);

  // Fetch threads for a PR
  const fetchThreads = useCallback(
    async (prNumber: number) => {
      try {
        const t = await github.listReviewThreads(prNumber);
        const d = threadStore.getDispositions(prNumber);
        setThreads(t);
        setDispositions(d);
      } catch {
        // Fail silently for thread fetch
      }
    },
    [github, threadStore]
  );

  // Open URL in browser
  const openUrl = useCallback((url: string) => {
    exec(`open "${url}" 2>/dev/null || xdg-open "${url}" 2>/dev/null`);
  }, []);

  // Keyboard input
  useInput((input, key) => {
    if (selectedPR) {
      if (key.escape) {
        setSelectedPR(null);
        setThreads([]);
        setDispositions({});
        return;
      }
      if (input === "r") {
        if (selectedPR.pr) fetchThreads(selectedPR.pr.number);
        return;
      }
      if (input === "o" && selectedPR.pr) {
        openUrl(selectedPR.pr.url);
        return;
      }
      if (input === "q") {
        exit();
        return;
      }
      return;
    }

    // Table view
    if (key.upArrow || input === "k") {
      setSelectedIdx((i) => Math.max(0, i - 1));
    } else if (key.downArrow || input === "j") {
      setSelectedIdx((i) => Math.min(prBranches.length - 1, i + 1));
    } else if (key.return) {
      const branch = prBranches[selectedIdx];
      if (branch) {
        setSelectedPR(branch);
        if (branch.pr) fetchThreads(branch.pr.number);
      }
    } else if (input === "r") {
      refresh();
    } else if (input === "o") {
      const branch = prBranches[selectedIdx];
      if (branch?.pr) openUrl(branch.pr.url);
    } else if (input === "q") {
      exit();
    }
  });

  return (
    <Box flexDirection="column">
      <Header
        repo={state.repo}
        prCount={prBranches.length}
        lastRefresh={lastRefresh}
        loading={loading}
        error={error}
        width={termWidth}
      />

      {selectedPR ? (
        <PRDetail
          branch={selectedPR}
          threads={threads}
          dispositions={dispositions}
          width={termWidth}
        />
      ) : (
        <PRTable
          branches={prBranches}
          recentlyMerged={state.recentlyMerged}
          selectedIdx={selectedIdx}
        />
      )}

      <Footer mode={selectedPR ? "detail" : "table"} width={termWidth} />
    </Box>
  );
}
