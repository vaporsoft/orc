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
  const branch = entry.branch.length > 26
    ? entry.branch.slice(0, 25) + "…"
    : entry.branch;

  const prLabel = `#${pr.number}`;
  const status = state?.status ?? "stopped";
  const cost = state ? `$${state.totalCostUsd.toFixed(2)}` : "—";
  const lastPush = state?.lastPushAt ? formatTime(state.lastPushAt) : "—";

  return (
    <Box paddingX={1}>
      <Box width={2}>
        <Text color={selected ? "green" : "gray"}>
          {selected ? "▍" : " "}
        </Text>
      </Box>
      <Box width={28}>
        <Text color={selected ? "green" : "white"}>{branch}</Text>
      </Box>
      <Box width={8}>
        <Text dimColor>{prLabel}</Text>
      </Box>
      <Box width={16}>
        <StatusBadge status={status} />
        {state?.mode === "watch" && <Text color="cyan"> ⟳</Text>}
      </Box>
      <Box width={10}>
        <Text color={commentCount > 0 ? "yellow" : "gray"}>
          {commentCount > 0 ? String(commentCount) : "—"}
        </Text>
      </Box>
      <Box width={8}>
        <Text color={state && state.commentsAddressed > 0 ? "greenBright" : "gray"}>
          {state && state.commentsAddressed > 0 ? String(state.commentsAddressed) : "—"}
        </Text>
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
