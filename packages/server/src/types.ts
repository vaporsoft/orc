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

// WebSocket messages: server → client
export type ServerMessage =
  | { type: "state"; data: DashboardState }
  | { type: "branch_updated"; data: Branch }
  | { type: "error"; message: string };

// WebSocket messages: client → server
export type ClientMessage =
  | { type: "refresh" }
  | { type: "select_branch"; name: string };

// GitHub CLI PR shape
export interface GHPullRequest {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  state: string;
  reviewDecision: string;
  statusCheckRollup: Array<{
    __typename: string;
    status?: string;
    conclusion?: string;
    state?: string;
  }>;
  comments: { totalCount: number };
}
