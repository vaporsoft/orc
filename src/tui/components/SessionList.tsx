import React from "react";
import { Box, Text } from "ink";
import type { BranchState } from "../../types/index.js";
import { SessionRow } from "./SessionRow.js";

interface SessionListProps {
  sessions: Map<string, BranchState>;
  selectedIndex: number;
  focused: boolean;
}

export function SessionList({ sessions, selectedIndex, focused }: SessionListProps) {
  const branches = [...sessions.keys()].sort();

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
        <Box width={8}>
          <Text bold dimColor>Iter</Text>
        </Box>
        <Box width={10}>
          <Text bold dimColor>Cost</Text>
        </Box>
        <Box width={6}>
          <Text bold dimColor>Errs</Text>
        </Box>
      </Box>
      {branches.length === 0 ? (
        <Box paddingX={1}>
          <Text dimColor>No active sessions — waiting for PRs...</Text>
        </Box>
      ) : (
        branches.map((branch, i) => (
          <Box key={branch} paddingX={1}>
            <SessionRow
              state={sessions.get(branch)!}
              selected={focused && i === selectedIndex}
            />
          </Box>
        ))
      )}
    </Box>
  );
}
