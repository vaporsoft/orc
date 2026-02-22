import React, { useState, useEffect } from "react";
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
  renderPaused?: boolean;
}

export function SessionList({ entries, selectedIndex, focused, openBranches, mergedBranches, renderPaused }: SessionListProps) {
  const theme = useTheme();

  const columnHeaders = (
    <Box paddingX={1}>
      <Box width={2}><Text> </Text></Box>
      <Box width={28}><Text dimColor>branch</Text></Box>
      <Box width={8}><Text dimColor>pr</Text></Box>
      <Box width={16}><Text dimColor>status</Text></Box>
      <Box width={10}><Text dimColor>time left</Text></Box>
      <Box width={4}><Text dimColor>ci</Text></Box>
      <Box width={12}><Text dimColor>conflicts</Text></Box>
      <Box width={10}><Text dimColor>comments</Text></Box>
      <Box width={12}><Text dimColor>resolved</Text></Box>
      <Box width={10}><Text dimColor>cost</Text></Box>
      <Box width={10}><Text dimColor>last push</Text></Box>
    </Box>
  );

  // Tick to keep "time left" column updated — every 60s normally, every 1s in the final minute
  const activeExpiries = [...entries.values()]
    .filter((e) => e.state?.mode === "watch" && e.state.sessionExpiresAt
      && !["stopped", "ready", "error"].includes(e.state.status) && !e.mergedAt)
    .map((e) => e.state!.sessionExpiresAt!);
  const soonestExpiry = activeExpiries.length > 0 ? Math.min(...activeExpiries) : null;

  const [, setTimeLeftTick] = useState(0);
  useEffect(() => {
    if (soonestExpiry === null) return;
    const id = setInterval(() => {
      const timeLeft = soonestExpiry - Date.now();
      const nowInFinalMinute = timeLeft <= 60_000;
      const shouldTick = nowInFinalMinute || (timeLeft % 60_000 < 1_000);
      if (shouldTick) {
        setTimeLeftTick((t) => t + 1);
      }
    }, 1_000);
    return () => clearInterval(id);
  }, [soonestExpiry]);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.border}
      borderTop={false}
      borderBottom={false}
    >
      {/* Open Branches section header */}
      <Box paddingX={1}>
        <Text color={theme.accent} bold>Open Branches</Text>
      </Box>
      {columnHeaders}
      {openBranches.length === 0 ? (
        <Box paddingX={1}>
          <Text dimColor>  {entries.size === 0 ? "Discovering PRs..." : "No open PRs"}</Text>
        </Box>
      ) : (
        openBranches.map((branch, i) => (
          <SessionRow
            key={branch}
            entry={entries.get(branch)!}
            selected={focused && i === selectedIndex}
            renderPaused={renderPaused}
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
          <Text dimColor>  {entries.size === 0 ? "Discovering PRs..." : "No branches merged this session"}</Text>
        </Box>
      ) : (
        mergedBranches.map((branch) => (
          <SessionRow
            key={branch}
            entry={entries.get(branch)!}
            selected={false}
            dimmed
            renderPaused={renderPaused}
          />
        ))
      )}
    </Box>
  );
}
