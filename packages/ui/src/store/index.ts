import { create } from "zustand";
import type { Branch, DashboardState, RepoInfo } from "../types";

interface DashboardStore {
  // State
  branches: Branch[];
  selectedBranch: string | null;
  repo: RepoInfo | null;
  lastUpdated: string | null;
  connected: boolean;
  error: string | null;

  // Actions
  selectBranch: (name: string | null) => void;
  applyState: (state: DashboardState) => void;
  updateBranch: (branch: Branch) => void;
  setConnected: (connected: boolean) => void;
  setError: (error: string | null) => void;
}

export const useDashboardStore = create<DashboardStore>((set) => ({
  branches: [],
  selectedBranch: null,
  repo: null,
  lastUpdated: null,
  connected: false,
  error: null,

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
}));
