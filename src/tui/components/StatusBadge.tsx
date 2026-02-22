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
  "categorizing",
  "fixing",
  "verifying",
  "pushing",
  "replying",
]);

const STATUS_ROLES: Record<BranchStatus, { role: keyof Theme; label: string }> = {
  stopped:         { role: "muted",   label: "stopped" },
  initializing:    { role: "info",    label: "init" },
  listening:       { role: "accent",  label: "watching" },
  categorizing:    { role: "info",    label: "triaging" },
  fixing:          { role: "info",    label: "fixing" },
  verifying:       { role: "info",    label: "verify" },
  pushing:         { role: "info",    label: "pushing" },
  replying:        { role: "info",    label: "replying" },
  ready:           { role: "accent",  label: "ready" },
  conflict_prompt: { role: "warning", label: "conflict" },
  error:           { role: "error",   label: "error" },
  merged:          { role: "merged",  label: "merged" },
};

const STATIC_SYMBOLS: Partial<Record<BranchStatus, string>> = {
  stopped:         "○",
  listening:       "●",
  ready:           "✓",
  conflict_prompt: "!",
  error:           "✗",
  merged:          "◆",
};

export function StatusBadge({ status, paused }: StatusBadgeProps & { paused?: boolean }) {
  const theme = useTheme();
  const isActive = ACTIVE_STATUSES.has(status);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!isActive || paused) return;
    const id = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(id);
  }, [isActive, paused]);

  const config = STATUS_ROLES[status];
  const symbol = isActive ? SPINNER_FRAMES[frame] : (STATIC_SYMBOLS[status] ?? "●");

  return (
    <Text color={theme[config.role]}>
      {symbol} {config.label}
    </Text>
  );
}
