import React from "react";
import { Box, Text } from "ink";
import type { PREntry } from "../hooks/useDaemonState.js";
import type { CommentCategory, CycleRecord } from "../../types/index.js";
import { useTheme } from "../theme.js";
import { formatTime } from "../../utils/time.js";

interface DetailPanelProps {
  entries: Map<string, PREntry>;
  selectedBranch: string | null;
  showDetail: boolean;
  activityLines?: string[];
}

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

function SectionHeader({ label, color }: { label: string; color: string }) {
  const rule = "─".repeat(Math.max(0, 44 - label.length));
  return (
    <Box marginTop={1}>
      <Text color={color} dimColor>{"━━ "}</Text>
      <Text color={color} bold>{label}</Text>
      <Text color={color} dimColor>{" " + rule}</Text>
    </Box>
  );
}

function ErrorAction({ error, errorColor }: { error: string; errorColor: string }) {
  const lower = error.toLowerCase();
  const hints: string[] = [];

  if (lower.includes("checked out")) {
    hints.push("run: git checkout main");
  } else if (lower.includes("rebase") || lower.includes("conflict")) {
    hints.push("w to open worktree and resolve conflicts");
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

  hints.push("r to rebase · s to start full review");

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


function CycleHistory({ cycles, totalAddressed, totalSeen, accentColor }: {
  cycles: CycleRecord[];
  totalAddressed: number;
  totalSeen: number;
  accentColor: string;
}) {
  const totalCost = cycles.reduce((sum, c) => sum + c.costUsd, 0);

  return (
    <>
      <SectionHeader label={`Review Progress (${totalAddressed}/${totalSeen})`} color={accentColor} />
      {cycles.map((cycle, i) => {
        const isLatest = i === cycles.length - 1;
        const time = formatTime(cycle.startedAt);
        return (
          <Box key={i} marginLeft={2}>
            <Text dimColor>{"r" + String(i + 1).padEnd(4)}</Text>
            <Text color={cycle.commentsFixed > 0 ? accentColor : "gray"}>
              {String(cycle.commentsFixed).padStart(2)} fixed
            </Text>
            <Text dimColor>{"   $" + cycle.costUsd.toFixed(3).padStart(6)}</Text>
            <Text dimColor>{"   " + time}</Text>
            {isLatest && !cycle.completedAt && (
              <Text color={accentColor}>{" ← now"}</Text>
            )}
          </Box>
        );
      })}
      <Box marginLeft={2} marginTop={0}>
        <Text dimColor>{"──────────────────────────────"}</Text>
      </Box>
      <Box marginLeft={2}>
        <Text dimColor>{"tot "}</Text>
        <Text color={accentColor} bold>
          {String(totalAddressed).padStart(2)}/{totalSeen}
        </Text>
        <Text dimColor>{"    $" + totalCost.toFixed(3).padStart(6)}</Text>
      </Box>
    </>
  );
}

export function DetailPanel({
  entries,
  selectedBranch,
  showDetail,
  activityLines = [],
}: DetailPanelProps) {
  const theme = useTheme();
  const branch = selectedBranch;
  const entry = branch ? entries.get(branch) : undefined;

  if (!entry) {
    return (
      <Box
        borderStyle="round"
        borderColor={theme.border}
        borderTop={false}
        borderBottom={false}
        paddingX={1}
        flexDirection="column"
      >
        <Text dimColor>No PR selected</Text>
      </Box>
    );
  }

  const { pr, state, commentCount, commentThreads, ciStatus, failedChecks, conflicted } = entry;
  const title = pr.title.length > 50 ? pr.title.slice(0, 49) + "…" : pr.title;
  const summary = state?.commentSummary ?? null;
  const activeStatuses = ["fixing", "categorizing", "verifying", "pushing", "replying"];
  const isActive = state ? activeStatuses.includes(state.status) : false;


  // Collapsed view
  if (!showDetail) {
    return (
      <Box
        borderStyle="round"
        borderColor={state?.error ? theme.error : theme.border}
        borderTop={false}
        borderBottom={false}
        paddingX={1}
        flexDirection="column"
      >
        <Text dimColor>
          <Text color={theme.accent}>r</Text> rebase · <Text color={theme.accent}>s</Text> start · <Text color={theme.accent}>enter</Text> details
          {commentCount > 0 && <Text color={theme.warning}> · {commentCount} unresolved</Text>}
        </Text>
        {state?.error && <ErrorAction error={state.error} errorColor={theme.error} />}
        {activityLines.length > 0 && (
          <Box marginLeft={2}>
            <Text color={theme.accent} dimColor>Claude: </Text>
            <Text dimColor>{activityLines[activityLines.length - 1]}</Text>
          </Box>
        )}
      </Box>
    );
  }

  // Expanded view
  return (
    <Box
      borderStyle="round"
      borderColor={state?.error ? theme.error : theme.border}
      borderTop={false}
      borderBottom={false}
      paddingX={1}
      flexDirection="column"
    >
      <Box justifyContent="space-between">
        <Box>
          <Text dimColor>#{pr.number} </Text>
          <Text bold>{title}</Text>
        </Box>
        {state && (
          <Text>
            {state.lifetimeSeen > 0 ? (
              <Text color={theme.accentBright}>{state.lifetimeAddressed}/{state.lifetimeSeen}</Text>
            ) : (
              <Text color={theme.accentBright}>{state.commentsAddressed} fixed</Text>
            )}
            <Text dimColor> · ${state.totalCostUsd.toFixed(3)}</Text>
            {isActive && <Text dimColor> · </Text>}
            {isActive && <Text color={theme.accentBright}>{state.status}...</Text>}
          </Text>
        )}
      </Box>

      {!state && (
        <Text dimColor>
          {commentCount > 0
            ? `${commentCount} unresolved · `
            : ""}
          <Text color={theme.accent}>s</Text> to start
        </Text>
      )}

      {state?.error && <ErrorAction error={state.error} errorColor={theme.error} />}

      {/* Cycle history */}
      {state && state.cycleHistory.length > 0 && (
        <CycleHistory
          cycles={state.cycleHistory}
          totalAddressed={state.lifetimeAddressed}
          totalSeen={state.lifetimeSeen}
          accentColor={theme.accentBright}
        />
      )}

      {/* Conflict prompt — waiting for user action */}
      {state?.status === "conflict_prompt" && conflicted.length > 0 && (
        <>
          <Box marginTop={1}>
            <Text color="yellow" bold>{"! "}</Text>
            <Text color="yellow">Branch has conflicts with base</Text>
          </Box>
          {conflicted.map((file, i) => (
            <Box key={i} marginLeft={2}>
              <Text color="yellow">{"· "}</Text>
              <Text>{file}</Text>
            </Box>
          ))}
          <Box marginTop={1} marginLeft={2}>
            <Text color="green" bold>[R]</Text>
            <Text> Resolve with Claude  </Text>
            <Text color="cyan" bold>[A]</Text>
            <Text> Always resolve with Claude  </Text>
            <Text dimColor bold>[Esc]</Text>
            <Text dimColor> Dismiss</Text>
          </Box>
        </>
      )}

      {/* Conflict indicator (idle / not in prompt) */}
      {state?.status !== "conflict_prompt" && conflicted.length > 0 && (
        <>
          <Box marginTop={1}>
            <Text color="red" bold>{"! "}</Text>
            <Text color="red">Branch has conflicts with base</Text>
            {!state && (
              <>
                <Text dimColor> — </Text>
                <Text color="green">s</Text>
                <Text dimColor> to start (will auto-rebase)</Text>
              </>
            )}
          </Box>
          {conflicted.map((file, i) => (
            <Box key={i} marginLeft={2}>
              <Text color="red">{"· "}</Text>
              <Text>{file}</Text>
            </Box>
          ))}
        </>
      )}

      {/* CI Status section — gated on ciStatus so conditions are mutually exclusive */}
      {ciStatus === "failing" && failedChecks.length > 0 && (
        <>
          <SectionHeader label={`CI (${failedChecks.length} failing)`} color={theme.accent} />
          {failedChecks.map((check) => (
            <Box key={check.id} marginLeft={2}>
              <Text color="red">{"✗ "}</Text>
              <Text color="white">{check.name}</Text>
              {check.logSnippet && (
                <Text dimColor>  {check.logSnippet.slice(0, 60)}…</Text>
              )}
            </Box>
          ))}
          {state && state.ciFixAttempts > 0 && (
            <Box marginLeft={2}>
              <Text dimColor>
                CI fix attempts: {state.ciFixAttempts}
              </Text>
            </Box>
          )}
        </>
      )}
      {ciStatus === "passing" && (
        <Box marginTop={1}>
          <Text color="green">{"✓ "}</Text>
          <Text dimColor>All CI checks passing</Text>
        </Box>
      )}
      {ciStatus === "pending" && (
        <Box marginTop={1}>
          <Text color="yellow">{"● "}</Text>
          <Text dimColor>CI checks running...</Text>
        </Box>
      )}

      {/* Categorized comments */}
      {summary && summary.comments.length > 0 ? (
        <>
          <SectionHeader label={`Comments (${summary.comments.length})`} color={theme.accent} />
          {summary.comments.map((c) => {
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
        </>
      ) : commentThreads.length > 0 ? (
        <>
          <SectionHeader label={`Comments (${commentThreads.length})`} color={theme.accent} />
          {commentThreads.map((t) => {
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
        </>
      ) : (
        <Box marginTop={1}>
          <Text dimColor>No comments</Text>
        </Box>
      )}

      {/* Claude activity */}
      {activityLines.length > 0 && (
        <>
          <SectionHeader label={`Claude [${entry.branch}]`} color={theme.accent} />
          {activityLines.map((line, i) => (
            <Box key={i} marginLeft={2}>
              <Text dimColor={i < activityLines.length - 1} color={i === activityLines.length - 1 ? theme.text : undefined}>
                {line}
              </Text>
            </Box>
          ))}
        </>
      )}
    </Box>
  );
}
