import React from "react";
import { Box, Text } from "ink";

interface HelpBarProps {
  showingLogs: boolean;
  expanded: boolean;
}

function Key({ k, label }: { k: string; label: string }) {
  return (
    <Text>
      <Text color="green" bold>{k}</Text>
      <Text dimColor> {label}</Text>
    </Text>
  );
}

export function HelpBar({ showingLogs, expanded }: HelpBarProps) {
  if (!expanded) {
    return (
      <Box
        borderStyle="round"
        borderColor="green"
        borderTop={false}
        paddingX={1}
        justifyContent="center"
        gap={1}
      >
        <Key k="?" label="help" />
        <Text dimColor>·</Text>
        <Key k="q" label="quit" />
      </Box>
    );
  }

  return (
    <Box
      borderStyle="round"
      borderColor="green"
      borderTop={false}
      paddingX={1}
      justifyContent="center"
      gap={1}
    >
      <Key k="j/k" label="select" />
      <Text dimColor>·</Text>
      <Key k="enter" label="details" />
      <Text dimColor>·</Text>
      <Key k="l" label="logs" />
      <Text dimColor>·</Text>
      <Key k="s" label="start/stop" />
      <Text dimColor>·</Text>
      <Key k="r" label="retry" />
      <Text dimColor>·</Text>
      <Key k="a" label="start all" />
      <Text dimColor>·</Text>
      <Key k="x" label="stop all" />
      <Text dimColor>·</Text>
      <Key k="c" label="claude" />
      <Text dimColor>·</Text>
      <Key k="w" label="shell" />
      <Text dimColor>·</Text>
      <Key k="tab" label={showingLogs ? "hide logs" : "all logs"} />
      <Text dimColor>·</Text>
      <Key k="?" label="hide help" />
      <Text dimColor>·</Text>
      <Key k="q" label="quit" />
    </Box>
  );
}
