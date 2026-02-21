import React from "react";
import { Box, Text } from "ink";
import type { PREntry } from "../hooks/useDaemonState.js";
import type { ToolbarButton } from "./Toolbar.js";
import { useTheme } from "../theme.js";

interface HeaderProps {
  entries: Map<string, PREntry>;
  startTime: number;
  lastCheck: string | null;
  buttons: ToolbarButton[];
  selectedButton: number;
}

function formatUptime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h${minutes % 60}m`;
  return `${minutes}m`;
}

function formatCheckTime(iso: string): string {
  return iso.split("T")[1]?.slice(0, 8) ?? iso;
}

export function Header({ entries, startTime, lastCheck, buttons, selectedButton }: HeaderProps) {
  const theme = useTheme();
  const activeEntries = [...entries.values()].filter((e) => !e.mergedAt);
  const total = activeEntries.length;
  const running = activeEntries.filter((e) => e.state !== null).length;
  let totalCost = 0;
  for (const entry of activeEntries) {
    totalCost += entry.state?.totalCostUsd ?? 0;
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
        {buttons.map((btn, i) => (
          <Text
            key={btn.label}
            backgroundColor={i === selectedButton ? theme.accentBg : undefined}
            color={i === selectedButton ? theme.textOnAccent : undefined}
            dimColor={i !== selectedButton}
            bold={i === selectedButton}
          >
            {i === selectedButton ? ` ${btn.label} ` : `  ${btn.label}  `}
          </Text>
        ))}
      </Box>
      <Text>
        <Text color={running > 0 ? theme.accent : theme.muted}>{running}</Text>
        <Text dimColor>/{total} active</Text>
        <Text color={theme.accent}> · </Text>
        <Text dimColor>${totalCost.toFixed(2)}</Text>
        <Text color={theme.accent}> · </Text>
        <Text dimColor>{uptime}</Text>
        <Text color={theme.accent}> · </Text>
        <Text dimColor>{lastCheck ? formatCheckTime(lastCheck) : "—"}</Text>
      </Text>
    </Box>
  );
}
