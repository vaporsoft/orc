import React from "react";
import { Box, Text } from "ink";
import type { PREntry } from "../hooks/useDaemonState.js";
import { StatusBadge } from "./StatusBadge.js";
import { useTheme } from "../theme.js";
import { formatTime } from "../../utils/time.js";

interface SessionRowProps {
  entry: PREntry;
  selected: boolean;
  dimmed?: boolean;
}


export function SessionRow({ entry, selected, dimmed }: SessionRowProps) {
  const theme = useTheme();
  const { pr, state, commentCount } = entry;
  const branch = entry.branch.length > 26
    ? entry.branch.slice(0, 25) + "…"
    : entry.branch;

  const prLabel = `#${pr.number}`;
  const status = entry.mergedAt ? "merged" as const : (state?.status ?? "stopped");
  const cost = state ? `$${state.totalCostUsd.toFixed(2)}` : "—";
  const lastPush = state?.lastPushAt ? formatTime(state.lastPushAt) : "—";

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
        {state?.mode === "watch" && <Text color={theme.info}> ⟳</Text>}
      </Box>
      <Box width={10}>
        <Text color={commentCount > 0 ? theme.warning : theme.muted} dimColor={dimmed}>
          {commentCount > 0 ? String(commentCount) : "—"}
        </Text>
      </Box>
      <Box width={12}>
        {state && state.lifetimeSeen > 0 ? (
          <Text color={state.lifetimeAddressed > 0 ? theme.accentBright : theme.muted} dimColor={dimmed}>
            {state.lifetimeAddressed}/{state.lifetimeSeen}
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
      {state?.error && (
        <Box>
          <Text color="red"> !</Text>
        </Box>
      )}
    </Box>
  );
}
