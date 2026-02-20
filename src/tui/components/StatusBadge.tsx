import React from "react";
import { Text } from "ink";
import type { BranchStatus } from "../../types/index.js";

interface StatusBadgeProps {
  status: BranchStatus;
}

const STATUS_CONFIG: Record<BranchStatus, { symbol: string; color: string }> = {
  stopped: { symbol: "○", color: "gray" },
  initializing: { symbol: "◌", color: "yellow" },
  awaiting: { symbol: "◉", color: "blue" },
  categorizing: { symbol: "◉", color: "magenta" },
  fixing: { symbol: "●", color: "green" },
  verifying: { symbol: "◉", color: "cyan" },
  pushing: { symbol: "▲", color: "green" },
  replying: { symbol: "◉", color: "cyan" },
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
