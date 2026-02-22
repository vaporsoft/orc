import React from "react";
import { Box, Text } from "ink";
import type { PREntry } from "../hooks/useDaemonState.js";
import type { ToolbarButton } from "./Toolbar.js";
import { useTheme } from "../theme.js";
import { formatTokens } from "../../utils/format.js";

interface HeaderProps {
  entries: Map<string, PREntry>;
  startTime: number;
  nextCheckIn: number | null;
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

function formatCountdown(seconds: number): string {
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m${s.toString().padStart(2, "0")}s`;
  }
  return `${seconds}s`;
}

export function Header({ entries, startTime, nextCheckIn, buttons, selectedButton }: HeaderProps) {
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
        <Text dimColor>${totalCost.toFixed(2)} · {formatTokens(totalTokens)} tok</Text>
        <Text color={theme.accent}> · </Text>
        <Text dimColor>{uptime}</Text>
        <Text color={theme.accent}> · </Text>
        <Text dimColor>{nextCheckIn !== null ? `next ${formatCountdown(nextCheckIn)}` : "—"}</Text>
      </Text>
    </Box>
  );
}
