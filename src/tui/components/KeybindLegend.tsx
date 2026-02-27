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
      title: "navigation",
      binds: [
        { key: "↑/↓ or k/j", label: "select branch / navigate sections" },
        { key: "tab", label: "toggle detail panel" },
        { key: "enter", label: "focus sections / fullscreen" },
        { key: "→ or l", label: "focus sections" },
        { key: "← or ;", label: "back to branches / exit fullscreen" },
        { key: "q/esc", label: "exit fullscreen" },
        { key: "g", label: "branch logs (toggle)" },
        { key: "G", label: showingLogs ? "hide all logs" : "all logs" },
      ],
    },
    {
      title: "actions",
      binds: [
        { key: "+", label: "add branch" },
        { key: "c", label: "copy branch name" },
        { key: "C", label: "checkout branch" },
        { key: "u", label: "copy PR URL" },
        { key: "o", label: "view PR / CI check in browser" },
        { key: "x", label: "stop" },
        { key: "X", label: "stop all" },
        { key: "d", label: "clear merged" },
      ],
    },
    {
      title: "tools",
      binds: [
        { key: "t", label: "toggle theme" },
        { key: ",", label: "settings" },
        { key: "h", label: "this help" },
        { key: "q", label: "quit" },
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
          {"━━ keybindings ━━"}
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
