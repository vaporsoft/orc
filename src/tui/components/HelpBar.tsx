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
  sectionFocus?: boolean;
}

export function HelpBar({ detailMode, fullscreenSection, sectionFocus = false }: HelpBarProps) {
  const theme = useTheme();

  let hints: { k: string; label: string }[];

  if (fullscreenSection === "comments") {
    hints = [
      { k: "↑↓", label: "prev/next" },
      { k: "q", label: "close" },
    ];
  } else if (fullscreenSection === "ci") {
    hints = [
      { k: "↑↓", label: "select check" },
      { k: "O", label: "open" },
      { k: "q", label: "close" },
    ];
  } else if (fullscreenSection === "conflicts") {
    hints = [
      { k: "↑↓", label: "select file" },
      { k: "enter", label: "view" },
      { k: "q", label: "close" },
    ];
  } else if (fullscreenSection) {
    hints = [
      { k: "q", label: "close" },
      { k: "esc", label: "close" },
    ];
  } else if (detailMode === "logs") {
    hints = [
      { k: "g", label: "close" },
      { k: "↑↓", label: "scroll" },
      { k: "h", label: "help" },
    ];
  } else if (detailMode === "detail" && sectionFocus) {
    hints = [
      { k: "↑↓", label: "sections" },
      { k: "enter", label: "fullscreen" },
      { k: "←", label: "branches" },
      { k: "tab", label: "close" },
      { k: "h", label: "help" },
    ];
  } else if (detailMode === "detail") {
    hints = [
      { k: "↑↓", label: "branches" },
      { k: "enter/→", label: "sections" },
      { k: "tab", label: "close" },
      { k: "h", label: "help" },
    ];
  } else {
    hints = [
      { k: "↑↓", label: "branches" },
      { k: "tab", label: "details" },
      { k: "c", label: "copy branch" },
      { k: "O", label: "view PR" },
      { k: ",", label: "settings" },
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
