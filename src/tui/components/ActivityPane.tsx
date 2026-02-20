import React from "react";
import { Box, Text } from "ink";

interface ActivityPaneProps {
  lines: string[];
  branch: string;
}

export function ActivityPane({ lines, branch }: ActivityPaneProps) {
  if (lines.length === 0) return null;

  return (
    <Box
      borderStyle="round"
      borderColor="green"
      borderTop={false}
      borderBottom={false}
      paddingX={1}
      flexDirection="column"
    >
      <Text color="green" dimColor>
        {"━━ "}
        <Text color="green" bold>Claude</Text>
        {" "}
        <Text dimColor>[{branch}]</Text>
      </Text>
      {lines.map((line, i) => (
        <Box key={i} marginLeft={2}>
          <Text dimColor={i < lines.length - 1} color={i === lines.length - 1 ? "white" : undefined}>
            {line}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
