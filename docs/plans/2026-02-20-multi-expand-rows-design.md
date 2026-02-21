# Multi-Expand Rows with Inline Content

## Problem

The TUI currently supports viewing only one branch's details at a time. A single `showDetail` boolean and `sessionIndex` number mean expanding one row closes any other. Comments, Claude activity, and logs are rendered in separate panels below the session list, disconnected from their rows.

## Design

### State Model

```typescript
// Removed
showDetail: boolean
showBranchLogs: boolean
branchLogOffset: number

// Changed
expandedBranches: Set<string>        // which rows are expanded (replaces showDetail)
sectionFocus: number | null          // 0=comments, 1=activity, 2=logs (null = row level)
drillIn: {                           // fullscreen overlay state
  branch: string
  section: "comments" | "activity" | "logs"
} | null
drillInOffset: number                // scroll position within drill-in view

// Unchanged
sessionIndex: number                 // cursor position (focused row)
focusedPane: "sessions" | "logs"     // tab toggle for global logs
```

### Navigation

Three depth levels, all driven by arrow keys:

| Level | Up/Down | Left/Right | Enter | Escape |
|-------|---------|------------|-------|--------|
| **Row** | Move cursor between rows | Right enters section focus (if expanded) | Toggle expand/collapse | — |
| **Section** | Move between Comments/Claude/Logs | Right or Enter = drill in. Left = back to row | Drill into fullscreen | Back to row level |
| **Drill-in** | Scroll content | Left = back to section level | — | Back to section level |

### Keyboard Shortcuts

```
s  start/stop       w  watch       r  retry
c  resume claude    e  open shell
q  quit             ?  help        t  theme    Tab  global logs
```

Removed: `j`/`k` (arrows replace), `l` (logs inline), `a`/`x` (toolbar only).

Swapped from previous: `w` = watch (was `e`), `e` = open shell (was `w`).

### Layout

Each row independently expands. Expanded content renders directly below its SessionRow:

```
▍ claude/fix-auth   #12  fixing...  3 comments
  ┌─ Comments (3) ──────────────────
  │ MUST FIX   auth.ts:42  @tony
  │            Missing null check
  │ SHOULD FIX api.ts:10   @tony
  │            Add retry logic
  ├─ Claude ─────────────────────────
  │ Reading auth.ts...
  │ Applying fix to line 42
  ├─ Logs ───────────────────────────
  │ 14:02 Fetching comments...
  │ 14:03 Categorized 3 comments
  └──────────────────────────────────
  claude/add-tests   #14  stopped    0 comments
```

Multiple rows can be expanded simultaneously. The session list area gets viewport scrolling to handle overflow.

### Fullscreen Drill-In

Pressing Enter (or Right) on a focused section takes over the full terminal height with scrollable read-only content for that section. Escape or Left returns to the section-level view.

### Component Changes

**Modified:**
- `App.tsx` — new state variables, rewritten input handler, remove standalone DetailPanel/ActivityPane/LogPane from render tree
- `SessionList.tsx` — renders expanded content inline after each row

**New:**
- `ExpandedContent.tsx` — stacked Comments + Claude + Logs sections for one branch, with section focus highlight
- `DrillInOverlay.tsx` — fullscreen scrollable view of a single section

**Removed from top-level render:**
- `DetailPanel` as standalone component (logic moves into ExpandedContent)
- `ActivityPane` as standalone component (logic moves into ExpandedContent)
- Branch `LogPane` as standalone component (logic moves into ExpandedContent)

### Scroll Management

When multiple rows are expanded, total content may exceed terminal height. The session list area tracks a `scrollOffset` and auto-scrolls to keep the cursor-focused row (or focused section) visible within the viewport.
