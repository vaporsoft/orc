import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme.js";

function Key({ k, label, accentColor }: { k: string; label: string; accentColor: string }) {
  return (
    <Text>
      <Text color={accentColor} bold>{k}</Text>
      <Text dimColor> {label}</Text>
    </Text>
  );
}

export function HelpBar() {
  const theme = useTheme();

  return (
    <Box
      borderStyle="round"
      borderColor={theme.border}
      borderTop={false}
      paddingX={1}
      justifyContent="center"
      gap={1}
    >
      <Key k="," label="settings" accentColor={theme.accent} />
      <Text dimColor>·</Text>
      <Key k="h" label="help" accentColor={theme.accent} />
      <Text dimColor>·</Text>
      <Key k="q" label="quit" accentColor={theme.accent} />
    </Box>
  );
}
