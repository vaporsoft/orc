export interface BranchPR {
  number: number;
  title: string;
  url: string;
  reviewState: "approved" | "changes_requested" | "pending" | "none";
  checksState: "success" | "failure" | "pending" | "none";
  commentCount: number;
  threadCount: number;
  resolvedCount: number;
  addressedCount: number;
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

export interface MergedPR {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  mergedAt: string;
  author: string;
}

export interface DashboardState {
  repo: RepoInfo;
  branches: Branch[];
  recentlyMerged: MergedPR[];
  lastUpdated: string;
}

// --- Thread disposition tracking ---

export type DispositionKind =
  | "fixed"
  | "skipped"
  | "errored"
  | "no_change"
  | "clarification"
  | "addressed";

export interface ThreadDisposition {
  disposition: DispositionKind;
  attempts: number;
  lastAttemptAt: string;
}

export interface ReviewThread {
  id: string;
  isResolved: boolean;
  path: string | null;
  line: number | null;
  comments: ThreadComment[];
}

export interface ThreadComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  url: string;
}

export interface PRThreadState {
  prNumber: number;
  threads: ReviewThread[];
  dispositions: Record<string, ThreadDisposition>;
}

// --- WebSocket messages ---

export type ServerMessage =
  | { type: "state"; data: DashboardState }
  | { type: "branch_updated"; data: Branch }
  | { type: "threads"; data: PRThreadState }
  | { type: "error"; message: string };
