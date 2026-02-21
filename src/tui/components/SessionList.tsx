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
  renderPaused?: boolean;
}

export function SessionList({ entries, selectedIndex, focused, openBranches, mergedBranches, renderPaused }: SessionListProps) {
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
      <Box width={10}><Text dimColor>time left</Text></Box>
      <Box width={4}><Text dimColor>ci</Text></Box>
      <Box width={10}><Text dimColor>comments</Text></Box>
      <Box width={12}><Text dimColor>progress</Text></Box>
      <Box width={10}><Text dimColor>cost</Text></Box>
      <Box width={10}><Text dimColor>last push</Text></Box>
    </Box>
  );

  // Tick to keep "time left" column updated — every 60s normally, every 1s in the final minute
  const activeExpiries = [...entries.values()]
    .filter((e) => e.state?.mode === "watch" && e.state.sessionExpiresAt
      && !["stopped", "done", "error"].includes(e.state.status) && !e.mergedAt)
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
            renderPaused={renderPaused}
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
              renderPaused={renderPaused}
            />
          ))}
        </>
      )}
    </Box>
  );
}
