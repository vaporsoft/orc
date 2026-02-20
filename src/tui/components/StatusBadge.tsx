import React, { useState, useEffect } from "react";
import { Text } from "ink";
import type { BranchStatus } from "../../types/index.js";

interface StatusBadgeProps {
  status: BranchStatus;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const ACTIVE_STATUSES = new Set<BranchStatus>([
  "initializing",
  "categorizing",
  "fixing",
  "verifying",
  "pushing",
  "replying",
]);

const STATUS_CONFIG: Record<BranchStatus, { color: string; label: string }> = {
  stopped:      { color: "gray",        label: "stopped" },
  initializing: { color: "green",       label: "init" },
  listening:    { color: "green",       label: "listening" },
  categorizing: { color: "yellow",      label: "sorting" },
  fixing:       { color: "greenBright", label: "fixing" },
  verifying:    { color: "cyan",        label: "verify" },
  pushing:      { color: "greenBright", label: "pushing" },
  replying:     { color: "cyan",        label: "replying" },
  done:         { color: "green",       label: "done" },
  error:        { color: "red",         label: "error" },
};

const STATIC_SYMBOLS: Partial<Record<BranchStatus, string>> = {
  stopped:   "○",
  listening: "●",
  done:      "✓",
  error:     "✗",
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const isActive = ACTIVE_STATUSES.has(status);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(id);
  }, [isActive]);

  const config = STATUS_CONFIG[status];
  const symbol = isActive ? SPINNER_FRAMES[frame] : (STATIC_SYMBOLS[status] ?? "●");

  return (
    <Text color={config.color}>
      {symbol} {config.label}
    </Text>
  );
}
