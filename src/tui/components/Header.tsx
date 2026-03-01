import React from "react";
import { Box, Text } from "ink";
import type { BranchFilter } from "../../utils/settings.js";
import { useTheme } from "../theme.js";

interface HeaderProps {
  nextCheckIn: number | null;
  branchFilter: BranchFilter;
  filterFocused: boolean;
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

export function Header({ nextCheckIn, branchFilter, filterFocused }: HeaderProps) {
  const theme = useTheme();

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
        <Text dimColor>[+] add branch</Text>
      </Box>
      <Text>
        <Text dimColor>{nextCheckIn !== null ? `next ${formatCountdown(nextCheckIn)}` : "—"}</Text>
      </Text>
    </Box>
  );
}
