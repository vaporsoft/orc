import React from "react";
import { Text } from "ink";
import type { BranchStatus } from "../../types/index.js";

interface StatusBadgeProps {
  status: BranchStatus;
}

const STATUS_CONFIG: Record<BranchStatus, { symbol: string; color: string }> = {
  initializing: { symbol: "◌", color: "yellow" },
  polling: { symbol: "○", color: "blue" },
  debouncing: { symbol: "◌", color: "cyan" },
  analyzing: { symbol: "◉", color: "magenta" },
  fixing: { symbol: "●", color: "green" },
  pushing: { symbol: "▲", color: "green" },
  paused: { symbol: "‖", color: "yellow" },
  done: { symbol: "✓", color: "gray" },
  error: { symbol: "✗", color: "red" },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  return (
    <Text color={config.color}>
      {config.symbol} {status}
    </Text>
  );
}
