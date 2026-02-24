import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme.js";
import type { DetailSection } from "./DetailPanel.js";

function Key({ k, label, accentColor }: { k: string; label: string; accentColor: string }) {
  return (
    <Text>
      <Text color={accentColor} bold>{k}</Text>
      <Text dimColor> {label}</Text>
    </Text>
  );
}

interface HelpBarProps {
  detailMode: "off" | "detail" | "logs";
  fullscreenSection: DetailSection | null;
}

export function HelpBar({ detailMode, fullscreenSection }: HelpBarProps) {
  const theme = useTheme();

  let hints: { k: string; label: string }[];

  if (fullscreenSection) {
    hints = [
      { k: "q", label: "close" },
      { k: "esc", label: "close" },
    ];
  } else if (detailMode === "logs") {
    hints = [
      { k: "l", label: "close" },
      { k: "↑↓", label: "scroll" },
      { k: "h", label: "help" },
    ];
  } else if (detailMode === "detail") {
    hints = [
      { k: "←", label: "close" },
      { k: "↑↓", label: "sections" },
      { k: "→", label: "expand" },
      { k: "enter", label: "focus" },
    ];
  } else {
    hints = [
      { k: "enter", label: "fix" },
      { k: "→", label: "details" },
      { k: "l", label: "logs" },
      { k: "h", label: "help" },
    ];
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
      {hints.map((hint, i) => (
        <React.Fragment key={hint.k + hint.label}>
          {i > 0 && <Text dimColor>·</Text>}
          <Key k={hint.k} label={hint.label} accentColor={theme.accent} />
        </React.Fragment>
      ))}
    </Box>
  );
}
