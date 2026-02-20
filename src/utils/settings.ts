import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface UserSettings {
  theme: "dark" | "light";
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

export function saveSettings(settings: UserSettings): void {
  mkdirSync(settingsDir, { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}
