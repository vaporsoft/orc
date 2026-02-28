import React from "react";
import { Box, Text } from "ink";
import type { PREntry } from "../hooks/useDaemonState.js";
import type { BranchFilter } from "../../utils/settings.js";
import { useTheme } from "../theme.js";
import { formatTokens } from "../../utils/format.js";

interface HeaderProps {
  entries: Map<string, PREntry>;
  startTime: number;
  nextCheckIn: number | null;
  branchFilter: BranchFilter;
  filterFocused: boolean;
}

function formatUptime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h${minutes % 60}m`;
  return `${minutes}m`;
}

function formatCountdown(seconds: number): string {
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m${s.toString().padStart(2, "0")}s`;
  }
  return `${seconds}s`;
}

const FILTER_TABS: { key: BranchFilter; label: string }[] = [
  { key: "all", label: "All Branches" },
  { key: "mine", label: "My Branches" },
];

export function Header({ entries, startTime, nextCheckIn, branchFilter, filterFocused }: HeaderProps) {
  const theme = useTheme();
  const activeEntries = [...entries.values()].filter((e) => !e.mergedAt);
  const total = activeEntries.length;
  const running = activeEntries.filter((e) => e.state !== null).length;
  let totalCost = 0;
  let totalTokens = 0;
  for (const entry of activeEntries) {
    totalCost += entry.state?.totalCostUsd ?? 0;
    totalTokens += (entry.state?.totalInputTokens ?? 0) + (entry.state?.totalOutputTokens ?? 0);
  }
  const uptime = formatUptime(Date.now() - startTime);

  return (
    <Box
      borderStyle="round"
      borderColor={theme.border}
      borderBottom={false}
      paddingX={1}
      justifyContent="space-between"
    >
      <Box gap={1}>
        <Text backgroundColor={theme.accentBg} color={theme.textOnAccent} bold>{" "}orc{" "}</Text>
        {FILTER_TABS.map((tab) => {
          const active = tab.key === branchFilter;
          const focused = filterFocused && active;
          return (
            <Text
              key={tab.key}
              backgroundColor={focused ? theme.accentBg : undefined}
              color={active ? (focused ? theme.textOnAccent : theme.accent) : theme.muted}
              bold={active}
              dimColor={!active && !focused}
            >
              {active ? ` ${tab.label} ` : `  ${tab.label}  `}
            </Text>
          );
        })}
      </Box>
      <Text>
        <Text color={running > 0 ? theme.accent : theme.muted}>{running}</Text>
        <Text dimColor>/{total} active</Text>
        <Text color={theme.accent}> · </Text>
        <Text dimColor>${totalCost.toFixed(2)} · {formatTokens(totalTokens)} tok</Text>
        <Text color={theme.accent}> · </Text>
        <Text dimColor>{uptime}</Text>
        <Text color={theme.accent}> · </Text>
        <Text dimColor>{nextCheckIn !== null ? `next ${formatCountdown(nextCheckIn)}` : "—"}</Text>
      </Text>
    </Box>
  );
}
