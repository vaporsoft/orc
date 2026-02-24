import React, { useState, useEffect } from "react";
import { Text } from "ink";
import type { BranchStatus } from "../../types/index.js";
import { useTheme, type Theme } from "../theme.js";

interface StatusBadgeProps {
  status: BranchStatus;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const ACTIVE_STATUSES = new Set<BranchStatus>([
  "initializing",
  "triaging",
  "preparing",
  "fixing",
  "verifying",
  "pushing",
  "replying",
  "checking_ci",
]);

const STATUS_ROLES: Record<BranchStatus, { role: keyof Theme; label: string }> = {
  stopped:         { role: "muted",   label: "stopped" },
  initializing:    { role: "info",    label: "init" },
  watching:        { role: "accent",  label: "watching" },
  triaging:        { role: "info",    label: "triaging" },
  preparing:       { role: "info",    label: "preparing" },
  fixing:          { role: "info",    label: "fixing" },
  verifying:       { role: "info",    label: "verify" },
  pushing:         { role: "info",    label: "pushing" },
  replying:        { role: "info",    label: "replying" },
  ready:           { role: "accent",  label: "ready" },
  conflict_prompt: { role: "warning", label: "conflict" },
  checking_ci:     { role: "info",    label: "checking CI" },
  error:           { role: "error",   label: "error" },
  merged:          { role: "merged",  label: "merged" },
};

const STATIC_SYMBOLS: Partial<Record<BranchStatus, string>> = {
  stopped:         "○",
  watching:        "●",
  ready:           "✓",
  conflict_prompt: "!",
  error:           "✗",
  merged:          "◆",
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const theme = useTheme();
  const isActive = ACTIVE_STATUSES.has(status);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(id);
  }, [isActive]);

  const config = STATUS_ROLES[status];
  const symbol = isActive ? SPINNER_FRAMES[frame] : (STATIC_SYMBOLS[status] ?? "●");

  return (
    <Text color={theme[config.role]}>
      {symbol} {config.label}
    </Text>
  );
}
