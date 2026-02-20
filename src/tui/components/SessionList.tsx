import React from "react";
import { Box, Text } from "ink";
import type { PREntry } from "../hooks/useDaemonState.js";
import { SessionRow } from "./SessionRow.js";

interface SessionListProps {
  entries: Map<string, PREntry>;
  selectedIndex: number;
  focused: boolean;
}

export function SessionList({ entries, selectedIndex, focused }: SessionListProps) {
  const branches = [...entries.keys()].sort();

  return (
    <Box flexDirection="column" borderStyle="single" borderTop={false} borderBottom={false}>
      <Box paddingX={1}>
        <Box width={24}>
          <Text bold dimColor>Branch</Text>
        </Box>
        <Box width={8}>
          <Text bold dimColor>PR</Text>
        </Box>
        <Box width={18}>
          <Text bold dimColor>Status</Text>
        </Box>
        <Box width={10}>
          <Text bold dimColor>Comments</Text>
        </Box>
        <Box width={8}>
          <Text bold dimColor>Iter</Text>
        </Box>
        <Box width={10}>
          <Text bold dimColor>Cost</Text>
        </Box>
        <Box width={10}>
          <Text bold dimColor>Last Push</Text>
        </Box>
        <Box width={6}>
          <Text bold dimColor>Errs</Text>
        </Box>
      </Box>
      {branches.length === 0 ? (
        <Box paddingX={1}>
          <Text dimColor>No open PRs found — waiting for discovery...</Text>
        </Box>
      ) : (
        branches.map((branch, i) => (
          <Box key={branch} paddingX={1}>
            <SessionRow
              entry={entries.get(branch)!}
              selected={focused && i === selectedIndex}
            />
          </Box>
        ))
      )}
    </Box>
  );
}
