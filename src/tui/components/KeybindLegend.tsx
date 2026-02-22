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
        { key: "↑/↓", label: "Scroll / navigate" },
        { key: "enter", label: "Toggle details" },
        { key: "↑/↓", label: "Navigate sections (in detail)" },
        { key: "space", label: "Collapse/expand section" },
        { key: "l", label: "Branch logs" },
        { key: "tab", label: showingLogs ? "Hide all logs" : "All logs" },
      ],
    },
    {
      title: "Actions",
      binds: [
        { key: "s", label: "Start / stop" },
        { key: "w", label: "Watch" },
        { key: "a", label: "Start all" },
        { key: "x", label: "Stop all" },
        { key: "r", label: "Rebase" },
        { key: "d", label: "Clear merged" },
      ],
    },
    {
      title: "Tools",
      binds: [
        { key: "c", label: "Resume Claude" },
        { key: "e", label: "Open shell" },
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
