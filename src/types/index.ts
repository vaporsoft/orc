/** Core domain types for PR Pilot. */

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
  | "false_positive";

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
  comments: CategorizedComment[];
}

export interface RepoPilotConfig {
  instructions: string;
  verifyCommands: string[];
  autoFix: {
    must_fix: boolean;
    should_fix: boolean;
    nice_to_have: boolean;
  };
}

export type BranchStatus =
  | "stopped"
  | "initializing"
  | "awaiting"
  | "categorizing"
  | "fixing"
  | "verifying"
  | "pushing"
  | "replying"
  | "paused"
  | "done"
  | "error";

export interface IterationSummary {
  iteration: number;
  startedAt: string;
  completedAt: string;
  eventsDetected: number;
  eventsFixed: number;
  eventsSkipped: number;
  costUsd: number;
  durationMs: number;
  changes: string[];
  errors: string[];
}

export interface BranchState {
  branch: string;
  prNumber: number | null;
  prUrl: string | null;
  status: BranchStatus;
  currentIteration: number;
  maxIterations: number;
  iterations: IterationSummary[];
  totalCostUsd: number;
  error: string | null;
  unresolvedCount: number;
  commentSummary: CommentSummary | null;
  lastPushAt: string | null;
}

export interface SessionControllerEvents {
  statusChange: (branch: string, status: BranchStatus) => void;
  iterationComplete: (branch: string, summary: IterationSummary) => void;
  error: (branch: string, error: string) => void;
  done: (branch: string, state: BranchState) => void;
}
