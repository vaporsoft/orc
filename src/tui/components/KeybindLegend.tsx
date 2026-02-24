import React from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../theme.js";

interface KeybindLegendProps {
  showingLogs: boolean;
  onClose: () => void;
}

interface KeybindGroup {
  title: string;
  binds: { key: string; label: string }[];
}

function getGroups(showingLogs: boolean): KeybindGroup[] {
  return [
    {
      title: "Navigation",
      binds: [
        { key: "j/k", label: "Select PR" },
        { key: "→", label: "Open details / expand section" },
        { key: "←", label: "Close details / collapse section" },
        { key: "↑/↓", label: "Navigate sections (in detail)" },
        { key: "enter", label: "Fullscreen section (in detail)" },
        { key: "q/esc", label: "Exit fullscreen section" },
        { key: "l", label: "Branch logs (toggle)" },
        { key: "tab", label: showingLogs ? "Hide all logs" : "All logs" },
      ],
    },
    {
      title: "Actions",
      binds: [
        { key: "+", label: "Add branch" },
        { key: "enter", label: "Fix + Address" },
        { key: "⇧ enter", label: "Fix + Address all" },
        { key: "F", label: "Fix CI all" },
        { key: "A", label: "Address all" },
        { key: "x", label: "Stop" },
        { key: "X", label: "Stop all" },
        { key: "w", label: "Watch" },
        { key: "d", label: "Clear merged" },
      ],
    },
    {
      title: "Tools",
      binds: [
        { key: "e", label: "Open shell" },
        { key: "E", label: "Resume Claude" },
        { key: "t", label: "Toggle theme" },
        { key: ",", label: "Settings" },
      ],
    },
  ];
}

export function KeybindLegend({ showingLogs, onClose }: KeybindLegendProps) {
  const theme = useTheme();
  const groups = getGroups(showingLogs);

  useInput((input, key) => {
    if (key.escape || input === "h" || input === "q") {
      onClose();
      return;
    }
  });

  // Find the longest key string for alignment
  const maxKeyLen = Math.max(
    ...groups.flatMap((g) => g.binds.map((b) => b.key.length)),
  );

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.accent}
      paddingX={2}
      paddingY={1}
    >
      <Box justifyContent="center" marginBottom={1}>
        <Text color={theme.accent} bold>
          {"━━ Keybindings ━━"}
        </Text>
      </Box>

      {groups.map((group, gi) => (
        <Box key={group.title} flexDirection="column" marginBottom={gi < groups.length - 1 ? 1 : 0}>
          <Text color={theme.text} bold dimColor>
            {group.title}
          </Text>
          {group.binds.map((bind, i) => (
            <Box key={`${bind.key}-${i}`}>
              <Text>{"  "}</Text>
              <Text color={theme.accent} bold>
                {bind.key.padEnd(maxKeyLen + 1)}
              </Text>
              <Text color={theme.muted}>{bind.label}</Text>
            </Box>
          ))}
        </Box>
      ))}

      <Box marginTop={1} justifyContent="center">
        <Text dimColor>
          <Text color={theme.accent}>h</Text> close  <Text color={theme.accent}>esc</Text> close
        </Text>
      </Box>
    </Box>
  );
}
