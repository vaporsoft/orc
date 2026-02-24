import React from "react";
import { Box, Text } from "ink";
import type { PREntry } from "../hooks/useDaemonState.js";
import type { CommentCategory, CycleRecord } from "../../types/index.js";
import { useTheme } from "../theme.js";
import { formatTime } from "../../utils/time.js";
import { formatTokens } from "../../utils/format.js";

export type DetailSection = "cycles" | "conflicts" | "ci" | "comments" | "claude";

/** Returns the ordered list of visible sections for the given entry. */
export function getVisibleSections(entry: PREntry | undefined): DetailSection[] {
  if (!entry) return [];
  const sections: DetailSection[] = [];
  if (entry.state && entry.state.cycleHistory.length > 0) {
    sections.push("cycles");
  }
  sections.push("conflicts", "ci", "comments", "claude");
  return sections;
}

interface DetailPanelProps {
  entries: Map<string, PREntry>;
  selectedBranch: string | null;
  showDetail: boolean;
  activityLines?: string[];
  focusedSection?: DetailSection | null;
  collapsedSections?: Set<DetailSection>;
}

const CATEGORY_COLORS: Record<CommentCategory, string> = {
  must_fix: "red",
  should_fix: "yellow",
  nice_to_have: "cyan",
  false_positive: "gray",
  verify_and_fix: "magenta",
  needs_clarification: "blue",
};

const CATEGORY_LABELS: Record<CommentCategory, string> = {
  must_fix: "MUST FIX",
  should_fix: "SHOULD FIX",
  nice_to_have: "NICE",
  false_positive: "FALSE POS",
  verify_and_fix: "VERIFY",
  needs_clarification: "CLARIFY",
};

const MAX_CYCLES = 8;
const MAX_CONFLICTS = 10;
const MAX_CI_CHECKS = 10;
const MAX_COMMENTS = 8;
const MAX_ACTIVITY = 6;

function SectionHeader({ label, color, focused, collapsed }: {
  label: string;
  color: string;
  focused?: boolean;
  collapsed?: boolean;
}) {
  const chevron = collapsed ? "▸" : "▾";
  const rule = "─".repeat(Math.max(0, 42 - label.length));
  return (
    <Box marginTop={1}>
      <Text color={color} dimColor={!focused} bold={focused}>
        {focused ? "▐ " : "  "}
      </Text>
      <Text color={color} dimColor={!focused}>{chevron} </Text>
      <Text color={color} bold>{label}</Text>
      <Text color={color} dimColor>{" " + rule}</Text>
    </Box>
  );
}

function MoreIndicator({ hidden, label }: { hidden: number; label?: string }) {
  if (hidden <= 0) return null;
  return (
    <Box marginLeft={2}>
      <Text dimColor>  ... {hidden} more {label ?? "items"}</Text>
    </Box>
  );
}

function ErrorAction({ error, errorColor }: { error: string; errorColor: string }) {
  const lower = error.toLowerCase();
  const hints: string[] = [];

  if (lower.includes("checked out")) {
    hints.push("run: git checkout main");
  } else if (lower.includes("rebase") || lower.includes("conflict")) {
    hints.push("e to open worktree and resolve conflicts");
  } else if (lower.includes("ci") || lower.includes("check")) {
    hints.push("CI is failing — orc will auto-fix on next cycle");
  } else if (lower.includes("push")) {
    hints.push("check remote branch state");
  } else if (lower.includes("no open pr")) {
    hints.push("open a PR for this branch first");
  } else if (lower.includes("auth")) {
    hints.push("check gh auth status");
  } else {
    hints.push("l to check logs for details");
    hints.push("c to resume Claude session");
  }

  hints.push("f to fix · s to stop · w to watch");

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={errorColor} bold>{"✗ ERROR "}</Text>
        <Text color={errorColor}>{error}</Text>
      </Box>
      {hints.map((hint, i) => (
        <Box key={i} marginLeft={2}>
          <Text dimColor>→ {hint}</Text>
        </Box>
      ))}
    </Box>
  );
}

function CycleHistory({ cycles, resolved, total, accentColor, collapsed }: {
  cycles: CycleRecord[];
  resolved: number;
  total: number;
  accentColor: string;
  collapsed: boolean;
}) {
  if (collapsed) return null;

  const totalCost = cycles.reduce((sum, c) => sum + c.costUsd, 0);
  const totalTokens = cycles.reduce((sum, c) => sum + (c.inputTokens ?? 0) + (c.outputTokens ?? 0), 0);
  const visibleCycles = cycles.length > MAX_CYCLES ? cycles.slice(cycles.length - MAX_CYCLES) : cycles;
  const hiddenCount = cycles.length - visibleCycles.length;
  // Compute the starting index offset for hidden cycles
  const startIndex = hiddenCount;

  return (
    <>
      {hiddenCount > 0 && <MoreIndicator hidden={hiddenCount} label="cycles" />}
      {visibleCycles.map((cycle, i) => {
        const globalIndex = startIndex + i;
        const isLatest = globalIndex === cycles.length - 1;
        const time = formatTime(cycle.startedAt);
        const cycleTok = (cycle.inputTokens ?? 0) + (cycle.outputTokens ?? 0);
        return (
          <Box key={globalIndex} marginLeft={2}>
            <Text dimColor>{"r" + String(globalIndex + 1).padEnd(4)}</Text>
            <Text color={cycle.commentsSeen > 0 ? accentColor : "gray"}>
              {String(cycle.commentsSeen).padStart(2)} found
            </Text>
            <Text dimColor>{"   $" + cycle.costUsd.toFixed(3).padStart(6)}</Text>
            <Text dimColor>{"  " + formatTokens(cycleTok).padStart(6) + " tok"}</Text>
            <Text dimColor>{"   " + time}</Text>
            {isLatest && !cycle.completedAt && (
              <Text color={accentColor}>{" ← now"}</Text>
            )}
          </Box>
        );
      })}
      <Box marginLeft={2} marginTop={0}>
        <Text dimColor>{"──────────────────────────────────────────"}</Text>
      </Box>
      <Box marginLeft={2}>
        <Text dimColor>{"tot "}</Text>
        <Text color={accentColor} bold>
          {String(resolved).padStart(2)}/{total}
        </Text>
        <Text dimColor>{"    $" + totalCost.toFixed(3).padStart(6)}</Text>
        <Text dimColor>{"  " + formatTokens(totalTokens).padStart(6) + " tok"}</Text>
      </Box>
    </>
  );
}

export function DetailPanel({
  entries,
  selectedBranch,
  showDetail,
  activityLines = [],
  focusedSection = null,
  collapsedSections = new Set(),
}: DetailPanelProps) {
  const theme = useTheme();
  const branch = selectedBranch;
  const entry = branch ? entries.get(branch) : undefined;

  if (!entry) {
    return null;
  }

  const { pr, state, commentCount, commentThreads, threadCounts, ciStatus, failedChecks, conflicted } = entry;
  const summary = state?.commentSummary ?? null;
  const activeStatuses = ["fixing", "triaging", "verifying", "pushing", "replying", "preparing", "checking_ci"];
  const isActive = state ? activeStatuses.includes(state.status) : false;

  const visibleSections = getVisibleSections(entry);

  // When focusedSection is null or not in visibleSections, default to first visible section
  const effectiveFocusedSection = (focusedSection && visibleSections.includes(focusedSection))
    ? focusedSection
    : visibleSections[0] ?? null;

  const isFocused = (section: DetailSection) => {
    return effectiveFocusedSection === section;
  };
  const isCollapsed = (section: DetailSection) => collapsedSections.has(section);


  // Collapsed view
  if (!showDetail) {
    return (
      <Box
        borderStyle="round"
        borderColor={state?.error ? theme.error : theme.border}
        borderTop={false}
        borderBottom={false}
        paddingX={1}
        paddingTop={1}
        flexDirection="column"
      >
        <Box marginLeft={2}>
          <Text dimColor>
            <Text color={theme.accent}>f</Text> fix · <Text color={theme.accent}>s</Text> stop · <Text color={theme.accent}>w</Text> watch · <Text color={theme.accent}>enter</Text> details
            {commentCount > 0 && <Text color={theme.warning}> · {commentCount} unresolved</Text>}
          </Text>
        </Box>
        {state?.error && <ErrorAction error={state.error} errorColor={theme.error} />}
        {isActive && activityLines.length > 0 && (
          <Box marginLeft={2}>
            <Text color={theme.accent} dimColor>Claude: </Text>
            <Text dimColor>{activityLines[activityLines.length - 1]}</Text>
          </Box>
        )}
      </Box>
    );
  }

  // Count helpers for section headers
  const ciLabel = ciStatus === "failing" && failedChecks.length > 0
    ? `CI (${failedChecks.length} failing)`
    : "CI";
  const conflictLabel = conflicted.length > 0
    ? `Conflicts (${conflicted.length} files)`
    : "Conflicts";

  // Expanded view
  return (
    <Box
      borderStyle="round"
      borderColor={state?.error ? theme.error : theme.border}
      borderTop={false}
      borderBottom={false}
      paddingX={1}
      paddingTop={1}
      flexDirection="column"
    >
      {/* Commands bar */}
      <Box marginLeft={2}>
        <Text dimColor>
          <Text color={theme.accent}>f</Text> fix · <Text color={theme.accent}>s</Text> stop · <Text color={theme.accent}>w</Text> watch · <Text color={theme.accent}>enter</Text> collapse
          {effectiveFocusedSection && <Text> · <Text color={theme.accent}>space</Text> toggle section</Text>}
          {commentCount > 0 && <Text color={theme.warning}> · {commentCount} unresolved</Text>}
        </Text>
      </Box>

      {/* Window-style title bar */}
      <Box marginLeft={3} marginTop={1}>
        <Text backgroundColor={theme.secondaryBg} color={theme.text} bold>
          {" "}#{pr.number} {pr.title.length > 60 ? pr.title.slice(0, 59) + "…" : pr.title}{" "}
        </Text>
      </Box>

      {/* Indented detail content with left border line */}
      <Box
        marginLeft={3}
        borderStyle="single"
        borderLeft={true}
        borderRight={false}
        borderTop={false}
        borderBottom={false}
        borderColor={theme.accent}
        paddingLeft={1}
        flexDirection="column"
      >
        {/* Status summary — always visible */}
        <Box>
          <Text dimColor>base: {pr.baseRefName}</Text>
          {state && (
            <>
              <Text dimColor> · </Text>
              {threadCounts && threadCounts.total > 0 ? (
                <Text color={theme.accentBright}>{threadCounts.resolved}/{threadCounts.total} resolved</Text>
              ) : state.commentsAddressed > 0 ? (
                <Text color={theme.accentBright}>{state.commentsAddressed} fixed</Text>
              ) : null}
              <Text dimColor> · ${state.totalCostUsd.toFixed(3)} · {formatTokens(state.totalInputTokens + state.totalOutputTokens)} tok</Text>
              {state.lastPushAt && <Text dimColor> · pushed {formatTime(state.lastPushAt)}</Text>}
            </>
          )}
          {!state && commentCount > 0 && (
            <Text dimColor> · <Text color={theme.warning}>{commentCount} unresolved</Text></Text>
          )}
        </Box>

        {/* Error — always visible */}
        {state?.error && <ErrorAction error={state.error} errorColor={theme.error} />}

        {state?.hasFixupCommits && (
          <Box marginTop={1} marginLeft={2}>
            <Text color={theme.warning} bold>{"! "}</Text>
            <Text color={theme.warning}>Unsquashed fixup commits — rebase before merging</Text>
          </Box>
        )}

        {/* Cycle history */}
        {state && state.cycleHistory.length > 0 && (
          <>
            <SectionHeader
              label={`Review Progress (${threadCounts?.resolved ?? 0}/${threadCounts?.total ?? 0} resolved)`}
              color={theme.accentBright}
              focused={isFocused("cycles")}
              collapsed={isCollapsed("cycles")}
            />
            <CycleHistory
              cycles={state.cycleHistory}
              resolved={threadCounts?.resolved ?? 0}
              total={threadCounts?.total ?? 0}
              accentColor={theme.accentBright}
              collapsed={isCollapsed("cycles")}
            />
          </>
        )}

        {/* Conflicts section */}
        {state?.status === "conflict_prompt" && conflicted.length > 0 ? (
          <>
            <SectionHeader
              label={conflictLabel}
              color={theme.warning}
              focused={isFocused("conflicts")}
              collapsed={isCollapsed("conflicts")}
            />
            {!isCollapsed("conflicts") && (
              <>
                {conflicted.slice(0, MAX_CONFLICTS).map((file, i) => (
                  <Box key={i} marginLeft={2}>
                    <Text color="yellow">{"· "}</Text>
                    <Text>{file}</Text>
                  </Box>
                ))}
                <MoreIndicator hidden={conflicted.length - MAX_CONFLICTS} label="files" />
                <Box marginTop={1} marginLeft={2}>
                  <Text color="green" bold>[R]</Text>
                  <Text> Resolve with Claude  </Text>
                  <Text color="cyan" bold>[Y]</Text>
                  <Text> Always resolve with Claude  </Text>
                  <Text dimColor bold>[Esc]</Text>
                  <Text dimColor> Dismiss</Text>
                </Box>
              </>
            )}
          </>
        ) : conflicted.length > 0 ? (
          <>
            <SectionHeader
              label={conflictLabel}
              color={theme.error}
              focused={isFocused("conflicts")}
              collapsed={isCollapsed("conflicts")}
            />
            {!isCollapsed("conflicts") && (
              <>
                {conflicted.slice(0, MAX_CONFLICTS).map((file, i) => (
                  <Box key={i} marginLeft={2}>
                    <Text color="red">{"· "}</Text>
                    <Text>{file}</Text>
                  </Box>
                ))}
                <MoreIndicator hidden={conflicted.length - MAX_CONFLICTS} label="files" />
                {!state && (
                  <Box marginLeft={2}>
                    <Text dimColor>
                      <Text color={theme.accent}>f</Text> to fix with Claude
                    </Text>
                  </Box>
                )}
              </>
            )}
          </>
        ) : (
          <>
            <SectionHeader
              label="Conflicts"
              color={theme.accent}
              focused={isFocused("conflicts")}
              collapsed={isCollapsed("conflicts")}
            />
            {!isCollapsed("conflicts") && (
              <Box marginLeft={2}><Text dimColor>None</Text></Box>
            )}
          </>
        )}

        {/* CI section */}
        {ciStatus === "failing" && failedChecks.length > 0 ? (
          <>
            <SectionHeader
              label={ciLabel}
              color={theme.error}
              focused={isFocused("ci")}
              collapsed={isCollapsed("ci")}
            />
            {!isCollapsed("ci") && (
              <>
                {failedChecks.slice(0, MAX_CI_CHECKS).map((check) => (
                  <Box key={check.id} marginLeft={2}>
                    <Text color="red">{"✗ "}</Text>
                    <Text color="white">{check.name}</Text>
                    {check.appSlug && check.appSlug !== "github-actions" && (
                      <Text dimColor> [{check.appSlug}]</Text>
                    )}
                    {check.logSnippet && (
                      <Text dimColor>  {check.logSnippet.slice(0, 60)}…</Text>
                    )}
                  </Box>
                ))}
                <MoreIndicator hidden={failedChecks.length - MAX_CI_CHECKS} label="checks" />
                {state && state.ciFixAttempts > 0 && (
                  <Box marginLeft={2}>
                    <Text dimColor>
                      fix attempts: {state.ciFixAttempts}
                    </Text>
                  </Box>
                )}
              </>
            )}
          </>
        ) : (
          <>
            <SectionHeader
              label="CI"
              color={theme.accent}
              focused={isFocused("ci")}
              collapsed={isCollapsed("ci")}
            />
            {!isCollapsed("ci") && (
              <Box marginLeft={2}>
                {ciStatus === "passing" && (
                  <Text color="green">{"✓ "}<Text dimColor>All checks passing</Text></Text>
                )}
                {ciStatus === "pending" && (
                  <Text color="yellow">{"● "}<Text dimColor>Checks running...</Text></Text>
                )}
                {ciStatus === "unknown" && (
                  <Text dimColor>No data</Text>
                )}
              </Box>
            )}
          </>
        )}

        {/* Comments section */}
        {summary && summary.comments.length > 0 ? (
          <>
            <SectionHeader
              label={`Comments (${summary.comments.length})`}
              color={theme.accent}
              focused={isFocused("comments")}
              collapsed={isCollapsed("comments")}
            />
            {!isCollapsed("comments") && (
              <>
                {summary.comments.slice(0, MAX_COMMENTS).map((c) => {
                  const loc = c.line ? `${c.path}:${c.line}` : c.path;
                  const body = c.body.replace(/\n/g, " ");
                  const truncated = body.length > 90 ? body.slice(0, 89) + "…" : body;
                  return (
                    <Box key={c.threadId} marginLeft={2} flexDirection="column">
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
                <MoreIndicator hidden={summary.comments.length - MAX_COMMENTS} label="comments" />
              </>
            )}
          </>
        ) : commentThreads.length > 0 ? (
          <>
            <SectionHeader
              label={`Comments (${commentThreads.length})`}
              color={theme.accent}
              focused={isFocused("comments")}
              collapsed={isCollapsed("comments")}
            />
            {!isCollapsed("comments") && (
              <>
                {commentThreads.slice(0, MAX_COMMENTS).map((t) => {
                  const loc = t.line ? `${t.path}:${t.line}` : t.path;
                  const body = t.body.replace(/\n/g, " ");
                  const truncated = body.length > 90 ? body.slice(0, 89) + "…" : body;
                  return (
                    <Box key={t.threadId} marginLeft={2} flexDirection="column">
                      <Text>
                        <Text color={theme.text}>{loc}</Text>
                        <Text dimColor>  @{t.author}</Text>
                      </Text>
                      <Text dimColor>  {truncated}</Text>
                    </Box>
                  );
                })}
                <MoreIndicator hidden={commentThreads.length - MAX_COMMENTS} label="comments" />
              </>
            )}
          </>
        ) : (
          <>
            <SectionHeader
              label="Comments"
              color={theme.accent}
              focused={isFocused("comments")}
              collapsed={isCollapsed("comments")}
            />
            {!isCollapsed("comments") && (
              <Box marginLeft={2}><Text dimColor>None</Text></Box>
            )}
          </>
        )}

        {/* Claude section */}
        <SectionHeader
          label="Claude"
          color={theme.accent}
          focused={isFocused("claude")}
          collapsed={isCollapsed("claude")}
        />
        {!isCollapsed("claude") && (
          isActive && activityLines.length > 0 ? (
            <>
              {activityLines.length > MAX_ACTIVITY && (
                <MoreIndicator hidden={activityLines.length - MAX_ACTIVITY} label="lines" />
              )}
              {activityLines.slice(Math.max(0, activityLines.length - MAX_ACTIVITY)).map((line, i, arr) => (
                <Box key={`${activityLines.length - arr.length + i}`} marginLeft={2}>
                  <Text dimColor={i < arr.length - 1} color={i === arr.length - 1 ? theme.text : undefined}>
                    {line}
                  </Text>
                </Box>
              ))}
            </>
          ) : (
            <Box marginLeft={2}>
              <Text dimColor>{state ? (isActive ? "Working..." : "Idle") : "Not started"}</Text>
            </Box>
          )
        )}
      </Box>
    </Box>
  );
}
