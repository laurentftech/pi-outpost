import type { Theme } from "@pi-outpost/shared";

const STORAGE_KEY = "pi-outpost:theme";

export function resolveSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function loadStoredTheme(): Theme | null {
  const value = localStorage.getItem(STORAGE_KEY);
  return value === "light" || value === "dark" || value === "system" ? value : null;
}

export function storeTheme(preference: Theme): void {
  localStorage.setItem(STORAGE_KEY, preference);
}
