import React from "react";
import { Box, Text } from "ink";
import type { PREntry } from "../hooks/useDaemonState.js";

interface HeaderProps {
  entries: Map<string, PREntry>;
  startTime: number;
  lastCheck: string | null;
}

function formatUptime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

function formatCheckTime(iso: string): string {
  return iso.split("T")[1]?.slice(0, 8) ?? iso;
}

export function Header({ entries, startTime, lastCheck }: HeaderProps) {
  const total = entries.size;
  const running = [...entries.values()].filter((e) => e.state !== null).length;
  let totalCost = 0;
  for (const entry of entries.values()) {
    totalCost += entry.state?.totalCostUsd ?? 0;
  }
  const uptime = formatUptime(Date.now() - startTime);

  return (
    <Box borderStyle="single" borderBottom={false} paddingX={1} justifyContent="space-between">
      <Text bold color="cyan">Orc</Text>
      <Text>
        <Text dimColor>{running}/{total} active</Text>
        {"   "}
        <Text dimColor>${totalCost.toFixed(2)} total</Text>
        {"   "}
        <Text dimColor>up {uptime}</Text>
        {"   "}
        <Text dimColor>last check {lastCheck ? formatCheckTime(lastCheck) : "—"}</Text>
      </Text>
    </Box>
  );
}
