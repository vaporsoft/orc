/** Core domain types for Orc. */

export interface ReviewThread {
  id: string;
  /** GraphQL node ID for mutations. */
  threadId: string;
  path: string;
  line: number | null;
  body: string;
  author: string;
  isResolved: boolean;
  /** Diff hunk surrounding this comment. */
  diffHunk: string;
  /** When the comment was created. */
  createdAt: string;
}

export type CommentCategory =
  | "must_fix"
  | "should_fix"
  | "nice_to_have"
  | "false_positive"
  | "verify_and_fix";

export interface CategorizedComment {
  threadId: string;
  path: string;
  line: number | null;
  body: string;
  author: string;
  diffHunk: string;
  category: CommentCategory;
  confidence: number;
  reasoning: string;
  suggestedAction: string;
}

export interface CommentSummary {
  total: number;
  mustFix: number;
  shouldFix: number;
  niceToHave: number;
  falsePositive: number;
  verifyAndFix: number;
  comments: CategorizedComment[];
}

export interface CycleRecord {
  startedAt: string;
  completedAt: string | null;
  commentsSeen: number;
  commentsFixed: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export interface RepoConfig {
  instructions: string;
  verifyCommands: string[];
  autoFix: {
    must_fix: boolean;
    should_fix: boolean;
    nice_to_have: boolean;
    verify_and_fix: boolean;
  };
}

export type CIStatus = "pending" | "passing" | "failing" | "unknown";

export interface FailedCheck {
  id: number;
  name: string;
  htmlUrl: string;
  logSnippet: string | null;
}

export type SessionMode = "once" | "watch";

export type BranchStatus =
  | "stopped"
  | "initializing"
  | "watching"
  | "triaging"
  | "fixing"
  | "verifying"
  | "pushing"
  | "replying"
  | "ready"
  | "conflict_prompt"
  | "error"
  | "merged";

export interface BranchState {
  branch: string;
  prNumber: number | null;
  prUrl: string | null;
  status: BranchStatus;
  mode: SessionMode;
  commentsAddressed: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  error: string | null;
  unresolvedCount: number;
  commentSummary: CommentSummary | null;
  lastPushAt: string | null;
  claudeActivity: string[];
  lastSessionId: string | null;
  workDir: string | null;
  /** Timestamp (ms since epoch) when the watch session will expire. null if not a watch session. */
  sessionExpiresAt: number | null;
  /** Persistent progress — accumulated across sessions and daemon restarts. */
  lifetimeAddressed: number;
  lifetimeSeen: number;
  cycleCount: number;
  cycleHistory: CycleRecord[];
  ciStatus: CIStatus;
  failedChecks: FailedCheck[];
  ciFixAttempts: number;
  conflicted: string[];
  hasFixupCommits: boolean;
}

export interface SessionControllerEvents {
  statusChange: (branch: string, status: BranchStatus) => void;
  error: (branch: string, error: string) => void;
  ready: (branch: string, state: BranchState) => void;
}
