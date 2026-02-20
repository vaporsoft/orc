import React from "react";
import { Box, Text } from "ink";
import type { PREntry } from "../hooks/useDaemonState.js";

interface DetailPanelProps {
  entries: Map<string, PREntry>;
  selectedIndex: number;
}

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  return `${String(min).padStart(2, "0")}:${String(remSec).padStart(2, "0")}s`;
}

export function DetailPanel({ entries, selectedIndex }: DetailPanelProps) {
  const branches = [...entries.keys()].sort();
  const branch = branches[selectedIndex];
  const entry = branch ? entries.get(branch) : undefined;

  if (!entry) {
    return (
      <Box borderStyle="single" borderTop={false} borderBottom={false} paddingX={1} flexDirection="column">
        <Text dimColor>No PR selected</Text>
      </Box>
    );
  }

  const { pr, state, commentCount } = entry;
  const label = `#${pr.number} ${pr.title}`;

  if (!state) {
    return (
      <Box borderStyle="single" borderTop={false} borderBottom={false} paddingX={1} flexDirection="column">
        <Text bold> {label}</Text>
        {commentCount > 0 ? (
          <Text dimColor>  {commentCount} unresolved comment{commentCount !== 1 ? "s" : ""} — press Enter to start</Text>
        ) : (
          <Text dimColor>  Stopped — press Enter to start iterating</Text>
        )}
      </Box>
    );
  }

  const summary = state.commentSummary;

  return (
    <Box borderStyle="single" borderTop={false} borderBottom={false} paddingX={1} flexDirection="column">
      <Text bold> {label}</Text>
      {summary && (
        <Text dimColor>
          {"  "}Comments: {summary.total} total — {summary.mustFix} must_fix, {summary.shouldFix} should_fix, {summary.niceToHave} nice_to_have, {summary.falsePositive} false_positive
        </Text>
      )}
      {state.iterations.length === 0 && !summary ? (
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
      {["fixing", "fetching", "categorizing", "verifying", "pushing", "replying"].includes(state.status) && (
        <Text dimColor>  Iter {state.currentIteration}  ...running ({state.status})</Text>
      )}
      {state.error && (
        <Text color="red">  Error: {state.error}</Text>
      )}
    </Box>
  );
}
