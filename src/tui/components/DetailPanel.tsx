import React from "react";
import { Box, Text } from "ink";
import type { PREntry } from "../hooks/useDaemonState.js";
import type { CommentCategory } from "../../types/index.js";

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

function SectionHeader({ label }: { label: string }) {
  const rule = "─".repeat(Math.max(0, 44 - label.length));
  return (
    <Box marginTop={1}>
      <Text color="green" dimColor>{"━━ "}</Text>
      <Text color="green" bold>{label}</Text>
      <Text color="green" dimColor>{" " + rule}</Text>
    </Box>
  );
}

function ErrorAction({ error }: { error: string }) {
  const lower = error.toLowerCase();
  let hint = "r to retry";

  if (lower.includes("rebase") || lower.includes("conflict")) {
    hint = "w to open worktree, resolve conflicts, then r to retry";
  } else if (lower.includes("push")) {
    hint = "check remote branch state, then r to retry";
  } else if (lower.includes("no open pr")) {
    hint = "open a PR for this branch first";
  } else if (lower.includes("auth")) {
    hint = "check gh auth status";
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color="red" bold>{"✗ ERROR "}</Text>
        <Text color="red">{error}</Text>
      </Box>
      <Box marginLeft={2}>
        <Text dimColor>→ {hint}</Text>
      </Box>
    </Box>
  );
}

export function DetailPanel({
  entries,
  selectedIndex,
  showDetail,
}: DetailPanelProps) {
  const branches = [...entries.keys()].sort();
  const branch = branches[selectedIndex];
  const entry = branch ? entries.get(branch) : undefined;

  if (!entry) {
    return (
      <Box
        borderStyle="round"
        borderColor="green"
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
  const isFixing = state?.status === "fixing";

  // Collapsed view
  if (!showDetail) {
    return (
      <Box
        borderStyle="round"
        borderColor={state?.error ? "red" : "green"}
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
            <Text color="green">s</Text> start · <Text color="green">enter</Text> details
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
            <Text color="greenBright">{state.commentsAddressed} fixed</Text>
            <Text dimColor> · ${state.totalCostUsd.toFixed(3)}</Text>
            {isActive && <Text dimColor> · </Text>}
            {isActive && <Text color="greenBright">{state.status}...</Text>}
          </Text>
        )}
        {state?.error && <ErrorAction error={state.error} />}
      </Box>
    );
  }

  // Expanded view
  return (
    <Box
      borderStyle="round"
      borderColor={state?.error ? "red" : "green"}
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
            <Text color="greenBright">{state.commentsAddressed} fixed</Text>
            <Text dimColor> · ${state.totalCostUsd.toFixed(3)}</Text>
            {isActive && <Text dimColor> · </Text>}
            {isActive && <Text color="greenBright">{state.status}...</Text>}
          </Text>
        )}
      </Box>

      {!state && (
        <Text dimColor>
          {commentCount > 0
            ? `${commentCount} unresolved · `
            : ""}
          <Text color="green">s</Text> to start
        </Text>
      )}

      {state?.error && <ErrorAction error={state.error} />}

      {/* Claude activity feed */}
      {isFixing && state.claudeActivity.length > 0 && (
        <>
          <SectionHeader label="Claude" />
          {state.claudeActivity.map((line, i) => (
            <Box key={i} marginLeft={2}>
              <Text dimColor>{line}</Text>
            </Box>
          ))}
        </>
      )}

      {/* Categorized comments */}
      {summary && summary.comments.length > 0 ? (
        <>
          <SectionHeader label={`Comments (${summary.comments.length})`} />
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
                  <Text color="white">{loc}</Text>
                  <Text dimColor>  @{c.author}</Text>
                </Text>
                <Text dimColor>{"           "}{truncated}</Text>
              </Box>
            );
          })}
        </>
      ) : commentThreads.length > 0 ? (
        <>
          <SectionHeader label={`Comments (${commentThreads.length})`} />
          {commentThreads.map((t) => {
            const loc = t.line ? `${t.path}:${t.line}` : t.path;
            const body = t.body.replace(/\n/g, " ");
            const truncated = body.length > 90 ? body.slice(0, 89) + "…" : body;
            return (
              <Box key={t.threadId} marginLeft={2} flexDirection="column">
                <Text>
                  <Text color="white">{loc}</Text>
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
