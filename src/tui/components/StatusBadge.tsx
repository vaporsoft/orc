import React from "react";
import { Text } from "ink";
import type { BranchStatus } from "../../types/index.js";

interface StatusBadgeProps {
  status: BranchStatus;
}

const STATUS_CONFIG: Record<BranchStatus, { symbol: string; color: string; label: string }> = {
  stopped:      { symbol: "○", color: "gray",        label: "stopped" },
  initializing: { symbol: "◌", color: "green",       label: "init" },
  listening:     { symbol: "●", color: "green",       label: "listening" },
  categorizing: { symbol: "◉", color: "yellow",      label: "sorting" },
  fixing:       { symbol: "●", color: "greenBright",  label: "fixing" },
  verifying:    { symbol: "◉", color: "cyan",        label: "verify" },
  pushing:      { symbol: "▲", color: "greenBright",  label: "pushing" },
  replying:     { symbol: "◉", color: "cyan",        label: "replying" },
  done:         { symbol: "✓", color: "green",       label: "done" },
  error:        { symbol: "✗", color: "red",         label: "error" },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  return (
    <Text color={config.color}>
      {config.symbol} {config.label}
    </Text>
  );
}
