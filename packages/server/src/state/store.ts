import type { Branch, BranchPR, DashboardState, GHPullRequest, MergedPR, RepoInfo, ThreadDisposition } from "../types";
import type { LocalBranch } from "../git/branches";

export interface ThreadSummary {
  threadCount: number;
  resolvedCount: number;
  addressedCount: number;
}

export class BranchStore {
  private branches: Map<string, Branch> = new Map();
  private _recentlyMerged: MergedPR[] = [];
  private repoInfo: RepoInfo = {
    owner: "",
    repo: "",
    root: "",
    defaultBranch: "main",
  };
  lastError: string | null = null;

  setRepoInfo(info: RepoInfo) {
    this.repoInfo = info;
  }

  update(
    localBranches: LocalBranch[],
    prs: GHPullRequest[],
    threadSummaries?: Map<number, ThreadSummary>
  ) {
    const localMap = new Map<string, LocalBranch>();
    for (const local of localBranches) {
      localMap.set(local.name, local);
    }

    const updated = new Map<string, Branch>();

    // Add all open PRs (whether or not the branch exists locally)
    for (const pr of prs) {
      const local = localMap.get(pr.headRefName);
      const summary = threadSummaries?.get(pr.number);

      const branch: Branch = {
        name: pr.headRefName,
        isHead: local?.isHead ?? false,
        updatedAt: new Date().toISOString(),
        pr: {
          number: pr.number,
          title: pr.title,
          url: pr.url,
          reviewState: mapReviewDecision(pr.reviewDecision),
          checksState: mapChecksState(pr.statusCheckRollup),
          commentCount: pr.comments?.totalCount ?? 0,
          threadCount: summary?.threadCount ?? 0,
          resolvedCount: summary?.resolvedCount ?? 0,
          addressedCount: summary?.addressedCount ?? 0,
        },
      };

      // Preserve agent state from previous refresh
      const prev = this.branches.get(pr.headRefName);
      if (prev?.agent) {
        branch.agent = prev.agent;
      }

      updated.set(pr.headRefName, branch);
    }

    this.branches = updated;
  }

  setRecentlyMerged(merged: MergedPR[]) {
    this._recentlyMerged = merged;
  }

  getState(): DashboardState {
    return {
      repo: this.repoInfo,
      branches: Array.from(this.branches.values()).sort(branchSort),
      recentlyMerged: this._recentlyMerged,
      lastUpdated: new Date().toISOString(),
    };
  }

  getBranch(name: string): Branch | undefined {
    return this.branches.get(name);
  }
}

function mapReviewDecision(
  decision?: string
): BranchPR["reviewState"] {
  switch (decision) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes_requested";
    case "REVIEW_REQUIRED":
      return "pending";
    default:
      return "none";
  }
}

function mapChecksState(
  checks?: GHPullRequest["statusCheckRollup"]
): BranchPR["checksState"] {
  if (!checks?.length) return "none";

  const hasFailure = checks.some(
    (c) => c.conclusion === "FAILURE" || c.conclusion === "ERROR" || c.state === "FAILURE" || c.state === "ERROR"
  );
  if (hasFailure) return "failure";

  const allSuccess = checks.every(
    (c) => c.conclusion === "SUCCESS" || c.state === "SUCCESS"
  );
  if (allSuccess) return "success";

  return "pending";
}

function branchSort(a: Branch, b: Branch): number {
  // Agent running first
  if (a.agent?.status === "running" && b.agent?.status !== "running") return -1;
  if (b.agent?.status === "running" && a.agent?.status !== "running") return 1;

  // HEAD branch first
  if (a.isHead && !b.isHead) return -1;
  if (b.isHead && !a.isHead) return 1;

  // Branches with PRs before those without
  if (a.pr && !b.pr) return -1;
  if (b.pr && !a.pr) return 1;

  // Alphabetical
  return a.name.localeCompare(b.name);
}
