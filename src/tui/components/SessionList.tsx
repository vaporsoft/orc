import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { PREntry } from "../hooks/useDaemonState.js";
import { SessionRow } from "./SessionRow.js";
import { useTheme } from "../theme.js";

const MERGE_SETTLE_MS = 30_000;

interface SessionListProps {
  entries: Map<string, PREntry>;
  selectedIndex: number;
  focused: boolean;
  openBranches: string[];
  mergedBranches: string[];
}

export function SessionList({ entries, selectedIndex, focused, openBranches, mergedBranches }: SessionListProps) {
  const theme = useTheme();

  // Tick every second so recently-merged rows transition after 30s
  const [, setTick] = useState(0);
  useEffect(() => {
    if (mergedBranches.length === 0) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [mergedBranches.length]);

  // Split merged branches into "recent" (< 30s, shown inline in open section)
  // and "settled" (>= 30s, shown in merged section)
  const now = Date.now();
  const recentMerged: string[] = [];
  const settledMerged: string[] = [];
  for (const branch of mergedBranches) {
    const entry = entries.get(branch);
    if (entry?.mergedAt && now - entry.mergedAt >= MERGE_SETTLE_MS) {
      settledMerged.push(branch);
    } else {
      recentMerged.push(branch);
    }
  }

  // Inline list: open branches + recently merged (still in the main section)
  const inlineBranches = [...openBranches, ...recentMerged];

  const columnHeaders = (
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
  );

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.border}
      borderTop={false}
      borderBottom={false}
    >
      {/* Open Branches section header (only show label when there are also merged branches) */}
      {settledMerged.length > 0 && (
        <Box paddingX={1}>
          <Text color={theme.accent} bold>Open Branches</Text>
        </Box>
      )}
      {columnHeaders}
      {inlineBranches.length === 0 && settledMerged.length === 0 ? (
        <Box paddingX={1}>
          <Text dimColor>  Discovering PRs...</Text>
        </Box>
      ) : (
        inlineBranches.map((branch, i) => (
          <SessionRow
            key={branch}
            entry={entries.get(branch)!}
            selected={focused && i === selectedIndex}
          />
        ))
      )}
      {inlineBranches.length === 0 && settledMerged.length > 0 && (
        <Box paddingX={1}>
          <Text dimColor>  No open PRs</Text>
        </Box>
      )}

      {/* Merged Branches section */}
      {settledMerged.length > 0 && (
        <>
          <Box paddingX={1} marginTop={1} gap={2}>
            <Text color={theme.merged} bold>Merged Branches</Text>
            <Text dimColor color={theme.muted}>
              [d] clear all
            </Text>
          </Box>
          {settledMerged.map((branch) => (
            <SessionRow
              key={branch}
              entry={entries.get(branch)!}
              selected={false}
              dimmed
            />
          ))}
        </>
      )}
    </Box>
  );
}
