import React from "react";
import { Box, Text } from "ink";
import type { PREntry } from "../hooks/useDaemonState.js";
import { SessionRow } from "./SessionRow.js";
import { useTheme } from "../theme.js";

interface SessionListProps {
  entries: Map<string, PREntry>;
  selectedIndex: number;
  focused: boolean;
}

export function SessionList({ entries, selectedIndex, focused }: SessionListProps) {
  const theme = useTheme();
  const branches = [...entries.keys()].sort();

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.border}
      borderTop={false}
      borderBottom={false}
    >
      {/* Column headers */}
      <Box paddingX={1}>
        <Box width={2}><Text> </Text></Box>
        <Box width={28}><Text dimColor>branch</Text></Box>
        <Box width={8}><Text dimColor>pr</Text></Box>
        <Box width={16}><Text dimColor>status</Text></Box>
        <Box width={10}><Text dimColor>comments</Text></Box>
        <Box width={12}><Text dimColor>progress</Text></Box>
        <Box width={10}><Text dimColor>cost</Text></Box>
        <Box width={10}><Text dimColor>last push</Text></Box>
      </Box>
      {branches.length === 0 ? (
        <Box paddingX={1}>
          <Text dimColor>  Discovering PRs...</Text>
        </Box>
      ) : (
        branches.map((branch, i) => (
          <SessionRow
            key={branch}
            entry={entries.get(branch)!}
            selected={focused && i === selectedIndex}
          />
        ))
      )}
    </Box>
  );
}
