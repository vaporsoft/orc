import React from "react";
import { Box, Text } from "ink";
import type { PREntry } from "../hooks/useDaemonState.js";
import { SessionRow } from "./SessionRow.js";
import { useTheme } from "../theme.js";

interface SessionListProps {
  entries: Map<string, PREntry>;
  selectedIndex: number;
  focused: boolean;
  openBranches: string[];
  mergedBranches: string[];
  /** True while the daemon's initial PR discovery is still in progress. */
  isDiscovering?: boolean;
}

export function SessionList({ entries, selectedIndex, focused, openBranches, mergedBranches, isDiscovering }: SessionListProps) {
  const theme = useTheme();

  const columnHeaders = (
    <Box paddingX={1}>
      <Box width={2}><Text> </Text></Box>
      <Box width={28}><Text dimColor>branch</Text></Box>
      <Box width={8}><Text dimColor>pr</Text></Box>
      <Box width={16}><Text dimColor>status</Text></Box>
      <Box width={16}><Text dimColor>diff</Text></Box>
      <Box width={4}><Text dimColor>ci</Text></Box>
      <Box width={8}><Text dimColor>review</Text></Box>
      <Box width={12}><Text dimColor>conflicts</Text></Box>
      <Box width={10}><Text dimColor>comments</Text></Box>
      <Box width={12}><Text dimColor>addressable</Text></Box>
      <Box width={12}><Text dimColor>resolved</Text></Box>
    </Box>
  );

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.border}
      borderTop={false}
      borderBottom={false}
    >
      {/* Open Branches section header */}
      <Box paddingX={1} gap={2}>
        <Text color={theme.accent} bold>Open Branches</Text>
      </Box>
      {columnHeaders}
      {openBranches.length === 0 ? (
        <Box paddingX={1}>
          <Text dimColor>  {isDiscovering ? "Discovering PRs..." : "No open PRs"}</Text>
        </Box>
      ) : (
        openBranches.map((branch, i) => (
          <SessionRow
            key={branch}
            entry={entries.get(branch)!}
            selected={focused && i === selectedIndex}
          />
        ))
      )}

      {/* Merged Branches section */}
      <Box paddingX={1} marginTop={1} gap={2}>
        <Text color={theme.merged} bold>Merged Branches</Text>
        {mergedBranches.length > 0 && (
          <Text dimColor color={theme.muted}>
            [d] clear all
          </Text>
        )}
      </Box>
      {mergedBranches.length === 0 ? (
        <Box paddingX={1}>
          <Text dimColor>  {isDiscovering ? "Discovering PRs..." : "No branches merged this session"}</Text>
        </Box>
      ) : (
        mergedBranches.map((branch) => (
          <SessionRow
            key={branch}
            entry={entries.get(branch)!}
            selected={false}
            dimmed
          />
        ))
      )}
    </Box>
  );
}
