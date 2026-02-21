import React from "react";
import { Box, Text } from "ink";
import type { LogEntry } from "../../utils/logger.js";
import { useTheme, type Theme } from "../theme.js";

interface LogPaneProps {
  entries: LogEntry[];
  focused: boolean;
  scrollOffset: number;
  visibleLines: number;
  label?: string;
}

function levelColors(theme: Theme): Record<string, string> {
  return {
    debug: theme.muted,
    info: theme.text,
    warn: theme.warning,
    error: theme.error,
  };
}

const LEVEL_SYMBOLS: Record<string, string> = {
  debug: "·",
  info: "│",
  warn: "▪",
  error: "✗",
};

export function LogPane({ entries, focused, scrollOffset, visibleLines, label = "Logs" }: LogPaneProps) {
  const theme = useTheme();
  const colors = levelColors(theme);
  const maxOffset = Math.max(0, entries.length - visibleLines);
  const offset = Math.min(scrollOffset, maxOffset);
  const visible = entries.slice(
    Math.max(0, entries.length - visibleLines - offset),
    entries.length - offset,
  );

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.border}
      borderTop={false}
      borderBottom={false}
    >
      <Box paddingX={1}>
        <Text color={theme.accent} dimColor>{"━━ "}</Text>
        <Text color={theme.accent} bold>{focused ? "▸ " : "  "}{label}</Text>
        <Text color={theme.accent} dimColor>{" " + "─".repeat(Math.max(0, 40 - label.length))}</Text>
      </Box>
      {visible.length === 0 ? (
        <Box paddingX={1} marginLeft={2}>
          <Text dimColor>No log entries yet</Text>
        </Box>
      ) : (
        visible.map((entry, i) => {
          const time = entry.timestamp.split("T")[1]?.slice(0, 8) ?? "";
          const sym = LEVEL_SYMBOLS[entry.level] ?? "│";
          const prefix = entry.branch ? `[${entry.branch}] ` : "";
          return (
            <Box key={i} paddingX={1} marginLeft={2}>
              <Text dimColor>{time} </Text>
              <Text color={colors[entry.level] ?? theme.text}>
                {sym} {prefix}{entry.message}
              </Text>
            </Box>
          );
        })
      )}
    </Box>
  );
}
