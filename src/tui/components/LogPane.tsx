import React from "react";
import { Box, Text } from "ink";
import type { LogEntry } from "../../utils/logger.js";

interface LogPaneProps {
  entries: LogEntry[];
  focused: boolean;
  scrollOffset: number;
  visibleLines: number;
}

const LEVEL_COLORS: Record<string, string> = {
  debug: "gray",
  info: "white",
  warn: "yellow",
  error: "red",
};

export function LogPane({ entries, focused, scrollOffset, visibleLines }: LogPaneProps) {
  const maxOffset = Math.max(0, entries.length - visibleLines);
  const offset = Math.min(scrollOffset, maxOffset);
  const visible = entries.slice(
    Math.max(0, entries.length - visibleLines - offset),
    entries.length - offset,
  );

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderTop={false}
      borderBottom={false}
    >
      <Box paddingX={1}>
        <Text bold dimColor>{focused ? "▶ " : ""}Logs</Text>
      </Box>
      {visible.length === 0 ? (
        <Box paddingX={1}>
          <Text dimColor>No log entries yet</Text>
        </Box>
      ) : (
        visible.map((entry, i) => {
          const time = entry.timestamp.split("T")[1]?.slice(0, 8) ?? "";
          const level = entry.level.toUpperCase().padEnd(5);
          const prefix = entry.branch ? `[${entry.branch}]` : "";
          return (
            <Box key={i} paddingX={1}>
              <Text color={LEVEL_COLORS[entry.level] ?? "white"}>
                {time} {level} {prefix} {entry.message}
              </Text>
            </Box>
          );
        })
      )}
    </Box>
  );
}
