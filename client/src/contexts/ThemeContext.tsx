import React, { createContext, useContext, useEffect, useState } from "react";
import { safeStorageGet, safeStorageSet } from "@/lib/safeStorage";

export type Theme = "light" | "dark";
export type ThemeMode = Theme | "system";

const THEME_STORAGE_KEY = "theme";

function systemTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function isThemeMode(value: string | null): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

interface ThemeContextType {
  theme: Theme;
  themeMode: ThemeMode;
  toggleTheme?: () => void;
  switchable: boolean;
  isTransitioning: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: ThemeMode;
  switchable?: boolean;
}

export function ThemeProvider({
  children,
  defaultTheme = "light",
  switchable = false,
}: ThemeProviderProps) {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (!switchable || typeof window === "undefined") return defaultTheme;
    const stored = safeStorageGet("local", THEME_STORAGE_KEY);
    return isThemeMode(stored) ? stored : defaultTheme;
  });
  const [deviceTheme, setDeviceTheme] = useState<Theme>(systemTheme);
  const theme = themeMode === "system" ? deviceTheme : themeMode;

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }

    if (switchable && typeof window !== "undefined") {
      safeStorageSet("local", THEME_STORAGE_KEY, themeMode);
    }
  }, [theme, themeMode, switchable]);

  useEffect(() => {
    if (themeMode !== "system" || typeof window === "undefined" || !window.matchMedia) return;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const updateDeviceTheme = (event: MediaQueryListEvent) => setDeviceTheme(event.matches ? "dark" : "light");
    setDeviceTheme(mediaQuery.matches ? "dark" : "light");
    mediaQuery.addEventListener("change", updateDeviceTheme);
    return () => mediaQuery.removeEventListener("change", updateDeviceTheme);
  }, [themeMode]);

  const toggleTheme = switchable
    ? () => setThemeMode(currentMode => currentMode === "dark" ? "light" : currentMode === "light" ? "system" : "dark")
    : undefined;

  return (
    <ThemeContext.Provider value={{ theme, themeMode, toggleTheme, switchable, isTransitioning: false }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
