# Multi-Expand Rows Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow multiple TUI rows to expand simultaneously with inline comments/activity/logs, arrow-key navigation at three depth levels, and fullscreen drill-in.

**Architecture:** Replace the single-selection detail panel with per-row inline expansion. State moves from `showDetail: boolean` to `expandedBranches: Set<string>`. New `ExpandedContent` component renders beneath each expanded row. New `DrillInOverlay` renders fullscreen when drilling into a section. Input handler rewritten with three-level depth model (row → section → drill-in).

**Tech Stack:** React 18, Ink 5 (terminal React renderer), TypeScript

**Design doc:** `docs/plans/2026-02-20-multi-expand-rows-design.md`

---

### Task 1: Create ExpandedContent component

This is the core new component — renders comments, activity, and logs stacked vertically beneath a row.

**Files:**
- Create: `src/tui/components/ExpandedContent.tsx`

**Step 1: Create the component file**

```tsx
import React from "react";
import { Box, Text } from "ink";
import type { PREntry } from "../hooks/useDaemonState.js";
import type { LogEntry } from "../../utils/logger.js";
import type { CommentCategory } from "../../types/index.js";
import { useTheme } from "../theme.js";

const SECTION_NAMES = ["Comments", "Claude", "Logs"] as const;
type SectionName = (typeof SECTION_NAMES)[number];

const CATEGORY_COLORS: Record<CommentCategory, string> = {
  must_fix: "red",
  should_fix: "yellow",
  nice_to_have: "cyan",
  false_positive: "gray",
  verify_and_fix: "magenta",
};

const CATEGORY_LABELS: Record<CommentCategory, string> = {
  must_fix: "MUST FIX",
  should_fix: "SHOULD FIX",
  nice_to_have: "NICE",
  false_positive: "FALSE POS",
  verify_and_fix: "VERIFY",
};

interface ExpandedContentProps {
  entry: PREntry;
  branchLogs: LogEntry[];
  focusedSection: number | null; // 0=comments, 1=activity, 2=logs; null = no focus
}

function SectionHeader({
  label,
  focused,
  accentColor,
  borderColor,
}: {
  label: string;
  focused: boolean;
  accentColor: string;
  borderColor: string;
}) {
  const rule = "─".repeat(Math.max(0, 44 - label.length));
  return (
    <Box>
      <Text color={focused ? accentColor : borderColor}>
        {focused ? "▸ " : "  "}
      </Text>
      <Text color={focused ? accentColor : borderColor} dimColor={!focused}>
        {"━━ "}
      </Text>
      <Text color={focused ? accentColor : borderColor} bold>
        {label}
      </Text>
      <Text color={focused ? accentColor : borderColor} dimColor={!focused}>
        {" " + rule}
      </Text>
    </Box>
  );
}

function CommentsSection({ entry }: { entry: PREntry }) {
  const theme = useTheme();
  const { state, commentThreads } = entry;
  const summary = state?.commentSummary ?? null;

  if (summary && summary.comments.length > 0) {
    return (
      <>
        {summary.comments.map((c) => {
          const loc = c.line ? `${c.path}:${c.line}` : c.path;
          const body = c.body.replace(/\n/g, " ");
          const truncated =
            body.length > 90 ? body.slice(0, 89) + "…" : body;
          return (
            <Box key={c.threadId} marginLeft={4} flexDirection="column">
              <Text>
                <Text color={CATEGORY_COLORS[c.category]} bold>
                  {CATEGORY_LABELS[c.category].padEnd(11)}
                </Text>
                <Text color={theme.text}>{loc}</Text>
                <Text dimColor>  @{c.author}</Text>
              </Text>
              <Text dimColor>{"           "}{truncated}</Text>
            </Box>
          );
        })}
      </>
    );
  }

  if (commentThreads.length > 0) {
    return (
      <>
        {commentThreads.map((t) => {
          const loc = t.line ? `${t.path}:${t.line}` : t.path;
          const body = t.body.replace(/\n/g, " ");
          const truncated =
            body.length > 90 ? body.slice(0, 89) + "…" : body;
          return (
            <Box key={t.threadId} marginLeft={4} flexDirection="column">
              <Text>
                <Text color={theme.text}>{loc}</Text>
                <Text dimColor>  @{t.author}</Text>
              </Text>
              <Text dimColor>{"    "}{truncated}</Text>
            </Box>
          );
        })}
      </>
    );
  }

  return (
    <Box marginLeft={4}>
      <Text dimColor>No comments</Text>
    </Box>
  );
}

function ActivitySection({ entry }: { entry: PREntry }) {
  const theme = useTheme();
  const lines = entry.state?.claudeActivity ?? [];

  if (lines.length === 0) {
    return (
      <Box marginLeft={4}>
        <Text dimColor>No activity</Text>
      </Box>
    );
  }

  return (
    <>
      {lines.map((line, i) => (
        <Box key={i} marginLeft={4}>
          <Text
            dimColor={i < lines.length - 1}
            color={i === lines.length - 1 ? theme.text : undefined}
          >
            {line}
          </Text>
        </Box>
      ))}
    </>
  );
}

function LogsSection({ logs }: { logs: LogEntry[] }) {
  const theme = useTheme();

  if (logs.length === 0) {
    return (
      <Box marginLeft={4}>
        <Text dimColor>No log entries</Text>
      </Box>
    );
  }

  const LEVEL_SYMBOLS: Record<string, string> = {
    debug: "·",
    info: "│",
    warn: "▪",
    error: "✗",
  };

  // Show last 10 entries inline (drill-in shows all)
  const visible = logs.slice(-10);

  return (
    <>
      {visible.map((entry, i) => {
        const time = entry.timestamp.split("T")[1]?.slice(0, 8) ?? "";
        const sym = LEVEL_SYMBOLS[entry.level] ?? "│";
        return (
          <Box key={i} marginLeft={4}>
            <Text dimColor>{time} </Text>
            <Text
              color={
                entry.level === "error"
                  ? theme.error
                  : entry.level === "warn"
                    ? theme.warning
                    : theme.text
              }
            >
              {sym} {entry.message}
            </Text>
          </Box>
        );
      })}
      {logs.length > 10 && (
        <Box marginLeft={4}>
          <Text dimColor>  … {logs.length - 10} more (enter to view all)</Text>
        </Box>
      )}
    </>
  );
}

export function ExpandedContent({
  entry,
  branchLogs,
  focusedSection,
}: ExpandedContentProps) {
  const theme = useTheme();
  const { state, commentCount, commentThreads } = entry;
  const summary = state?.commentSummary ?? null;
  const commentTotal =
    summary?.comments.length ?? commentThreads.length ?? commentCount;
  const activityLines = state?.claudeActivity ?? [];

  return (
    <Box flexDirection="column" paddingLeft={2}>
      {/* Error banner */}
      {state?.error && (
        <Box marginLeft={2}>
          <Text color={theme.error} bold>{"✗ "}</Text>
          <Text color={theme.error}>{state.error}</Text>
        </Box>
      )}

      {/* Comments section */}
      <SectionHeader
        label={`Comments (${commentTotal})`}
        focused={focusedSection === 0}
        accentColor={theme.accent}
        borderColor={theme.border}
      />
      <CommentsSection entry={entry} />

      {/* Activity section */}
      <SectionHeader
        label={`Claude (${activityLines.length})`}
        focused={focusedSection === 1}
        accentColor={theme.accent}
        borderColor={theme.border}
      />
      <ActivitySection entry={entry} />

      {/* Logs section */}
      <SectionHeader
        label={`Logs (${branchLogs.length})`}
        focused={focusedSection === 2}
        accentColor={theme.accent}
        borderColor={theme.border}
      />
      <LogsSection logs={branchLogs} />
    </Box>
  );
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/tui/components/ExpandedContent.tsx
git commit -m "feat: add ExpandedContent component for inline row expansion"
```

---

### Task 2: Create DrillInOverlay component

Fullscreen overlay that renders one section's content with scroll support.

**Files:**
- Create: `src/tui/components/DrillInOverlay.tsx`

**Step 1: Create the component file**

```tsx
import React from "react";
import { Box, Text } from "ink";
import type { PREntry } from "../hooks/useDaemonState.js";
import type { LogEntry } from "../../utils/logger.js";
import type { CommentCategory } from "../../types/index.js";
import { useTheme } from "../theme.js";

type DrillSection = "comments" | "activity" | "logs";

const CATEGORY_COLORS: Record<CommentCategory, string> = {
  must_fix: "red",
  should_fix: "yellow",
  nice_to_have: "cyan",
  false_positive: "gray",
  verify_and_fix: "magenta",
};

const CATEGORY_LABELS: Record<CommentCategory, string> = {
  must_fix: "MUST FIX",
  should_fix: "SHOULD FIX",
  nice_to_have: "NICE",
  false_positive: "FALSE POS",
  verify_and_fix: "VERIFY",
};

interface DrillInOverlayProps {
  entry: PREntry;
  branchLogs: LogEntry[];
  section: DrillSection;
  scrollOffset: number;
  visibleLines: number;
}

function renderCommentLines(entry: PREntry, theme: ReturnType<typeof useTheme>): React.ReactNode[] {
  const { state, commentThreads } = entry;
  const summary = state?.commentSummary ?? null;
  const lines: React.ReactNode[] = [];

  if (summary && summary.comments.length > 0) {
    for (const c of summary.comments) {
      const loc = c.line ? `${c.path}:${c.line}` : c.path;
      const body = c.body.replace(/\n/g, " ");
      lines.push(
        <Box key={c.threadId} flexDirection="column" marginLeft={2}>
          <Text>
            <Text color={CATEGORY_COLORS[c.category]} bold>
              {CATEGORY_LABELS[c.category].padEnd(11)}
            </Text>
            <Text color={theme.text}>{loc}</Text>
            <Text dimColor>  @{c.author}</Text>
          </Text>
          <Text dimColor>{"           "}{body}</Text>
          <Text> </Text>
        </Box>,
      );
    }
  } else if (commentThreads.length > 0) {
    for (const t of commentThreads) {
      const loc = t.line ? `${t.path}:${t.line}` : t.path;
      const body = t.body.replace(/\n/g, " ");
      lines.push(
        <Box key={t.threadId} flexDirection="column" marginLeft={2}>
          <Text>
            <Text color={theme.text}>{loc}</Text>
            <Text dimColor>  @{t.author}</Text>
          </Text>
          <Text dimColor>{"  "}{body}</Text>
          <Text> </Text>
        </Box>,
      );
    }
  } else {
    lines.push(
      <Box key="none" marginLeft={2}>
        <Text dimColor>No comments</Text>
      </Box>,
    );
  }

  return lines;
}

function renderActivityLines(entry: PREntry, theme: ReturnType<typeof useTheme>): React.ReactNode[] {
  const activityLines = entry.state?.claudeActivity ?? [];
  if (activityLines.length === 0) {
    return [
      <Box key="none" marginLeft={2}>
        <Text dimColor>No activity</Text>
      </Box>,
    ];
  }
  return activityLines.map((line, i) => (
    <Box key={i} marginLeft={2}>
      <Text color={theme.text}>{line}</Text>
    </Box>
  ));
}

function renderLogLines(logs: LogEntry[], theme: ReturnType<typeof useTheme>): React.ReactNode[] {
  const LEVEL_SYMBOLS: Record<string, string> = {
    debug: "·",
    info: "│",
    warn: "▪",
    error: "✗",
  };

  if (logs.length === 0) {
    return [
      <Box key="none" marginLeft={2}>
        <Text dimColor>No log entries</Text>
      </Box>,
    ];
  }

  return logs.map((entry, i) => {
    const time = entry.timestamp.split("T")[1]?.slice(0, 8) ?? "";
    const sym = LEVEL_SYMBOLS[entry.level] ?? "│";
    return (
      <Box key={i} marginLeft={2}>
        <Text dimColor>{time} </Text>
        <Text
          color={
            entry.level === "error"
              ? theme.error
              : entry.level === "warn"
                ? theme.warning
                : theme.text
          }
        >
          {sym} {entry.message}
        </Text>
      </Box>
    );
  });
}

const SECTION_TITLES: Record<DrillSection, string> = {
  comments: "Comments",
  activity: "Claude Activity",
  logs: "Logs",
};

export function DrillInOverlay({
  entry,
  branchLogs,
  section,
  scrollOffset,
  visibleLines,
}: DrillInOverlayProps) {
  const theme = useTheme();

  let allLines: React.ReactNode[];
  switch (section) {
    case "comments":
      allLines = renderCommentLines(entry, theme);
      break;
    case "activity":
      allLines = renderActivityLines(entry, theme);
      break;
    case "logs":
      allLines = renderLogLines(branchLogs, theme);
      break;
  }

  const maxOffset = Math.max(0, allLines.length - visibleLines);
  const offset = Math.min(scrollOffset, maxOffset);
  const visible = allLines.slice(offset, offset + visibleLines);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.accent}
      height={visibleLines + 4}
    >
      <Box paddingX={1} justifyContent="space-between">
        <Text>
          <Text color={theme.accent} bold>
            {SECTION_TITLES[section]}
          </Text>
          <Text dimColor> — {entry.branch} #{entry.pr.number}</Text>
        </Text>
        <Text dimColor>
          {allLines.length > 0
            ? `${offset + 1}–${Math.min(offset + visibleLines, allLines.length)} of ${allLines.length}`
            : "empty"}
          {" · esc to close"}
        </Text>
      </Box>
      <Box flexDirection="column" paddingX={1}>
        {visible}
      </Box>
    </Box>
  );
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/tui/components/DrillInOverlay.tsx
git commit -m "feat: add DrillInOverlay component for fullscreen section view"
```

---

### Task 3: Update useBranchLogs to support multiple branches

Currently the hook takes a single `branch: string | null` and returns logs for that branch. We need logs for ALL expanded branches simultaneously.

**Files:**
- Modify: `src/tui/hooks/useBranchLogs.ts`

**Step 1: Change the hook to return the full Map instead of filtering by branch**

The hook already stores all branch logs internally in a `Map<string, LogEntry[]>`. Change the return type to expose the whole map, and rename the hook to `useAllBranchLogs`.

```typescript
import { useState, useEffect, useRef } from "react";
import { logger, type LogEntry } from "../../utils/logger.js";

const MAX_PER_BRANCH = 200;
const THROTTLE_MS = 150;

/**
 * Buffers log entries keyed by branch name.
 * Returns the full map so callers can look up any branch.
 */
export function useAllBranchLogs(): Map<string, LogEntry[]> {
  const [logs, setLogs] = useState<Map<string, LogEntry[]>>(new Map());
  const bufferRef = useRef<LogEntry[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const flush = () => {
      timerRef.current = null;
      if (bufferRef.current.length === 0) return;
      const batch = bufferRef.current;
      bufferRef.current = [];
      setLogs((prev) => {
        const next = new Map(prev);
        for (const entry of batch) {
          if (!entry.branch) continue;
          const existing = next.get(entry.branch) ?? [];
          existing.push(entry);
          if (existing.length > MAX_PER_BRANCH) {
            next.set(entry.branch, existing.slice(existing.length - MAX_PER_BRANCH));
          } else {
            next.set(entry.branch, existing);
          }
        }
        return next;
      });
    };

    const onLog = (entry: LogEntry) => {
      if (!entry.branch) return;
      bufferRef.current.push(entry);
      if (!timerRef.current) {
        timerRef.current = setTimeout(flush, THROTTLE_MS);
      }
    };

    logger.on("log", onLog);
    return () => {
      logger.off("log", onLog);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return logs;
}

/**
 * Convenience wrapper: returns logs for a single branch.
 * Kept for backward compatibility if needed.
 */
export function useBranchLogs(branch: string | null): LogEntry[] {
  const allLogs = useAllBranchLogs();
  if (!branch) return [];
  return allLogs.get(branch) ?? [];
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors (old callers still work via `useBranchLogs`)

**Step 3: Commit**

```bash
git add src/tui/hooks/useBranchLogs.ts
git commit -m "refactor: expose useAllBranchLogs for multi-branch log access"
```

---

### Task 4: Update SessionList to render inline expanded content

SessionList currently renders a flat list of `SessionRow` components. Update it to render `ExpandedContent` beneath each expanded row.

**Files:**
- Modify: `src/tui/components/SessionList.tsx`

**Step 1: Rewrite SessionList**

```tsx
import React from "react";
import { Box, Text } from "ink";
import type { PREntry } from "../hooks/useDaemonState.js";
import type { LogEntry } from "../../utils/logger.js";
import { SessionRow } from "./SessionRow.js";
import { ExpandedContent } from "./ExpandedContent.js";
import { useTheme } from "../theme.js";

interface SessionListProps {
  entries: Map<string, PREntry>;
  selectedIndex: number;
  focused: boolean;
  expandedBranches: Set<string>;
  focusedSection: number | null; // only applies to the selected+expanded row
  allBranchLogs: Map<string, LogEntry[]>;
}

export function SessionList({
  entries,
  selectedIndex,
  focused,
  expandedBranches,
  focusedSection,
  allBranchLogs,
}: SessionListProps) {
  const theme = useTheme();
  const branches = [...entries.keys()].sort();

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.border}
      borderTop={false}
      borderBottom={false}
    >
      {/* Column headers */}
      <Box paddingX={1}>
        <Box width={2}><Text> </Text></Box>
        <Box width={28}><Text dimColor>branch</Text></Box>
        <Box width={8}><Text dimColor>pr</Text></Box>
        <Box width={16}><Text dimColor>status</Text></Box>
        <Box width={10}><Text dimColor>comments</Text></Box>
        <Box width={8}><Text dimColor>fixed</Text></Box>
        <Box width={10}><Text dimColor>cost</Text></Box>
        <Box width={10}><Text dimColor>last push</Text></Box>
      </Box>
      {branches.length === 0 ? (
        <Box paddingX={1}>
          <Text dimColor>  Discovering PRs...</Text>
        </Box>
      ) : (
        branches.map((branch, i) => {
          const entry = entries.get(branch)!;
          const isSelected = focused && i === selectedIndex;
          const isExpanded = expandedBranches.has(branch);
          return (
            <React.Fragment key={branch}>
              <SessionRow entry={entry} selected={isSelected} />
              {isExpanded && (
                <ExpandedContent
                  entry={entry}
                  branchLogs={allBranchLogs.get(branch) ?? []}
                  focusedSection={isSelected ? focusedSection : null}
                />
              )}
            </React.Fragment>
          );
        })
      )}
    </Box>
  );
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: Errors in App.tsx (missing new props) — that's fine, we fix App.tsx next.

**Step 3: Commit**

```bash
git add src/tui/components/SessionList.tsx
git commit -m "feat: render inline expanded content in SessionList"
```

---

### Task 5: Rewrite App.tsx state and input handler

This is the biggest change. Replace old state, rewrite the input handler for three-level navigation, swap keyboard shortcuts (w/e), remove standalone detail/activity/log panels, wire up new components.

**Files:**
- Modify: `src/tui/App.tsx`

**Step 1: Rewrite App.tsx**

```tsx
import React, { useState, useCallback } from "react";
import { Box, useApp, useInput, useStdin, useStdout } from "ink";
import type { Daemon } from "../core/daemon.js";
import { openTerminal } from "../utils/open-terminal.js";
import { logger } from "../utils/logger.js";
import { useDaemonState } from "./hooks/useDaemonState.js";
import { useLogBuffer } from "./hooks/useLogBuffer.js";
import { useAllBranchLogs } from "./hooks/useBranchLogs.js";
import { Header } from "./components/Header.js";
import type { ToolbarButton } from "./components/Toolbar.js";
import { SessionList } from "./components/SessionList.js";
import { DrillInOverlay } from "./components/DrillInOverlay.js";
import { LogPane } from "./components/LogPane.js";
import { HelpBar } from "./components/HelpBar.js";
import { useThemeContext } from "./theme.js";

type Pane = "sessions" | "logs";
type DrillSection = "comments" | "activity" | "logs";

interface DrillInState {
  branch: string;
  section: DrillSection;
}

interface AppProps {
  daemon: Daemon;
  startTime: number;
}

export function App({ daemon, startTime }: AppProps) {
  const { theme, toggleTheme } = useThemeContext();
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { isRawModeSupported } = useStdin();
  const entries = useDaemonState(daemon);
  const { entries: logEntries, lastTimestamp } = useLogBuffer();
  const allBranchLogs = useAllBranchLogs();

  const [focusedPane, setFocusedPane] = useState<Pane>("sessions");
  const [sessionIndex, setSessionIndex] = useState(0);
  const [logOffset, setLogOffset] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const [toolbarIndex, setToolbarIndex] = useState(-1);

  // Multi-expand state
  const [expandedBranches, setExpandedBranches] = useState<Set<string>>(new Set());
  const [sectionFocus, setSectionFocus] = useState<number | null>(null);
  const [drillIn, setDrillIn] = useState<DrillInState | null>(null);
  const [drillInOffset, setDrillInOffset] = useState(0);

  const termHeight = stdout?.rows ?? 24;
  const logVisibleLines = Math.max(3, termHeight - 12);
  const showLogs = focusedPane === "logs";

  const entryCount = entries.size;
  const branches = [...entries.keys()].sort();
  const selectedBranch = branches[sessionIndex] ?? null;

  const DRILL_SECTIONS: DrillSection[] = ["comments", "activity", "logs"];

  const toolbarButtons: ToolbarButton[] = [
    { label: "Start All", action: () => daemon.startAll("once").catch((err) => logger.error(`startAll failed: ${err}`)) },
    { label: "Watch All", action: () => daemon.watchAll().catch((err) => logger.error(`watchAll failed: ${err}`)) },
    { label: "Stop All", action: () => daemon.stopAll().catch((err) => logger.error(`stopAll failed: ${err}`)) },
    { label: "Refresh", action: () => daemon.refreshNow().catch((err) => logger.error(`refresh failed: ${err}`)) },
  ];

  const onQuit = useCallback(() => {
    exit();
  }, [exit]);

  useInput((input, key) => {
    // === Global keys (work at any depth) ===
    if (input === "q") {
      onQuit();
      return;
    }
    if (input === "?") {
      setShowHelp((v) => !v);
      return;
    }
    if (input === "t") {
      toggleTheme();
      return;
    }

    // === Drill-in level ===
    if (drillIn) {
      if (key.escape || key.leftArrow) {
        setDrillIn(null);
        setDrillInOffset(0);
        return;
      }
      if (key.upArrow) {
        setDrillInOffset((prev) => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        setDrillInOffset((prev) => prev + 1);
        return;
      }
      return; // Consume all other input when drilled in
    }

    // === Tab toggles global log pane ===
    if (key.tab) {
      setFocusedPane((prev) => (prev === "sessions" ? "logs" : "sessions"));
      return;
    }

    // === Global log pane navigation ===
    if (focusedPane === "logs") {
      if (key.upArrow) {
        setLogOffset((prev) => Math.min(prev + 1, Math.max(0, logEntries.length - logVisibleLines)));
      } else if (key.downArrow) {
        setLogOffset((prev) => Math.max(0, prev - 1));
      }
      return;
    }

    // === Toolbar navigation ===
    if (toolbarIndex >= 0) {
      if ((key.return || input === "\n")) {
        toolbarButtons[toolbarIndex]?.action();
        return;
      }
      if (key.escape) {
        setToolbarIndex(-1);
        return;
      }
      if (key.leftArrow) {
        setToolbarIndex((prev) => Math.max(0, prev - 1));
        return;
      }
      if (key.rightArrow) {
        setToolbarIndex((prev) => Math.min(toolbarButtons.length - 1, prev + 1));
        return;
      }
      if (key.downArrow) {
        setToolbarIndex(-1);
        return;
      }
      return;
    }

    // === Section focus level ===
    if (sectionFocus !== null) {
      if (key.escape || key.leftArrow) {
        setSectionFocus(null);
        return;
      }
      if (key.upArrow) {
        setSectionFocus((prev) => Math.max(0, (prev ?? 0) - 1));
        return;
      }
      if (key.downArrow) {
        setSectionFocus((prev) => Math.min(2, (prev ?? 0) + 1));
        return;
      }
      if ((key.return || input === "\n" || key.rightArrow) && selectedBranch) {
        setDrillIn({ branch: selectedBranch, section: DRILL_SECTIONS[sectionFocus] });
        setDrillInOffset(0);
        return;
      }
      return; // Consume other input in section focus mode
    }

    // === Row level: sessions pane ===

    // Action keys
    if (input === "s") {
      const branch = branches[sessionIndex];
      if (branch) {
        if (daemon.isRunning(branch)) {
          daemon.stopBranch(branch).catch(() => {});
        } else {
          daemon.startBranch(branch, "once").catch(() => {});
        }
      }
      return;
    }

    if (input === "w") {
      const branch = branches[sessionIndex];
      if (branch && !daemon.isRunning(branch)) {
        daemon.watchBranch(branch).catch(() => {});
      }
      return;
    }

    if (input === "r") {
      const branch = branches[sessionIndex];
      if (branch && !daemon.isRunning(branch)) {
        daemon.startBranch(branch).catch(() => {});
      }
      return;
    }

    if (input === "c") {
      const branch = branches[sessionIndex];
      const entry = branch ? entries.get(branch) : undefined;
      const st = entry?.state;
      if (st?.lastSessionId && st.workDir) {
        openTerminal(`cd '${st.workDir}' && claude --resume ${st.lastSessionId}`);
        logger.info(`Resuming Claude session ${st.lastSessionId}`, branch);
      } else {
        logger.warn("No Claude session to resume for this branch", branch);
      }
      return;
    }

    if (input === "e") {
      const branch = branches[sessionIndex];
      const entry = branch ? entries.get(branch) : undefined;
      const st = entry?.state;
      if (st?.workDir) {
        openTerminal(`cd '${st.workDir}'`);
        logger.info(`Opening shell at ${st.workDir}`, branch);
      } else {
        logger.warn("No worktree directory for this branch", branch);
      }
      return;
    }

    // Enter toggles expand/collapse
    if (key.return || input === "\n") {
      if (selectedBranch) {
        setExpandedBranches((prev) => {
          const next = new Set(prev);
          if (next.has(selectedBranch)) {
            next.delete(selectedBranch);
            setSectionFocus(null);
          } else {
            next.add(selectedBranch);
          }
          return next;
        });
      }
      return;
    }

    // Right arrow enters section focus if current row is expanded
    if (key.rightArrow) {
      if (selectedBranch && expandedBranches.has(selectedBranch)) {
        setSectionFocus(0);
      }
      return;
    }

    // Up/Down arrows navigate rows
    if (key.upArrow) {
      if (sessionIndex === 0) {
        setToolbarIndex(0);
      } else {
        setSessionIndex((prev) => prev - 1);
        setSectionFocus(null);
      }
      return;
    }
    if (key.downArrow) {
      setSessionIndex((prev) => Math.min(entryCount - 1, prev + 1));
      setSectionFocus(null);
      return;
    }
  }, { isActive: isRawModeSupported });

  // Find entry for drill-in
  const drillInEntry = drillIn ? entries.get(drillIn.branch) : undefined;

  return (
    <Box flexDirection="column" height={termHeight}>
      {drillIn && drillInEntry ? (
        <DrillInOverlay
          entry={drillInEntry}
          branchLogs={allBranchLogs.get(drillIn.branch) ?? []}
          section={drillIn.section}
          scrollOffset={drillInOffset}
          visibleLines={termHeight - 4}
        />
      ) : (
        <>
          <Header entries={entries} startTime={startTime} lastCheck={lastTimestamp} buttons={toolbarButtons} selectedButton={toolbarIndex} />
          <SessionList
            entries={entries}
            selectedIndex={sessionIndex}
            focused={focusedPane === "sessions" && toolbarIndex < 0}
            expandedBranches={expandedBranches}
            focusedSection={sectionFocus}
            allBranchLogs={allBranchLogs}
          />
          {showLogs && (
            <LogPane
              entries={logEntries}
              focused={focusedPane === "logs"}
              scrollOffset={logOffset}
              visibleLines={logVisibleLines}
              label="All Logs"
            />
          )}
          <Box
            flexGrow={1}
            borderStyle="round"
            borderColor={theme.border}
            borderTop={false}
            borderBottom={false}
          />
          <HelpBar showingLogs={showLogs} expanded={showHelp} />
        </>
      )}
    </Box>
  );
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/tui/App.tsx
git commit -m "feat: rewrite App with multi-expand state and three-level navigation"
```

---

### Task 6: Update HelpBar with new keybindings

Reflect the new shortcuts: arrows instead of j/k, w=watch, e=shell, remove l/a/x.

**Files:**
- Modify: `src/tui/components/HelpBar.tsx`

**Step 1: Update the expanded help bar**

Replace the expanded help content with:

```tsx
import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme.js";

interface HelpBarProps {
  showingLogs: boolean;
  expanded: boolean;
}

function Key({ k, label, accentColor }: { k: string; label: string; accentColor: string }) {
  return (
    <Text>
      <Text color={accentColor} bold>{k}</Text>
      <Text dimColor> {label}</Text>
    </Text>
  );
}

export function HelpBar({ showingLogs, expanded }: HelpBarProps) {
  const theme = useTheme();

  if (!expanded) {
    return (
      <Box
        borderStyle="round"
        borderColor={theme.border}
        borderTop={false}
        paddingX={1}
        justifyContent="center"
        gap={1}
      >
        <Key k="t" label="theme" accentColor={theme.accent} />
        <Text dimColor>·</Text>
        <Key k="?" label="help" accentColor={theme.accent} />
        <Text dimColor>·</Text>
        <Key k="q" label="quit" accentColor={theme.accent} />
      </Box>
    );
  }

  return (
    <Box
      borderStyle="round"
      borderColor={theme.border}
      borderTop={false}
      paddingX={1}
      justifyContent="center"
      gap={1}
    >
      <Key k="↑↓" label="navigate" accentColor={theme.accent} />
      <Text dimColor>·</Text>
      <Key k="enter" label="expand" accentColor={theme.accent} />
      <Text dimColor>·</Text>
      <Key k="→" label="drill in" accentColor={theme.accent} />
      <Text dimColor>·</Text>
      <Key k="←/esc" label="back" accentColor={theme.accent} />
      <Text dimColor>·</Text>
      <Key k="s" label="start/stop" accentColor={theme.accent} />
      <Text dimColor>·</Text>
      <Key k="w" label="watch" accentColor={theme.accent} />
      <Text dimColor>·</Text>
      <Key k="r" label="retry" accentColor={theme.accent} />
      <Text dimColor>·</Text>
      <Key k="c" label="claude" accentColor={theme.accent} />
      <Text dimColor>·</Text>
      <Key k="e" label="shell" accentColor={theme.accent} />
      <Text dimColor>·</Text>
      <Key k="tab" label={showingLogs ? "hide logs" : "all logs"} accentColor={theme.accent} />
      <Text dimColor>·</Text>
      <Key k="t" label="theme" accentColor={theme.accent} />
      <Text dimColor>·</Text>
      <Key k="?" label="hide help" accentColor={theme.accent} />
      <Text dimColor>·</Text>
      <Key k="q" label="quit" accentColor={theme.accent} />
    </Box>
  );
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/tui/components/HelpBar.tsx
git commit -m "feat: update HelpBar with new arrow navigation and swapped w/e keys"
```

---

### Task 7: Full build and manual test

**Step 1: Clean build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 2: Build the project**

Run: `yarn build`
Expected: Successful compilation

**Step 3: Manual smoke test**

Run: `node dist/bin/orc.js` (or however the app is started)

Test the following:
- Up/down arrows move between rows
- Enter expands a row (shows comments/activity/logs inline)
- Enter again collapses it
- Expand multiple rows — both stay open
- Right arrow on expanded row highlights first section (▸ indicator)
- Up/down in section mode moves between Comments/Claude/Logs
- Enter or Right in section mode opens fullscreen drill-in
- Escape or Left in drill-in goes back to section view
- Left or Escape in section view goes back to row navigation
- `s` starts/stops, `w` watches, `r` retries
- `c` opens Claude resume, `e` opens worktree shell
- Tab toggles global logs
- `?` shows help with new keybindings

**Step 4: Commit any fixes**

If anything needs tweaking from the smoke test, fix and commit.

---

### Task 8: Clean up unused files

**Files:**
- Modify: `src/tui/components/DetailPanel.tsx` — keep the file but it's no longer imported from App. Delete it if nothing else imports it.
- Modify: `src/tui/components/ActivityPane.tsx` — same.

**Step 1: Check for remaining imports**

Run: `grep -r "DetailPanel\|ActivityPane" src/ --include='*.ts' --include='*.tsx'`

If they're only referenced in their own files (self-definitions), delete them.

**Step 2: Delete unused files**

```bash
rm src/tui/components/DetailPanel.tsx src/tui/components/ActivityPane.tsx
```

**Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add -u
git commit -m "chore: remove unused DetailPanel and ActivityPane components"
```
