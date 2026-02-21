import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme.js";

interface ActivityPaneProps {
  lines: string[];
  branch: string;
}

export function ActivityPane({ lines, branch }: ActivityPaneProps) {
  const theme = useTheme();

  if (lines.length === 0) return null;

  return (
    <Box
      borderStyle="round"
      borderColor={theme.border}
      borderTop={false}
      borderBottom={false}
      paddingX={1}
      flexDirection="column"
    >
      <Text color={theme.accent} dimColor>
        {"━━ "}
        <Text color={theme.accent} bold>Claude</Text>
        {" "}
        <Text dimColor>[{branch}]</Text>
      </Text>
      {lines.map((line, i) => (
        <Box key={i} marginLeft={2}>
          <Text dimColor={i < lines.length - 1} color={i === lines.length - 1 ? theme.text : undefined}>
            {line}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
