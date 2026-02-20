import React from "react";
import { Box, Text } from "ink";
import type { BranchState } from "../../types/index.js";

interface HeaderProps {
  sessions: Map<string, BranchState>;
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

export function Header({ sessions, startTime, lastCheck }: HeaderProps) {
  const count = sessions.size;
  let totalCost = 0;
  for (const state of sessions.values()) {
    totalCost += state.totalCostUsd;
  }
  const uptime = formatUptime(Date.now() - startTime);

  return (
    <Box borderStyle="single" borderBottom={false} paddingX={1} justifyContent="space-between">
      <Text bold color="cyan">PR Pilot</Text>
      <Text>
        <Text dimColor>{count} session{count !== 1 ? "s" : ""}</Text>
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
