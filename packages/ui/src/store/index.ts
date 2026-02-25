import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  Branch,
  DashboardState,
  RepoInfo,
  PRThreadState,
  ReviewThread,
  ThreadDisposition,
  DispositionKind,
} from "../types";

interface DashboardStore {
  // --- Dashboard state ---
  branches: Branch[];
  selectedBranch: string | null;
  repo: RepoInfo | null;
  lastUpdated: string | null;
  connected: boolean;
  error: string | null;

  // --- Thread state ---
  /** Threads keyed by PR number */
  threadsByPR: Record<number, ReviewThread[]>;
  /** Local disposition overrides, keyed by PR number → thread ID */
  dispositionsByPR: Record<number, Record<string, ThreadDisposition>>;
  /** Which PR's threads are currently loading */
  threadsLoading: number | null;

  // --- Dashboard actions ---
  selectBranch: (name: string | null) => void;
  applyState: (state: DashboardState) => void;
  updateBranch: (branch: Branch) => void;
  setConnected: (connected: boolean) => void;
  setError: (error: string | null) => void;

  // --- Thread actions ---
  applyThreads: (data: PRThreadState) => void;
  setThreadsLoading: (prNumber: number | null) => void;
}

export const useDashboardStore = create<DashboardStore>()(
  persist(
    (set) => ({
      // Dashboard defaults
      branches: [],
      selectedBranch: null,
      repo: null,
      lastUpdated: null,
      connected: false,
      error: null,

      // Thread defaults
      threadsByPR: {},
      dispositionsByPR: {},
      threadsLoading: null,

      // Dashboard actions
      selectBranch: (name) => set({ selectedBranch: name }),

      applyState: (state) =>
        set({
          branches: state.branches,
          repo: state.repo,
          lastUpdated: state.lastUpdated,
          error: null,
        }),

      updateBranch: (branch) =>
        set((prev) => ({
          branches: prev.branches.map((b) =>
            b.name === branch.name ? branch : b
          ),
        })),

      setConnected: (connected) => set({ connected }),
      setError: (error) => set({ error }),

      // Thread actions
      applyThreads: (data) =>
        set((prev) => ({
          threadsByPR: {
            ...prev.threadsByPR,
            // Only update threads if we received a non-empty array
            // (dispositions-only updates from mark_thread send [])
            ...(data.threads.length > 0
              ? { [data.prNumber]: data.threads }
              : {}),
          },
          dispositionsByPR: {
            ...prev.dispositionsByPR,
            [data.prNumber]: data.dispositions,
          },
          threadsLoading: null,
        })),

      setThreadsLoading: (prNumber) => set({ threadsLoading: prNumber }),
    }),
    {
      name: "orc-dashboard",
      storage: createJSONStorage(() => localStorage),
      // Only persist thread dispositions and selected branch — not transient state
      partialize: (state) => ({
        selectedBranch: state.selectedBranch,
        dispositionsByPR: state.dispositionsByPR,
        threadsByPR: state.threadsByPR,
      }),
    }
  )
);
