import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Theme } from "@pi-interface/shared";
import { loadStoredTheme, resolveSystemTheme, storeTheme } from "./theme";

/**
 * Resolves and applies the effective light/dark theme.
 *
 * Precedence: an explicit local pick (toggle button, persisted) or a message
 * from a host page (`{ type: "pi-interface:set-theme", theme }` — for
 * embedding, independent of whether the toggle is enabled) wins over
 * `defaultTheme` from server config, which itself falls back to "system".
 */
export function useTheme(defaultTheme: Theme, allowToggle: boolean) {
  const stored = allowToggle ? loadStoredTheme() : null;
  const [preference, setPreference] = useState<Theme>(stored ?? defaultTheme);
  const hasOverride = useRef(stored !== null);

  // Once branding loads (or changes) with no local/host override yet, adopt it.
  useEffect(() => {
    if (!hasOverride.current) setPreference(defaultTheme);
  }, [defaultTheme]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as { type?: string; theme?: string } | undefined;
      if (data?.type !== "pi-interface:set-theme") return;
      if (data.theme !== "light" && data.theme !== "dark" && data.theme !== "system") return;
      hasOverride.current = true;
      setPreference(data.theme);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const [systemTheme, setSystemTheme] = useState(resolveSystemTheme);
  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemTheme(mql.matches ? "dark" : "light");
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const resolved = preference === "system" ? systemTheme : preference;

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  const setTheme = useCallback(
    (next: Theme) => {
      hasOverride.current = true;
      setPreference(next);
      if (allowToggle) storeTheme(next);
    },
    [allowToggle],
  );

  const toggle = useCallback(() => setTheme(resolved === "dark" ? "light" : "dark"), [resolved, setTheme]);

  return { theme: resolved, toggle };
}
