import React from "react";
import { Box, Text } from "ink";
import type { PREntry } from "../hooks/useDaemonState.js";
import type { CommentCategory } from "../../types/index.js";
import { useTheme } from "../theme.js";

interface DetailPanelProps {
  entries: Map<string, PREntry>;
  selectedIndex: number;
  showDetail: boolean;
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

  hints.push("r to retry when ready");

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

export function DetailPanel({
  entries,
  selectedIndex,
  showDetail,
}: DetailPanelProps) {
  const theme = useTheme();
  const branches = [...entries.keys()].sort();
  const branch = branches[selectedIndex];
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

  const { pr, state, commentCount, commentThreads } = entry;
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
        <Box>
          <Text dimColor>#{pr.number} </Text>
          <Text bold>{title}</Text>
        </Box>
        {!state ? (
          <Text dimColor>
            {commentCount > 0
              ? `${commentCount} unresolved · `
              : ""}
            <Text color={theme.accent}>s</Text> start · <Text color={theme.accent}>enter</Text> details
          </Text>
        ) : (
          <Text>
            {summary && (
              <>
                {summary.mustFix > 0 && <Text color="red">{summary.mustFix} must </Text>}
                {summary.shouldFix > 0 && <Text color="yellow">{summary.shouldFix} should </Text>}
                {summary.niceToHave > 0 && <Text color="cyan">{summary.niceToHave} nice </Text>}
                {summary.verifyAndFix > 0 && <Text color="magenta">{summary.verifyAndFix} verify </Text>}
                {summary.falsePositive > 0 && <Text dimColor>{summary.falsePositive} fp </Text>}
                <Text dimColor>· </Text>
              </>
            )}
            <Text color={theme.accentBright}>{state.commentsAddressed} fixed</Text>
            <Text dimColor> · ${state.totalCostUsd.toFixed(3)}</Text>
            {isActive && <Text dimColor> · </Text>}
            {isActive && <Text color={theme.accentBright}>{state.status}...</Text>}
          </Text>
        )}
        {state?.error && <ErrorAction error={state.error} errorColor={theme.error} />}
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
            <Text color={theme.accentBright}>{state.commentsAddressed} fixed</Text>
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
    </Box>
  );
}
