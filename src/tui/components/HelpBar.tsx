import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme.js";

interface HelpBarProps {
  showingLogs: boolean;
  expanded: boolean;
}

function Key({ k, label, accentColor }: { k: string; label: string; accentColor: string }) {
  return (
    <Text>
      <Text color={accentColor} bold>{k}</Text>
      <Text dimColor> {label}</Text>
    </Text>
  );
}

export function HelpBar({ showingLogs, expanded }: HelpBarProps) {
  const theme = useTheme();

  if (!expanded) {
    return (
      <Box
        borderStyle="round"
        borderColor={theme.border}
        borderTop={false}
        paddingX={1}
        justifyContent="center"
        gap={1}
      >
        <Key k="t" label="theme" accentColor={theme.accent} />
        <Text dimColor>·</Text>
        <Key k="?" label="help" accentColor={theme.accent} />
        <Text dimColor>·</Text>
        <Key k="q" label="quit" accentColor={theme.accent} />
      </Box>
    );
  }

  return (
    <Box
      borderStyle="round"
      borderColor={theme.border}
      borderTop={false}
      paddingX={1}
      justifyContent="center"
      gap={1}
    >
      <Key k="j/k" label="select" accentColor={theme.accent} />
      <Text dimColor>·</Text>
      <Key k="s" label="start/stop" accentColor={theme.accent} />
      <Text dimColor>·</Text>
      <Key k="e" label="watch" accentColor={theme.accent} />
      <Text dimColor>·</Text>
      <Key k="r" label="retry" accentColor={theme.accent} />
      <Text dimColor>·</Text>
      <Key k="enter" label="details" accentColor={theme.accent} />
      <Text dimColor>·</Text>
      <Key k="l" label="logs" accentColor={theme.accent} />
      <Text dimColor>·</Text>
      <Key k="c" label="claude" accentColor={theme.accent} />
      <Text dimColor>·</Text>
      <Key k="w" label="shell" accentColor={theme.accent} />
      <Text dimColor>·</Text>
      <Key k="tab" label={showingLogs ? "hide logs" : "all logs"} accentColor={theme.accent} />
      <Text dimColor>·</Text>
      <Key k="t" label="theme" accentColor={theme.accent} />
      <Text dimColor>·</Text>
      <Key k="?" label="hide help" accentColor={theme.accent} />
      <Text dimColor>·</Text>
      <Key k="q" label="quit" accentColor={theme.accent} />
    </Box>
  );
}
