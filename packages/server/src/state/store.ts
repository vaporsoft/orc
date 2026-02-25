import type { Branch, BranchPR, DashboardState, GHPullRequest, RepoInfo } from "../types";
import type { LocalBranch } from "../git/branches";

export class BranchStore {
  private branches: Map<string, Branch> = new Map();
  private repoInfo: RepoInfo = {
    owner: "",
    repo: "",
    root: "",
    defaultBranch: "main",
  };

  setRepoInfo(info: RepoInfo) {
    this.repoInfo = info;
  }

  update(localBranches: LocalBranch[], prs: GHPullRequest[]) {
    const prMap = new Map<string, GHPullRequest>();
    for (const pr of prs) {
      prMap.set(pr.headRefName, pr);
    }

    const updated = new Map<string, Branch>();
    for (const local of localBranches) {
      const pr = prMap.get(local.name);
      const branch: Branch = {
        name: local.name,
        isHead: local.isHead,
        updatedAt: new Date().toISOString(),
      };

      if (pr) {
        branch.pr = {
          number: pr.number,
          title: pr.title,
          url: pr.url,
          reviewState: mapReviewDecision(pr.reviewDecision),
          checksState: mapChecksState(pr.statusCheckRollup),
          commentCount: pr.comments?.totalCount ?? 0,
        };
      }

      // Preserve agent state from previous refresh
      const prev = this.branches.get(local.name);
      if (prev?.agent) {
        branch.agent = prev.agent;
      }

      updated.set(local.name, branch);
    }

    this.branches = updated;
  }

  getState(): DashboardState {
    return {
      repo: this.repoInfo,
      branches: Array.from(this.branches.values()).sort(branchSort),
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
