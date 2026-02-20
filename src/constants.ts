/** Default values and magic numbers. */

/** Seconds between GitHub polls. */
export const DEFAULT_POLL_INTERVAL = 30;

/** Default max fix iterations per branch. */
export const DEFAULT_MAX_LOOPS = 10;

/** Default confidence threshold for comment classification. */
export const DEFAULT_CONFIDENCE = 0.75;

/** Default Claude Code session timeout in seconds. */
export const DEFAULT_CLAUDE_TIMEOUT = 900;

/** Default max turns per Claude Code session. */
export const DEFAULT_MAX_TURNS = 30;

/** Retry backoff intervals in milliseconds. */
export const RETRY_BACKOFF_MS = [2000, 4000, 8000, 16000];

/** Worktree base directory. */
export const WORKTREE_BASE = "/tmp/orc";

/** Tools allowed in Claude Code sessions. */
export const ALLOWED_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Task",
  "Bash(git diff *)",
  "Bash(git log *)",
  "Bash(git status *)",
  "Bash(git add *)",
  "Bash(git commit *)",
  "Bash(npm run lint *)",
  "Bash(npm run typecheck *)",
  "Bash(npm run test *)",
  "Bash(yarn lint *)",
  "Bash(yarn typecheck *)",
  "Bash(yarn test *)",
] as const;
