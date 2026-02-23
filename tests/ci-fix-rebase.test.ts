import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

/**
 * Tests the CI fix loop behavior when checking whether to push.
 *
 * Since checkAndFixCI is private, we extract and test the decision logic
 * that determines whether to push after Claude makes no commits.
 *
 * The key change: instead of relying on a stale `rebaseChangedHead` flag
 * computed at cycle start, we now check `isAheadOfRemote()` dynamically
 * to determine if there's actually something to push.
 */

// Mirrors the decision logic in SessionController.checkAndFixCI
function decideCIFixAction(opts: {
  ciFixIsError: boolean;
  claudeMadeCommits: boolean;
  isAheadOfRemote: boolean;
  pushSucceeded: boolean;
}): "push_claude_fix" | "push_rebased_branch" | "break_error" | "break_no_change" {
  const { ciFixIsError, claudeMadeCommits, isAheadOfRemote, pushSucceeded } = opts;

  if (ciFixIsError || !pushSucceeded) {
    return "break_error";
  }

  if (claudeMadeCommits) {
    return "push_claude_fix";
  }

  // Claude made no commits — check if we have unpushed changes
  if (isAheadOfRemote) {
    return "push_rebased_branch";
  }

  return "break_no_change";
}

describe("CI fix loop with dynamic remote check", () => {
  it("pushes rebased branch when Claude makes no commits but local is ahead of remote", () => {
    const action = decideCIFixAction({
      ciFixIsError: false,
      claudeMadeCommits: false,
      isAheadOfRemote: true,
      pushSucceeded: true,
    });
    expect(action).toBe("push_rebased_branch");
  });

  it("breaks with no change when Claude makes no commits and local matches remote", () => {
    const action = decideCIFixAction({
      ciFixIsError: false,
      claudeMadeCommits: false,
      isAheadOfRemote: false,
      pushSucceeded: true,
    });
    expect(action).toBe("break_no_change");
  });

  it("pushes Claude fix when Claude made commits", () => {
    const action = decideCIFixAction({
      ciFixIsError: false,
      claudeMadeCommits: true,
      isAheadOfRemote: false,
      pushSucceeded: true,
    });
    expect(action).toBe("push_claude_fix");
  });

  it("pushes Claude fix even when also ahead of remote", () => {
    const action = decideCIFixAction({
      ciFixIsError: false,
      claudeMadeCommits: true,
      isAheadOfRemote: true,
      pushSucceeded: true,
    });
    expect(action).toBe("push_claude_fix");
  });

  it("breaks on error regardless of remote state", () => {
    expect(
      decideCIFixAction({
        ciFixIsError: true,
        claudeMadeCommits: false,
        isAheadOfRemote: true,
        pushSucceeded: true,
      }),
    ).toBe("break_error");

    expect(
      decideCIFixAction({
        ciFixIsError: true,
        claudeMadeCommits: true,
        isAheadOfRemote: false,
        pushSucceeded: true,
      }),
    ).toBe("break_error");
  });

  it("breaks on push failure regardless of remote state", () => {
    expect(
      decideCIFixAction({
        ciFixIsError: false,
        claudeMadeCommits: true,
        isAheadOfRemote: true,
        pushSucceeded: false,
      }),
    ).toBe("break_error");
  });

  // New test case: verifies the fix for stale flag issue
  it("does not push when rebase was done earlier but already pushed", () => {
    // This scenario: rebase changed HEAD, we pushed in main flow,
    // now in CI fix loop Claude made no commits.
    // OLD behavior: would push again (no-op) based on stale rebaseChangedHead flag
    // NEW behavior: checks isAheadOfRemote, finds local matches remote, breaks
    const action = decideCIFixAction({
      ciFixIsError: false,
      claudeMadeCommits: false,
      isAheadOfRemote: false, // Already pushed, local matches remote
      pushSucceeded: true,
    });
    expect(action).toBe("break_no_change");
  });
});
