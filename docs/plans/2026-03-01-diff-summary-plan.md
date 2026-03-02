# Diff Summary Per Branch — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show additions/deletions/changed files per PR in both the row list and detail panel.

**Architecture:** Extend `GHPullRequest` with three scalar fields (`additions`, `deletions`, `changedFiles`), add them to existing GraphQL queries, and render in both `SessionRow` and `DetailPanel`. A small `formatCompact` helper handles the `k` suffix formatting.

**Tech Stack:** TypeScript, Ink/React, GitHub GraphQL API

---

### Task 1: Add diff stat fields to GHPullRequest type

**Files:**
- Modify: `src/github/types.ts:3-36`

**Step 1: Add the three optional fields to the GHPullRequest interface**

In `src/github/types.ts`, add after the `headRefOid` field (line 11) and before `author`:

```typescript
  additions?: number;
  deletions?: number;
  changedFiles?: number;
```

**Step 2: Verify types compile**

Run: `yarn typecheck`
Expected: PASS (fields are optional, nothing references them yet)

**Step 3: Commit**

```bash
git add src/github/types.ts
git commit -m "feat: add additions/deletions/changedFiles to GHPullRequest type"
```

---

### Task 2: Add diff stat fields to GraphQL queries

**Files:**
- Modify: `src/github/queries.ts:93-258`

**Step 1: Add fields to MY_OPEN_PRS_QUERY**

In the `... on PullRequest` fragment (after `author { login }` on line 106), add:

```graphql
        additions
        deletions
        changedFiles
```

**Step 2: Add fields to BROWSE_OPEN_PRS_QUERY**

In the `nodes` block (after `author { login }` on line 179), add the same three fields:

```graphql
        additions
        deletions
        changedFiles
```

**Step 3: Add fields to SEARCH_OPEN_PRS_QUERY**

In the `... on PullRequest` fragment (after `author { login }` on line 228), add the same three fields:

```graphql
        additions
        deletions
        changedFiles
```

**Step 4: Verify types compile**

Run: `yarn typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add src/github/queries.ts
git commit -m "feat: fetch additions/deletions/changedFiles in PR GraphQL queries"
```

---

### Task 3: Add formatCompact number helper

**Files:**
- Create: `src/utils/format.ts`

**Step 1: Create the helper**

Create `src/utils/format.ts`:

```typescript
/** Format a number compactly: >= 1000 becomes "1.2k", etc. */
export function formatCompact(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return k >= 10 ? `${Math.round(k)}k` : `${k.toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(n);
}
```

**Step 2: Verify types compile**

Run: `yarn typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/utils/format.ts
git commit -m "feat: add formatCompact number helper for k-suffix formatting"
```

---

### Task 4: Add diff column to SessionRow

**Files:**
- Modify: `src/tui/components/SessionRow.tsx`

**Step 1: Add import**

Add to imports at top of file:

```typescript
import { formatCompact } from "../../utils/format.js";
```

**Step 2: Add diff stats comparison to arePropsEqual**

In the `arePropsEqual` function, add these checks (before the final `return` closing paren):

```typescript
    p.pr.additions === n.pr.additions &&
    p.pr.deletions === n.pr.deletions &&
    p.pr.changedFiles === n.pr.changedFiles &&
```

**Step 3: Add the diff column to the JSX**

Insert a new `<Box>` after the review column (after the `<Box width={8}>` with `review.symbol`, around line 106-108) and before the conflicts column:

```tsx
      <Box width={16}>
        {pr.additions != null && pr.deletions != null ? (
          <Text>
            <Text color="green">+{formatCompact(pr.additions)}</Text>
            <Text dimColor> </Text>
            <Text color="red">-{formatCompact(pr.deletions)}</Text>
            {pr.changedFiles != null && (
              <Text dimColor> ({pr.changedFiles})</Text>
            )}
          </Text>
        ) : (
          <Text color={theme.muted} dimColor={dimmed}>—</Text>
        )}
      </Box>
```

**Step 4: Verify types compile**

Run: `yarn typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tui/components/SessionRow.tsx
git commit -m "feat: add diff stats column to SessionRow"
```

---

### Task 5: Add diff column header to SessionList

**Files:**
- Modify: `src/tui/components/SessionList.tsx`

**Step 1: Add header column**

In the `columnHeaders` JSX, insert after the review header (`<Box width={8}><Text dimColor>review</Text></Box>`) and before the conflicts header:

```tsx
      <Box width={16}><Text dimColor>diff</Text></Box>
```

**Step 2: Verify types compile**

Run: `yarn typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/tui/components/SessionList.tsx
git commit -m "feat: add diff column header to SessionList"
```

---

### Task 6: Add diff stats to DetailPanel

**Files:**
- Modify: `src/tui/components/DetailPanel.tsx`

**Step 1: Add import**

Add to imports:

```typescript
import { formatCompact } from "../../utils/format.js";
```

**Step 2: Add diff stats line to the status summary in the expanded view**

In the expanded view's status summary `<Box>` (around line 526-545), add after the `base: {pr.baseRefName}` text and before the state/thread conditional block:

```tsx
          {pr.additions != null && pr.deletions != null && (
            <>
              <Text dimColor> · </Text>
              <Text color="green">+{formatCompact(pr.additions)}</Text>
              <Text dimColor> / </Text>
              <Text color="red">-{formatCompact(pr.deletions)}</Text>
              {pr.changedFiles != null && (
                <Text dimColor> ({pr.changedFiles} files)</Text>
              )}
            </>
          )}
```

**Step 3: Verify types compile**

Run: `yarn typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add src/tui/components/DetailPanel.tsx
git commit -m "feat: add diff stats to DetailPanel status summary"
```

---

### Task 7: Build and verify

**Step 1: Full build**

Run: `yarn build`
Expected: PASS with no errors

**Step 2: Lint**

Run: `yarn lint`
Expected: PASS

**Step 3: Final commit if any fixes needed**

If lint/build issues surfaced, fix and commit.
