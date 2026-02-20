/** GraphQL queries and mutations for GitHub. */

export const REVIEW_THREADS_QUERY = `
query ReviewThreads($owner: String!, $repo: String!, $prNumber: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $prNumber) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          isResolved
          isOutdated
          comments(first: 100) {
            nodes {
              id
              databaseId
              body
              author {
                login
              }
              path
              line
              diffHunk
              createdAt
            }
          }
        }
      }
    }
  }
}
`;

export const RESOLVE_THREAD_MUTATION = `
mutation ResolveThread($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) {
    thread {
      id
      isResolved
    }
  }
}
`;

export const ADD_PR_COMMENT_MUTATION = `
mutation AddComment($subjectId: ID!, $body: String!) {
  addComment(input: { subjectId: $subjectId, body: $body }) {
    commentEdge {
      node {
        id
      }
    }
  }
}
`;

export const PR_QUERY = `
query PullRequest($owner: String!, $repo: String!, $prNumber: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $prNumber) {
      id
      number
      url
      title
      state
      headRefName
      baseRefName
      headRefOid
      author { login }
    }
  }
}
`;

export const MY_OPEN_PRS_QUERY = `
query MyOpenPRs($searchQuery: String!) {
  search(query: $searchQuery, type: ISSUE, first: 50) {
    nodes {
      ... on PullRequest {
        number
        url
        title
        state
        headRefName
        baseRefName
        headRefOid
        author { login }
      }
    }
  }
}
`;

export const PR_COMMENTS_QUERY = `
query PRComments($owner: String!, $repo: String!, $prNumber: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $prNumber) {
      comments(first: 100, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          databaseId
          body
          author {
            login
          }
          createdAt
        }
      }
    }
  }
}
`;

export const PR_FOR_BRANCH_QUERY = `
query PRForBranch($owner: String!, $repo: String!, $branch: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequests(headRefName: $branch, states: [OPEN], first: 1) {
      nodes {
        id
        number
        url
        title
        state
        headRefName
        baseRefName
        headRefOid
        author { login }
      }
    }
  }
}
`;
