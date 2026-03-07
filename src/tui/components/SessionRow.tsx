import React from "react";
import { Box, Text } from "ink";
import type { PREntry } from "../hooks/useDaemonState.js";
import { useTheme } from "../theme.js";
import { formatCompact } from "../../utils/format.js";
import type { CIStatus } from "../../types/index.js";
import type { ReviewState } from "../hooks/useDaemonState.js";

interface SessionRowProps {
  entry: PREntry;
  selected: boolean;
  dimmed?: boolean;
  checkedOut?: boolean;
}

const CI_INDICATORS: Record<CIStatus, { symbol: string; color: string }> = {
  passing: { symbol: "✓", color: "green" },
  failing: { symbol: "✗", color: "red" },
  pending: { symbol: "●", color: "yellow" },
  unknown: { symbol: "—", color: "gray" },
};

const REVIEW_INDICATORS: Record<ReviewState, { symbol: string; color: string }> = {
  approved: { symbol: "✓", color: "green" },
  changes_requested: { symbol: "✗", color: "yellow" },
  pending: { symbol: "·", color: "gray" },
  unknown: { symbol: "—", color: "gray" },
};

function arePropsEqual(prev: SessionRowProps, next: SessionRowProps): boolean {
  if (prev.selected !== next.selected || prev.dimmed !== next.dimmed || prev.checkedOut !== next.checkedOut) return false;
  const p = prev.entry;
  const n = next.entry;
  return (
    p.branch === n.branch &&
    p.pr.number === n.pr.number &&
    p.pr.isDraft === n.pr.isDraft &&
    p.commentCount === n.commentCount &&
    p.commentCountsByType?.addressable === n.commentCountsByType?.addressable &&
    p.commentCountsByType?.conversation === n.commentCountsByType?.conversation &&
    p.ciStatus === n.ciStatus &&
    p.mergedAt === n.mergedAt &&
    p.conflicted.length === n.conflicted.length &&
    p.state?.status === n.state?.status &&
    p.state?.mode === n.state?.mode &&
    p.state?.lastPushAt === n.state?.lastPushAt &&
    p.threadCounts?.total === n.threadCounts?.total &&
    p.threadCounts?.resolved === n.threadCounts?.resolved &&
    p.pr.additions === n.pr.additions &&
    p.pr.deletions === n.pr.deletions &&
    p.pr.changedFiles === n.pr.changedFiles &&
    p.reviewState === n.reviewState
  );
}

export const SessionRow = React.memo(function SessionRow({ entry, selected, dimmed, checkedOut }: SessionRowProps) {
  const theme = useTheme();
  const { pr, state, commentCount, ciStatus, conflicted, reviewState } = entry;
  const maxBranchLen = checkedOut ? 24 : 26;
  const branch = entry.branch.length > maxBranchLen
    ? entry.branch.slice(0, maxBranchLen - 1) + "…"
    : entry.branch;

  const prLabel = `#${pr.number}`;
  // If CI is unknown but we pushed recently, show yellow dash (waiting for checks to start)
  const pushAge = state?.lastPushAt ? Date.now() - new Date(state.lastPushAt).getTime() : Infinity;
  const ciWaiting = ciStatus === "unknown" && pushAge < 5 * 60_000;
  const ci = ciWaiting ? { symbol: "—", color: "yellow" } : CI_INDICATORS[ciStatus];
  const review = REVIEW_INDICATORS[reviewState];

  // PR status: merged > draft > changes requested > approved > needs review
  let prStatus: { label: string; color: string };
  if (entry.mergedAt) {
    prStatus = { label: "merged", color: theme.merged };
  } else if (pr.isDraft) {
    prStatus = { label: "draft", color: theme.muted };
  } else if (reviewState === "changes_requested") {
    prStatus = { label: "changes req", color: theme.warning };
  } else if (reviewState === "approved") {
    prStatus = { label: "approved", color: "green" };
  } else {
    prStatus = { label: "needs review", color: theme.info };
  }

  const isWatch = state?.mode === "watch";
  const internalStatus = entry.mergedAt ? "merged" : (state?.status ?? "stopped");
  const doneStatuses = ["stopped", "ready", "error", "merged"];
  const isActive = isWatch && !doneStatuses.includes(internalStatus);

  return (
    <Box paddingX={1}>
      <Box width={2}>
        <Text color={selected ? theme.accent : theme.muted} dimColor={dimmed}>
          {selected ? "▍" : " "}
        </Text>
      </Box>
      <Box width={28}>
        {checkedOut && <Text color={theme.info}>⎇ </Text>}
        <Text color={selected ? theme.accent : (dimmed ? theme.muted : theme.text)} dimColor={dimmed}>{branch}</Text>
      </Box>
      <Box width={8}>
        <Text dimColor>{prLabel}</Text>
      </Box>
      <Box width={16}>
        <Text color={prStatus.color}>{prStatus.label}</Text>
        {isActive && <Text color={theme.info}> ⟳</Text>}
      </Box>
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
      <Box width={4}>
        <Text color={ci.color}>{ci.symbol}</Text>
      </Box>
      <Box width={8}>
        <Text color={review.color}>{review.symbol}</Text>
      </Box>
      <Box width={12}>
        <Text color={conflicted.length > 0 ? "red" : "gray"}>
          {conflicted.length > 0 ? `${conflicted.length} file${conflicted.length > 1 ? "s" : ""}` : "—"}
        </Text>
      </Box>
      <Box width={10}>
        {(() => {
          const conversation = entry.commentCountsByType?.conversation ?? 0;
          if (conversation > 0) {
            return <Text dimColor={dimmed}>{String(conversation)}</Text>;
          }
          return <Text color={theme.muted} dimColor={dimmed}>—</Text>;
        })()}
      </Box>
      <Box width={12}>
        {(() => {
          const addressable = entry.commentCountsByType?.addressable ?? commentCount;
          if (addressable > 0) {
            return <Text color={theme.warning} dimColor={dimmed}>{String(addressable)}</Text>;
          }
          return <Text color={theme.muted} dimColor={dimmed}>—</Text>;
        })()}
      </Box>
      <Box width={12}>
        {entry.threadCounts && entry.threadCounts.total > 0 ? (
          <Text color={entry.threadCounts.resolved === entry.threadCounts.total ? theme.accentBright : theme.muted} dimColor={dimmed}>
            {entry.threadCounts.resolved}/{entry.threadCounts.total}
          </Text>
        ) : (
          <Text color={theme.muted} dimColor={dimmed}>—</Text>
        )}
      </Box>
    </Box>
  );
}, arePropsEqual);
