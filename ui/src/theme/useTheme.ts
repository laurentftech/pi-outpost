import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Theme } from "@pi-outpost/shared";
import { loadStoredTheme, resolveSystemTheme, storeTheme } from "./theme";

/**
 * Resolves and applies the effective light/dark theme.
 *
 * Precedence, strongest first:
 *
 * 1. a message from a host page (`{ type: "pi-outpost:set-theme", theme }`) or
 *    the host calling `setTheme()`, and the toggle button — whatever was chosen
 *    while this widget was on screen;
 * 2. `hostTheme` — the theme the embedding application named when it mounted
 *    (`mount(el, { theme })`). An instruction the host repeats on every mount
 *    outranks anything this browser happens to have remembered: a widget that
 *    came up dark because someone once clicked ☾, in a page that asked for
 *    light, is a widget the host cannot control at all;
 * 3. a stored local pick from a previous visit;
 * 4. `defaultTheme` from server config, itself falling back to "system".
 *
 * `rootElement` is where `data-theme` is applied — `document.documentElement`
 * for the standalone app, or the widget's own container element when mounted
 * inside a Shadow DOM (see `embed/src/mount.tsx`), so `dark:` styling stays
 * scoped to the widget instead of leaking onto the host page's `<html>`.
 */
export function useTheme(
  defaultTheme: Theme,
  allowToggle: boolean,
  rootElement: HTMLElement = document.documentElement,
  hostTheme?: Theme,
) {
  const stored = allowToggle ? loadStoredTheme() : null;
  const [preference, setPreference] = useState<Theme>(hostTheme ?? stored ?? defaultTheme);
  // Both a host's theme and a stored pick settle the question, so neither is
  // displaced when branding arrives.
  const hasOverride = useRef(hostTheme !== undefined || stored !== null);

  // Once branding loads (or changes) with no local/host override yet, adopt it.
  useEffect(() => {
    if (!hasOverride.current) setPreference(defaultTheme);
  }, [defaultTheme]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as { type?: string; theme?: string } | undefined;
      if (data?.type !== "pi-outpost:set-theme") return;
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
    rootElement.dataset.theme = resolved;
  }, [rootElement, resolved]);

  const setTheme = useCallback(
    (next: Theme) => {
      hasOverride.current = true;
      setPreference(next);
      if (allowToggle) storeTheme(next);
    },
    [allowToggle],
  );

  const toggle = useCallback(() => setTheme(resolved === "dark" ? "light" : "dark"), [resolved, setTheme]);

  return { theme: resolved, preference, toggle, setTheme };
}
