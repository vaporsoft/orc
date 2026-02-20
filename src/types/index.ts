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

export interface CICheck {
  id: string;
  name: string;
  status: "completed" | "in_progress" | "queued";
  conclusion:
    | "success"
    | "failure"
    | "neutral"
    | "cancelled"
    | "skipped"
    | "timed_out"
    | "action_required"
    | null;
  detailsUrl: string;
  /** Run ID for fetching logs. */
  runId: number | null;
}

export type PREventType = "review_comment" | "ci_failure";

export interface PREvent {
  type: PREventType;
  /** Unique key for deduplication (thread id or check id). */
  key: string;
  thread?: ReviewThread;
  ciCheck?: CICheck;
  /** Failed CI log output, if available. */
  ciLog?: string;
}

export type CommentCategory =
  | "must_fix"
  | "should_fix"
  | "nice_to_have"
  | "false_positive";

export interface CommentAnalysis {
  threadId: string;
  confidence: number;
  category: CommentCategory;
  reasoning: string;
  suggestedAction: string;
}

export type BranchStatus =
  | "stopped"
  | "initializing"
  | "polling"
  | "debouncing"
  | "analyzing"
  | "fixing"
  | "pushing"
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
  /** Thread IDs we've already processed. */
  seenThreadIds: Set<string>;
  /** CI check IDs we've already processed. */
  seenCheckIds: Set<string>;
}

export interface SessionControllerEvents {
  statusChange: (branch: string, status: BranchStatus) => void;
  iterationComplete: (branch: string, summary: IterationSummary) => void;
  error: (branch: string, error: string) => void;
  done: (branch: string, state: BranchState) => void;
}
