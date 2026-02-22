import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export type Terminal =
  | "ghostty"
  | "iterm2"
  | "terminal"
  | "kitty"
  | "wezterm"
  | "alacritty";

export interface UserSettings {
  theme: "dark" | "light";
  terminal?: Terminal;
  autoResolveConflicts?: boolean;
}

const settingsDir = join(homedir(), ".config", "orc");
const settingsPath = join(settingsDir, "settings.json");

export function loadSettings(): UserSettings | null {
  try {
    const raw = readFileSync(settingsPath, "utf-8");
    return JSON.parse(raw) as UserSettings;
  } catch {
    return null;
  }
}

export function saveSettings(settings: Partial<UserSettings>): void {
  mkdirSync(settingsDir, { recursive: true });
  const existing = loadSettings() ?? {};
  const merged = { ...existing, ...settings };
  writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + "\n");
}
