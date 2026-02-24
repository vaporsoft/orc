/**
 * Shared lock that serializes git operations targeting the main repo's .git directory.
 * Prevents index.lock contention and gc.auto-triggered worktree prune.
 */
export class GitLock {
  private queue: Promise<void> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.then(
      () => {},
      () => {},
    );
    return next;
  }
}
