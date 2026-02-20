import React from "react";
import { Box, Text } from "ink";

export function HelpBar() {
  return (
    <Box borderStyle="single" borderTop={false} paddingX={1} justifyContent="center">
      <Text dimColor>
        <Text bold>↑↓</Text> select   <Text bold>tab</Text> switch pane   <Text bold>q</Text> quit
      </Text>
    </Box>
  );
}
