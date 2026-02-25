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

// --- Thread disposition tracking ---

export type DispositionKind =
  | "fixed"
  | "skipped"
  | "errored"
  | "no_change"
  | "clarification"
  | "addressed"; // manually marked by user via dashboard

export interface ThreadDisposition {
  /** What happened when orc last processed this thread */
  disposition: DispositionKind;
  /** Total processing attempts across all cycles */
  attempts: number;
  /** ISO timestamp of the last attempt — compared against comment timestamps */
  lastAttemptAt: string;
}

/** A single review thread from GitHub */
export interface ReviewThread {
  id: string;
  /** Whether the thread is resolved on GitHub */
  isResolved: boolean;
  /** Path to the file the comment is on (null for PR conversation comments) */
  path: string | null;
  /** Diff line number */
  line: number | null;
  /** The comments in this thread */
  comments: ThreadComment[];
}

export interface ThreadComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  url: string;
}

/** Per-PR thread state sent to the client */
export interface PRThreadState {
  prNumber: number;
  threads: ReviewThread[];
  /** Local disposition overrides, keyed by thread ID */
  dispositions: Record<string, ThreadDisposition>;
}

// --- WebSocket messages ---

// WebSocket messages: server → client
export type ServerMessage =
  | { type: "state"; data: DashboardState }
  | { type: "branch_updated"; data: Branch }
  | { type: "threads"; data: PRThreadState }
  | { type: "error"; message: string };

// WebSocket messages: client → server
export type ClientMessage =
  | { type: "refresh" }
  | { type: "select_branch"; name: string }
  | { type: "fetch_threads"; prNumber: number }
  | { type: "mark_thread"; prNumber: number; threadId: string; disposition: DispositionKind };

// --- GitHub API types ---

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

// GitHub GraphQL review thread shape
export interface GHReviewThread {
  id: string;
  isResolved: boolean;
  comments: {
    nodes: Array<{
      id: string;
      author: { login: string };
      body: string;
      createdAt: string;
      url: string;
      path?: string;
      line?: number;
    }>;
  };
}
