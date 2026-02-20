import React from "react";
import { Box, Text } from "ink";
import type { PREntry } from "../hooks/useDaemonState.js";
import { StatusBadge } from "./StatusBadge.js";

interface SessionRowProps {
  entry: PREntry;
  selected: boolean;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function SessionRow({ entry, selected }: SessionRowProps) {
  const { pr, state, commentCount } = entry;
  const branch = entry.branch.length > 20
    ? entry.branch.slice(0, 19) + "…"
    : entry.branch;

  const prLabel = `#${pr.number}`;
  const status = state?.status ?? "stopped";
  const iter = state ? `${state.currentIteration}/${state.maxIterations}` : "—";
  const cost = state ? `$${state.totalCostUsd.toFixed(2)}` : "—";
  const lastPush = state?.lastPushAt ? formatTime(state.lastPushAt) : "—";
  const errors = state
    ? state.iterations.reduce((sum, i) => sum + i.errors.length, 0)
    : 0;

  return (
    <Box>
      <Text color={selected ? "cyan" : undefined} bold={selected}>
        {selected ? ">" : " "}{" "}
      </Text>
      <Box width={22}>
        <Text bold={selected}>{branch}</Text>
      </Box>
      <Box width={8}>
        <Text dimColor>{prLabel}</Text>
      </Box>
      <Box width={18}>
        <StatusBadge status={status} />
      </Box>
      <Box width={10}>
        <Text color={commentCount > 0 ? "yellow" : undefined}>
          {commentCount > 0 ? commentCount : "—"}
        </Text>
      </Box>
      <Box width={8}>
        <Text>{iter}</Text>
      </Box>
      <Box width={10}>
        <Text>{cost}</Text>
      </Box>
      <Box width={10}>
        <Text dimColor>{lastPush}</Text>
      </Box>
      <Box width={6}>
        <Text color={errors > 0 ? "red" : undefined}>{errors}</Text>
      </Box>
    </Box>
  );
}
