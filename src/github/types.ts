/** Types representing GitHub GraphQL/REST API responses. */

export interface GHPullRequest {
  number: number;
  url: string;
  title: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  headRefName: string;
  baseRefName: string;
  headRefOid: string;
}

export interface GHReviewComment {
  id: string;
  databaseId: number;
  body: string;
  author: { login: string };
  path: string;
  line: number | null;
  diffHunk: string;
  createdAt: string;
}

export interface GHReviewThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  comments: {
    nodes: GHReviewComment[];
  };
}

export interface GHReviewThreadsResponse {
  data: {
    repository: {
      pullRequest: {
        reviewThreads: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: GHReviewThread[];
        };
      };
    };
  };
}

export interface GHCheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  app?: { slug: string };
}

export interface GHCheckRunsResponse {
  total_count: number;
  check_runs: GHCheckRun[];
}
