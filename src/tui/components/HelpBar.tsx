import React from "react";
import { Box, Text } from "ink";

interface HelpBarProps {
  showingLogs: boolean;
}

export function HelpBar({ showingLogs }: HelpBarProps) {
  return (
    <Box borderStyle="single" borderTop={false} paddingX={1} justifyContent="center">
      <Text dimColor>
        <Text bold>↑↓</Text> select   <Text bold>enter</Text> start/stop   <Text bold>A</Text> start all   <Text bold>X</Text> stop all   <Text bold>tab</Text> {showingLogs ? "hide logs" : "show logs"}   <Text bold>R</Text> refresh   <Text bold>q</Text> quit
      </Text>
    </Box>
  );
}
