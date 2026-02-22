/** Default values and magic numbers. */

/** Seconds between GitHub polls. */
export const DEFAULT_POLL_INTERVAL = 30;

/** Default confidence threshold for comment classification. */
export const DEFAULT_CONFIDENCE = 0.75;

/** Default Claude Code session timeout in seconds. */
export const DEFAULT_CLAUDE_TIMEOUT = 900;

/** Default session timeout in hours. */
export const DEFAULT_SESSION_TIMEOUT = 1;

/** Retry backoff intervals in milliseconds. */
export const RETRY_BACKOFF_MS = [2000, 4000, 8000, 16000];

/** Worktree base directory. */
export const WORKTREE_BASE = "/tmp/orc";

/** Maximum number of CI fix attempts per session cycle. */
export const MAX_CI_FIX_ATTEMPTS = 2;

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
  "Bash(git merge-tree *)",
  "Bash(git rebase *)",
  "Bash(git show *)",
  "Bash(git checkout *)",
] as const;
