import React from "react";
import { Box, Text } from "ink";
import type { BranchState } from "../../types/index.js";

interface DetailPanelProps {
  sessions: Map<string, BranchState>;
  selectedIndex: number;
}

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  return `${String(min).padStart(2, "0")}:${String(remSec).padStart(2, "0")}s`;
}

export function DetailPanel({ sessions, selectedIndex }: DetailPanelProps) {
  const branches = [...sessions.keys()].sort();
  const branch = branches[selectedIndex];
  const state = branch ? sessions.get(branch) : undefined;

  if (!state) {
    return (
      <Box borderStyle="single" borderTop={false} borderBottom={false} paddingX={1} flexDirection="column">
        <Text dimColor>No session selected</Text>
      </Box>
    );
  }

  const label = state.prNumber
    ? `#${state.prNumber} ${state.branch}`
    : state.branch;

  return (
    <Box borderStyle="single" borderTop={false} borderBottom={false} paddingX={1} flexDirection="column">
      <Text bold> {label}</Text>
      {state.iterations.length === 0 ? (
        <Text dimColor>  No iterations yet</Text>
      ) : (
        state.iterations.map((iter) => {
          const ok = iter.errors.length === 0;
          return (
            <Text key={iter.iteration}>
              {"  "}Iter {iter.iteration}{"  "}
              {formatDuration(iter.durationMs)}{"  "}
              {iter.eventsDetected} detected{"  "}
              {iter.eventsFixed} fixed{"  "}
              {iter.eventsSkipped} skip{"  "}
              ${iter.costUsd.toFixed(3)}{"  "}
              <Text color={ok ? "green" : "red"}>{ok ? "✓" : `✗ ${iter.errors.length}`}</Text>
            </Text>
          );
        })
      )}
      {state.status === "fixing" && (
        <Text dimColor>  Iter {state.currentIteration}  ...running ({state.status})</Text>
      )}
      {state.error && (
        <Text color="red">  Error: {state.error}</Text>
      )}
    </Box>
  );
}
