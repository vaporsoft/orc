import React from "react";
import { Box, Text } from "ink";
import type { PREntry } from "../hooks/useDaemonState.js";
import { StatusBadge } from "./StatusBadge.js";
import { useTheme } from "../theme.js";
import { formatTime } from "../../utils/time.js";
import type { CIStatus } from "../../types/index.js";

interface SessionRowProps {
  entry: PREntry;
  selected: boolean;
  dimmed?: boolean;
  /** Tick counter to force re-render for countdown timer updates */
  tick?: number;
}


function formatTimeLeft(expiresAt: number): string {
  const remainMs = expiresAt - Date.now();
  if (remainMs <= 0) return "0s";
  const totalSec = Math.ceil(remainMs / 1000);
  // Final minute: show seconds
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.ceil(remainMs / 60_000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h${String(m).padStart(2, "0")}m` : `${h}h`;
}

const CI_INDICATORS: Record<CIStatus, { symbol: string; color: string }> = {
  passing: { symbol: "✓", color: "green" },
  failing: { symbol: "✗", color: "red" },
  pending: { symbol: "●", color: "yellow" },
  unknown: { symbol: "—", color: "gray" },
};

function arePropsEqual(prev: SessionRowProps, next: SessionRowProps): boolean {
  if (prev.selected !== next.selected || prev.dimmed !== next.dimmed || prev.tick !== next.tick) return false;
  const p = prev.entry;
  const n = next.entry;
  return (
    p.branch === n.branch &&
    p.pr.number === n.pr.number &&
    p.commentCount === n.commentCount &&
    p.ciStatus === n.ciStatus &&
    p.mergedAt === n.mergedAt &&
    p.conflicted.length === n.conflicted.length &&
    p.state?.status === n.state?.status &&
    p.state?.mode === n.state?.mode &&
    p.state?.totalCostUsd === n.state?.totalCostUsd &&
    p.state?.lastPushAt === n.state?.lastPushAt &&
    p.state?.sessionExpiresAt === n.state?.sessionExpiresAt &&
    p.threadCounts?.total === n.threadCounts?.total &&
    p.threadCounts?.resolved === n.threadCounts?.resolved
  );
}

export const SessionRow = React.memo(function SessionRow({ entry, selected, dimmed }: SessionRowProps) {
  const theme = useTheme();
  const { pr, state, commentCount, ciStatus, conflicted } = entry;
  const branch = entry.branch.length > 26
    ? entry.branch.slice(0, 25) + "…"
    : entry.branch;

  const prLabel = `#${pr.number}`;
  const status = entry.mergedAt ? "merged" as const : (state?.status ?? "stopped");
  const cost = state ? `$${state.totalCostUsd.toFixed(2)}` : "—";
  const lastPush = state?.lastPushAt ? formatTime(state.lastPushAt) : "—";
  // If CI is unknown but we pushed recently, show yellow dash (waiting for checks to start)
  const pushAge = state?.lastPushAt ? Date.now() - new Date(state.lastPushAt).getTime() : Infinity;
  const ciWaiting = ciStatus === "unknown" && pushAge < 5 * 60_000;
  const ci = ciWaiting ? { symbol: "—", color: "yellow" } : CI_INDICATORS[ciStatus];

  const isWatch = state?.mode === "watch";
  const expiresAt = state?.sessionExpiresAt ?? null;
  const doneStatuses = ["stopped", "ready", "error", "merged"];
  const isActive = isWatch && !doneStatuses.includes(status);
  const isUnlimited = isWatch && !expiresAt;
  const showTimeLeft = isActive && expiresAt;
  const timeLeft = showTimeLeft ? formatTimeLeft(expiresAt) : null;
  const remainMs = expiresAt ? expiresAt - Date.now() : null;
  const isLow = remainMs !== null && remainMs > 0 && remainMs < 10 * 60_000; // < 10 min

  return (
    <Box paddingX={1}>
      <Box width={2}>
        <Text color={selected ? theme.accent : theme.muted} dimColor={dimmed}>
          {selected ? "▍" : " "}
        </Text>
      </Box>
      <Box width={28}>
        <Text color={selected ? theme.accent : (dimmed ? theme.muted : theme.text)} dimColor={dimmed}>{branch}</Text>
      </Box>
      <Box width={8}>
        <Text dimColor>{prLabel}</Text>
      </Box>
      <Box width={16}>
        <StatusBadge status={status} />
        {isActive && <Text color={theme.info}> ⟳</Text>}
      </Box>
      <Box width={10}>
        {showTimeLeft ? (
          <Text color={isLow ? theme.warning : theme.muted}>{timeLeft}</Text>
        ) : isActive && isUnlimited ? (
          <Text color={theme.muted}>∞</Text>
        ) : (
          <Text color={theme.muted}>{"—"}</Text>
        )}
      </Box>
      <Box width={4}>
        <Text color={ci.color}>{ci.symbol}</Text>
      </Box>
      <Box width={12}>
        <Text color={conflicted.length > 0 ? "red" : "gray"}>
          {conflicted.length > 0 ? `${conflicted.length} file${conflicted.length > 1 ? "s" : ""}` : "—"}
        </Text>
      </Box>
      <Box width={10}>
        <Text color={commentCount > 0 ? theme.warning : theme.muted} dimColor={dimmed}>
          {commentCount > 0 ? String(commentCount) : "—"}
        </Text>
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
      <Box width={10}>
        <Text dimColor>{cost}</Text>
      </Box>
      <Box width={10}>
        <Text dimColor>{lastPush}</Text>
      </Box>
    </Box>
  );
}, arePropsEqual);
