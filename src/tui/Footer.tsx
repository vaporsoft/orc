import React from "react";
import { Box, Text } from "ink";

interface FooterProps {
  mode: "table" | "detail";
  width: number;
}

export function Footer({ mode, width }: FooterProps) {
  return (
    <Box flexDirection="column">
      <Text dimColor>{"─".repeat(width)}</Text>
      <Box gap={2}>
        {mode === "table" ? (
          <>
            <Shortcut keys="jk/arrows" action="navigate" />
            <Shortcut keys="enter" action="details" />
            <Shortcut keys="r" action="refresh" />
            <Shortcut keys="o" action="open" />
            <Shortcut keys="q" action="quit" />
          </>
        ) : (
          <>
            <Shortcut keys="esc" action="back" />
            <Shortcut keys="r" action="refresh" />
            <Shortcut keys="o" action="open PR" />
            <Shortcut keys="q" action="quit" />
          </>
        )}
      </Box>
    </Box>
  );
}

function Shortcut({ keys, action }: { keys: string; action: string }) {
  return (
    <Box gap={1}>
      <Text bold color="blue">
        {keys}
      </Text>
      <Text dimColor>{action}</Text>
    </Box>
  );
}
