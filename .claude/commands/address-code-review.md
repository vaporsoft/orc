# Address Code Review

Fetch and address code review comments on the current PR.

## Instructions

### Step 1: Identify the current PR

Run `gh pr view --json number,headRefName,url` to get the current PR. If no PR exists for the current branch, inform the user and exit.

### Step 2: Fetch all review comments (unresolved only)

Fetch comments using the GitHub CLI, and **only keep unresolved, current feedback**.

**Preferred: review threads via GraphQL** (captures Cursor/Bugbot threads and resolution state):

```bash
# Review threads with resolution + outdated info + thread IDs for replying later
# Paginate with `after` if hasNextPage is true

gh api graphql -f query='query($owner:String!, $repo:String!, $number:Int!, $after:String) { repository(owner:$owner, name:$repo) { pullRequest(number:$number) { reviewThreads(first:50, after:$after) { pageInfo { hasNextPage endCursor } nodes { id isResolved isOutdated path line originalLine comments(first:100) { nodes { id author { login } body createdAt } } } } } } }' -f owner=<OWNER> -f repo=<REPO> -F number=<PR_NUMBER>
```

**Important:** Save the thread `id` (the node ID on each `reviewThreads.nodes[]` entry) alongside each comment. This ID is needed in Step 9 to reply directly — no second GraphQL call required.

Filter rules:

- Only include threads where `isResolved` is `false`.
- Skip threads where `isOutdated` is `true`.
- Use the **latest comment** in each thread (`createdAt`).
- For Cursor/Bugbot, only keep the **latest comment per thread** (ignore older versions).

**Fallback: REST review comments** if GraphQL returns nothing:

```bash
gh api repos/{owner}/{repo}/pulls/{pr_number}/comments --paginate
```

If using the REST fallback, you must **also fetch thread IDs** via a separate GraphQL call so Step 9 can reply to threads:

```bash
# Paginate with `after` if hasNextPage is true
gh api graphql -f query='{ repository(owner:"<OWNER>", name:"<REPO>") { pullRequest(number:<PR_NUMBER>) { reviewThreads(first:100) { pageInfo { hasNextPage endCursor } nodes { id comments(first:100) { nodes { databaseId } } } } } } }'
```

Match each REST comment's `id` to **any** `databaseId` within a thread's `comments.nodes[]` to associate thread IDs. Fetching all comments (not just the first) ensures reply comments also match correctly.

**Always fetch review summaries and issue comments**:

```bash
# Review summaries with APPROVE/REQUEST_CHANGES/COMMENT
# Use the latest review per reviewer (humans only)
# Ignore older/dismissed reviews and approvals

gh api repos/{owner}/{repo}/pulls/{pr_number}/reviews --paginate

# PR issue comments (general conversation)
gh pr view {pr_number} --json comments
```

Always check **unresolved human reviews**: if a reviewer's latest review is `REQUEST_CHANGES` or `COMMENT`, include its summary comment even if there are no inline notes.

### Step 3: Categorize comments by severity

Analyze each **unresolved** comment and categorize into:

1. **Must fix** - Blocking issues that must be resolved before merge:
   - Comments from latest human reviews with `REQUEST_CHANGES`
   - Comments explicitly marked as blocking
   - Security issues, bugs, or correctness problems
   - Comments containing words like "blocking", "must", "required", "critical"

2. **Should fix** - Important but not blocking:
   - Suggestions for better patterns or approaches
   - Performance concerns
   - Comments with "should", "recommend", "consider"

3. **Nice to have** - Optional improvements:
   - Nits, style preferences
   - Comments starting with "nit:", "optional:", "minor:"
   - Suggestions that are clearly optional

If there are **no unresolved comments**, report that and exit.

### Step 4: Analyze each comment

For each categorized comment, build a rich analysis:

1. **Read the relevant code** — 3-5 lines around the comment location
2. **Assess a recommendation**: Fix, Push back, Defer, or Clarification needed — with a one-sentence justification
3. **Estimate effort**: trivial / moderate / involved
4. **Draft an action-led GitHub response** (see response templates below)

Response templates:

- **Fix:** `Fixed — {what changed}. {sha}` (sha filled in after commit)
- **Push back:** `Considered — {justification for keeping current approach}`
- **Defer:** `Deferred — created #{issue} to track this` (issue number filled in later)
- **Clarification needed:** `Clarification needed — {question back to reviewer}`

### Step 5: Present comments to the user

Display each comment as a **numbered section** with a metadata line, the comment summary, and arrow-prefixed detail lines. Group by severity with `---` separators between groups.

```
## PR #{number} Code Review Comments

### Must fix ({count})

**1.** src/api/users.ts:45 · @reviewer · Fix · trivial
Use batched query instead of N+1
→ Plan: Refactor to single WHERE IN query
→ Response: Fixed — batched the member lookup into a single query

**2.** Review summary · @reviewer · Push back
Should use Redis for caching
→ Justification: In-memory cache is sufficient at our scale;
  Redis adds operational complexity with no measurable benefit yet.
→ Response: Considered — keeping in-memory cache for now. At current
  scale (~100 orgs), memory footprint is negligible and avoids a new
  infrastructure dependency. Happy to revisit if we see cache pressure.

---

### Should fix ({count})

**3.** src/utils/format.ts:12 · @reviewer · Fix · moderate
Extract into shared utility
→ Plan: Move to banana-peel-utils, update imports
→ Response: Fixed — extracted to formatSlug() in banana-peel-utils

---

### Nice to have ({count})

**4.** src/components/Card.tsx:8 · @reviewer · Defer · trivial
nit: prefer size-4 over w-4 h-4
→ Justification: Valid nit but not worth a fixup commit in this PR
→ Response: Deferred — will create issue to clean up icon sizing
```

Metadata line format: `**{#}.** {location} · @{author} · {recommendation} · {effort}`
- Omit effort for Push back items (use `· Push back` without trailing effort)

Detail line guidelines (prefixed with `→`):
- **Fix** items: `Plan: {what will change}` + `Response: {draft}`
- **Push back** items: `Justification: {why we disagree}` + `Response: {full draft}`
- **Defer** items: `Justification: {why not now}` + `Response: {draft}`
- **Clarification needed**: `Question: {what's unclear}` + `Response: {draft asking reviewer}`

Use the AskUserQuestion tool to ask which items to address. Pre-select the recommendation. Provide options like:

- "All recommended" - Fix items marked Fix, push back/defer the rest (Recommended)
- "All items as Fix" - Address everything as fixes
- "Must fix only" - Only blocking issues
- "Must fix + Should fix" - Skip nice-to-haves

### Step 6: Address selected items

For each item the user wants to fix:

1. Read the relevant file(s) and understand the context
2. Implement the fix following the project's code style
3. Use fixup commits when the fix belongs to an existing commit in the PR:
   - Run `git log main..HEAD --oneline` to find the relevant commit
   - Use `git commit --fixup {sha}` for the fix
   - After all fixes are committed, squash fixups with `GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash main`
4. If a fix requires substantial new work, create a regular commit

### Step 7: Verify lint and typecheck pass

Before pushing, ensure the code passes all checks:

```bash
yarn lint
yarn typecheck
```

If either fails:

1. Fix the issues
2. Create additional fixup commits as needed
3. Squash with `GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash main`
4. Re-run both commands to confirm they pass

Do not push until both `yarn lint` and `yarn typecheck` complete without errors.

### Step 8: Handle deferred items

For items the user wants to defer (e.g., "create an issue for 4"):

1. Create a GitHub issue using `gh issue create`:

   ```bash
   gh issue create --title "{brief description}" --body "From PR #{pr_number} code review:

   **Original comment by @{author}:**
   > {full_comment}

   **File:** {file}:{line}
   **Context:** {brief context about what was being discussed}

   ---
   Discovered during code review of #{pr_number}"
   ```

2. Note the issue number — fill it into the drafted response for this item

### Step 9: Push changes and respond

1. Push the changes:

   ```bash
   git push origin {branch_name}
   ```

2. Reply to each addressed comment using the **thread ID saved from Step 2** and the drafted response (updated with commit SHA / issue number as needed):

   ```bash
   gh api graphql \
     -f query='mutation($threadId: ID!, $body: String!) { addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $threadId, body: $body}) { comment { id } } }' \
     -f threadId="<THREAD_ID>" \
     -f body="<RESPONSE>"
   ```

   **Shell interpolation warning:** The `gh api graphql` `-f` flag safely passes variables without shell mangling. Do NOT inline values directly into the query string — response bodies contain quotes, newlines, and special characters that will break the query. The `-f key=value` flags handle escaping correctly.

   **Known caveat:** In some shell environments, GraphQL `$variable` syntax (e.g. `$threadId`) can be interpreted by the shell. If you get `Expected VAR_SIGN, actual: UNKNOWN_CHAR` errors, either single-quote the entire `-f query='...'` argument (so the shell doesn't touch `$`), or fall back to inlining values for simple strings like thread IDs while keeping the body in a `-f` flag:

   ```bash
   gh api graphql \
     -f query='mutation($body: String!) { addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: "<THREAD_ID>", body: $body}) { comment { id } } }' \
     -f body="<RESPONSE>"
   ```

   Response examples:
   - `Fixed — batched the member lookup into a single query. abc1234`
   - `Considered — keeping in-memory cache for now. At current scale (~100 orgs), memory footprint is negligible and avoids a new infrastructure dependency. Happy to revisit if we see cache pressure.`
   - `Deferred — created #42 to track this`
   - `Clarification needed — are you suggesting we move this to a shared util, or keep it local but rename?`

3. After replying to a thread with a "Fixed" response, **resolve the thread** so re-runs don't double-reply:

   ```bash
   gh api graphql \
     -f query='mutation { resolveReviewThread(input: {threadId: "<THREAD_ID>"}) { thread { isResolved } } }'
   ```

   Only resolve threads where the action was **Fix**. Do not resolve threads for Push back, Defer, or Clarification needed — those should remain open for the reviewer to respond.

### Step 10: Re-request review

Identify unique reviewers who left comments and re-request their review:

```bash
gh pr edit {pr_number} --add-reviewer {reviewer1},{reviewer2}
```

### Step 11: Summary

Provide a summary to the user:

```
Done! Here's what I did:

**Fixed:**
- {description of fix 1} (fixup -> commit {sha})
- {description of fix 2} (new commit {sha})

**Pushed back:**
- {description}: {brief justification}

**Deferred:**
- Created #{issue_number}: {issue title}

**Responded to {n} comments**

Pushed to origin/{branch_name}
Re-requested review from @{reviewer1}, @{reviewer2}

Ready for re-review!
```

## Error handling

- If `gh` commands fail, check authentication with `gh auth status`
- If there are merge conflicts after fixes, inform the user and offer to help resolve
- If a comment references code that no longer exists, note this in the response
- If unsure how to fix an item, ask the user for guidance before proceeding
