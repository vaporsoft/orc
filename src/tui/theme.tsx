import React, { createContext, useContext, useState, useCallback } from "react";
import { saveSettings } from "../utils/settings.js";

export interface Theme {
  border: string;
  accent: string;
  accentBright: string;
  accentBg: string;
  textOnAccent: string;
  text: string;
  muted: string;
  error: string;
  warning: string;
  info: string;
}

const darkTheme: Theme = {
  border: "green",
  accent: "green",
  accentBright: "greenBright",
  accentBg: "green",
  textOnAccent: "black",
  text: "white",
  muted: "gray",
  error: "red",
  warning: "yellow",
  info: "cyan",
};

const lightTheme: Theme = {
  border: "gray",
  accent: "blue",
  accentBright: "cyan",
  accentBg: "blue",
  textOnAccent: "white",
  text: "black",
  muted: "gray",
  error: "red",
  warning: "yellow",
  info: "cyan",
};

export const themes = { dark: darkTheme, light: lightTheme } as const;

interface ThemeContextValue {
  theme: Theme;
  mode: "dark" | "light";
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: darkTheme,
  mode: "dark",
  toggleTheme: () => {},
});

export function ThemeProvider({
  initialMode,
  children,
}: {
  initialMode: "dark" | "light";
  children?: React.ReactNode;
}) {
  const [mode, setMode] = useState<"dark" | "light">(initialMode);

  const toggleTheme = useCallback(() => {
    setMode((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      try {
        saveSettings({ theme: next });
      } catch (error) {
        // Silently ignore save failures to prevent TUI crash
        // The theme change will still work in the current session
      }
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme: themes[mode], mode, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): Theme {
  return useContext(ThemeContext).theme;
}

export function useThemeContext(): ThemeContextValue {
  return useContext(ThemeContext);
}
