import React, { useState, useCallback, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme, useThemeContext } from "../theme.js";
import { loadSettings, saveSettings, type UserSettings, type BranchFilter } from "../../utils/settings.js";
import type { Daemon } from "../../core/daemon.js";

interface SettingsPanelProps {
  daemon: Daemon;
  onClose: () => void;
}

const DURATION_OPTIONS = ["unlimited", "1h", "3h", "6h", "12h"];
const DURATION_TO_HOURS: Record<string, number> = {
  unlimited: 0,
  "1h": 1,
  "3h": 3,
  "6h": 6,
  "12h": 12,
};
const HOURS_TO_DURATION: Record<number, string> = {
  0: "unlimited",
  1: "1h",
  3: "3h",
  6: "6h",
  12: "12h",
};

interface SettingDef {
  key: string;
  label: string;
  type: "enum" | "number";
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  get: (settings: UserSettings, daemon: Daemon) => string;
  apply: (value: string, daemon: Daemon) => void;
}

const SETTINGS: SettingDef[] = [
  {
    key: "theme",
    label: "Theme",
    type: "enum",
    options: ["dark", "light"],
    get: (_s, daemon) => daemon.getConfig().theme,
    apply: (_value, _daemon) => {
      // Theme is handled by ThemeProvider via toggleTheme, not here
    },
  },
  {
    key: "autoResolveConflicts",
    label: "Auto-resolve conflicts",
    type: "enum",
    options: ["ask", "always", "never"],
    get: (s) => {
      const v = s.autoResolveConflicts;
      // backward compat: true -> "always", false/undefined -> "ask"
      if (v === true as unknown) return "always";
      if (v === false as unknown || v === undefined) return "ask";
      return v;
    },
    apply: (value, _daemon) => {
      saveSettings({ autoResolveConflicts: value as "always" | "ask" | "never" });
    },
  },
  {
    key: "pollInterval",
    label: "Poll interval (seconds)",
    type: "number",
    min: 5,
    max: 300,
    step: 5,
    get: (s, daemon) => String(s.pollInterval ?? daemon.getConfig().pollInterval),
    apply: (value, daemon) => {
      const n = parseInt(value, 10);
      saveSettings({ pollInterval: n });
      daemon.updateConfig({ pollInterval: n });
    },
  },
  {
    key: "claudeTimeout",
    label: "Claude timeout (seconds)",
    type: "number",
    min: 60,
    max: 3600,
    step: 60,
    get: (s, daemon) => String(s.claudeTimeout ?? daemon.getConfig().claudeTimeout),
    apply: (value, daemon) => {
      const n = parseInt(value, 10);
      saveSettings({ claudeTimeout: n });
      daemon.updateConfig({ claudeTimeout: n });
    },
  },
  {
    key: "sessionTimeout",
    label: "Watch mode duration",
    type: "enum",
    options: DURATION_OPTIONS,
    get: (s, daemon) => {
      const hours = s.sessionTimeout ?? daemon.getConfig().sessionTimeout;
      return HOURS_TO_DURATION[hours] ?? "unlimited";
    },
    apply: (value, daemon) => {
      const hours = DURATION_TO_HOURS[value] ?? 0;
      saveSettings({ sessionTimeout: hours });
      daemon.updateConfig({ sessionTimeout: hours });
    },
  },
  {
    key: "notifications",
    label: "Desktop notifications",
    type: "enum",
    options: ["on", "off"],
    get: (s) => (s.notifications ?? true) ? "on" : "off",
    apply: (value, daemon) => {
      saveSettings({ notifications: value === "on" });
      daemon.refreshNotificationSettings();
    },
  },
  {
    key: "maxConcurrentSessions",
    label: "Max concurrent sessions",
    type: "enum",
    options: ["5", "10", "15", "20"],
    get: (s) => {
      const n = s.maxConcurrentSessions ?? 10;
      // Map legacy values to nearest valid option (migration is handled in useEffect)
      if (n <= 7) return "5";
      if (n <= 12) return "10";
      if (n <= 17) return "15";
      return "20";
    },
    apply: (value, _daemon) => {
      const n = parseInt(value, 10);
      saveSettings({ maxConcurrentSessions: n });
    },
  },
  {
    key: "defaultBranchFilter",
    label: "Default branch filter",
    type: "enum",
    options: ["all", "mine"],
    get: (s) => s.defaultBranchFilter ?? "all",
    apply: (value, _daemon) => {
      saveSettings({ defaultBranchFilter: value as BranchFilter });
    },
  },
];

export function SettingsPanel({ daemon, onClose }: SettingsPanelProps) {
  const theme = useTheme();
  const { mode, toggleTheme } = useThemeContext();
  const [selectedRow, setSelectedRow] = useState(0);
  const [settings, setSettings] = useState<UserSettings>(() => loadSettings() ?? { theme: mode });

  // One-time migration for legacy maxConcurrentSessions values
  useEffect(() => {
    const n = settings.maxConcurrentSessions ?? 10;
    const validOptions = [5, 10, 15, 20];
    if (!validOptions.includes(n)) {
      // Map legacy value to nearest valid option
      let mapped: number;
      if (n <= 7) mapped = 5;
      else if (n <= 12) mapped = 10;
      else if (n <= 17) mapped = 15;
      else mapped = 20;
      saveSettings({ maxConcurrentSessions: mapped });
      setSettings(loadSettings() ?? { theme: mode });
    }
  }, []);

  const getCurrentValue = useCallback(
    (def: SettingDef): string => {
      if (def.key === "theme") return mode;
      return def.get(settings, daemon);
    },
    [settings, daemon, mode],
  );

  const cycleEnum = useCallback(
    (def: SettingDef, direction: 1 | -1) => {
      if (def.key === "theme") {
        toggleTheme();
        return;
      }
      const opts = def.options!;
      const current = getCurrentValue(def);
      const idx = opts.indexOf(current);
      const next = opts[(idx + direction + opts.length) % opts.length]!;
      def.apply(next, daemon);
      setSettings(loadSettings() ?? { theme: mode });
    },
    [daemon, getCurrentValue, mode, toggleTheme],
  );

  const adjustNumber = useCallback(
    (def: SettingDef, direction: 1 | -1) => {
      const current = parseInt(getCurrentValue(def), 10);
      const step = def.step ?? 1;
      const next = Math.max(def.min ?? 0, Math.min(def.max ?? Infinity, current + step * direction));
      def.apply(String(next), daemon);
      setSettings(loadSettings() ?? { theme: mode });
    },
    [daemon, getCurrentValue, mode],
  );

  useInput((input, key) => {
    if (key.escape || input === "," || input === "q") {
      onClose();
      return;
    }

    if (key.upArrow || input === "k") {
      setSelectedRow((prev) => Math.max(0, prev - 1));
      return;
    }

    if (key.downArrow || input === "j") {
      setSelectedRow((prev) => Math.min(SETTINGS.length - 1, prev + 1));
      return;
    }

    const def = SETTINGS[selectedRow]!;

    if (key.leftArrow || input === "h") {
      if (def.type === "enum") cycleEnum(def, -1);
      else adjustNumber(def, -1);
      return;
    }

    if (key.rightArrow || input === "l" || key.return) {
      if (def.type === "enum") cycleEnum(def, 1);
      else adjustNumber(def, 1);
      return;
    }
  });

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
          {"━━ Settings ━━"}
        </Text>
      </Box>

      {SETTINGS.map((def, i) => {
        const selected = i === selectedRow;
        const value = getCurrentValue(def);

        return (
          <Box key={def.key}>
            <Text color={selected ? theme.accent : theme.muted}>
              {selected ? " ▸ " : "   "}
            </Text>
            <Text color={selected ? theme.text : theme.muted} bold={selected}>
              {def.label.padEnd(28)}
            </Text>
            {def.type === "enum" ? (
              <EnumValue
                options={def.options!}
                current={value}
                selected={selected}
                accentColor={theme.accent}
                textColor={theme.text}
                mutedColor={theme.muted}
              />
            ) : (
              <NumberValue
                value={value}
                selected={selected}
                accentColor={theme.accent}
                textColor={theme.text}
              />
            )}
          </Box>
        );
      })}

      <Box marginTop={1} justifyContent="center">
        <Text dimColor>
          <Text color={theme.accent}>j/k</Text> navigate  <Text color={theme.accent}>←/→</Text> change  <Text color={theme.accent}>esc</Text> close
        </Text>
      </Box>
    </Box>
  );
}

function EnumValue({
  options,
  current,
  selected,
  accentColor,
  textColor,
  mutedColor,
}: {
  options: string[];
  current: string;
  selected: boolean;
  accentColor: string;
  textColor: string;
  mutedColor: string;
}) {
  return (
    <Box gap={1}>
      {options.map((opt) => {
        const active = opt === current;
        return (
          <Text
            key={opt}
            color={active ? (selected ? accentColor : textColor) : mutedColor}
            bold={active}
            dimColor={!active}
          >
            {active ? `[${opt}]` : ` ${opt} `}
          </Text>
        );
      })}
    </Box>
  );
}

function NumberValue({
  value,
  selected,
  accentColor,
  textColor,
}: {
  value: string;
  selected: boolean;
  accentColor: string;
  textColor: string;
}) {
  return (
    <Box>
      {selected && <Text color={accentColor}>{"◂ "}</Text>}
      <Text color={selected ? accentColor : textColor} bold={selected}>
        {value}
      </Text>
      {selected && <Text color={accentColor}>{" ▸"}</Text>}
    </Box>
  );
}
