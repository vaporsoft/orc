import React from "react";
import { Box, Text } from "ink";

interface HelpBarProps {
  showingLogs: boolean;
}

export function HelpBar({ showingLogs }: HelpBarProps) {
  return (
    <Box borderStyle="single" borderTop={false} paddingX={1} justifyContent="center">
      <Text dimColor>
        <Text bold>j/k</Text> select   <Text bold>↑↓</Text> scroll   <Text bold>s</Text> start/stop   <Text bold>enter</Text> details   <Text bold>a</Text> start all   <Text bold>x</Text> stop all   <Text bold>tab</Text> {showingLogs ? "hide logs" : "show logs"}   <Text bold>r</Text> refresh   <Text bold>q</Text> quit
      </Text>
    </Box>
  );
}
