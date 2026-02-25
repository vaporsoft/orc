export interface BranchPR {
  number: number;
  title: string;
  url: string;
  reviewState: "approved" | "changes_requested" | "pending" | "none";
  checksState: "success" | "failure" | "pending" | "none";
  commentCount: number;
}

export interface BranchAgent {
  status: "idle" | "running" | "waiting" | "error";
  currentTask?: string;
  tokensUsed?: number;
  turns?: number;
  startedAt?: string;
}

export interface Branch {
  name: string;
  isHead: boolean;
  pr?: BranchPR;
  agent?: BranchAgent;
  updatedAt: string;
}

export interface RepoInfo {
  owner: string;
  repo: string;
  root: string;
  defaultBranch: string;
}

export interface DashboardState {
  repo: RepoInfo;
  branches: Branch[];
  lastUpdated: string;
}

export type ServerMessage =
  | { type: "state"; data: DashboardState }
  | { type: "branch_updated"; data: Branch }
  | { type: "error"; message: string };
