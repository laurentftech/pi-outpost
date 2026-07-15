import { createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Theme as WireTheme } from "@pi-outpost/shared";
import App, { type AppHandle } from "web/App";
// eslint-disable-next-line import/no-unresolved -- resolved at build time via the `?inline` query (raw CSS string)
import css from "web/index.css?inline";

/**
 * Theme the widget starts in. Spelled out here rather than re-exported from
 * @pi-outpost/shared: that package is private to this repo, so a published
 * `mount.d.ts` importing from it would resolve to nothing in a consumer's
 * project. The assignment below keeps the two in step.
 */
export type Theme = "light" | "dark" | "system";
type Identical<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
// Drift makes Identical resolve to never, so this assignment stops compiling.
const themeMatchesProtocol: Identical<Theme, WireTheme> = true;
void themeMatchesProtocol;

export interface MountOptions {
  /** pi-outpost backend origin, e.g. "https://api.example.com". Defaults to same-origin as the host page. */
  serverUrl?: string;
  /** Initial theme; falls back to the server's branding.defaultTheme, then "system". */
  theme?: Theme;
  /** Auth token for servers with `server.token` set — the host app supplies it, no token screen shown. */
  token?: string;
}

export interface MountHandle {
  /** Unmounts the React tree. `container` itself is left in the DOM (with an empty shadow root). */
  unmount(): void;
  setTheme(theme: Theme): void;
}

/**
 * Mounts pi-outpost into `container` inside a Shadow DOM, fully isolated from the
 * host page's CSS in both directions (Tailwind's reset never touches the host page,
 * and the host page's styles never bleed into the widget).
 */
export function mount(container: HTMLElement, options: MountOptions = {}): MountHandle {
  const shadow = container.shadowRoot ?? container.attachShadow({ mode: "open" });
  shadow.replaceChildren();

  // Chrome 97 silently drops <style> elements >~512 KB inside Shadow DOM;
  // Tailwind v4 is ~1.5 MB, so we use the constructable stylesheet API instead.
  const canUseConstructableSheets =
    typeof CSSStyleSheet !== "undefined" &&
    typeof CSSStyleSheet.prototype.replaceSync === "function";
  if (canUseConstructableSheets) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    (shadow as ShadowRoot & { adoptedStyleSheets: CSSStyleSheet[] }).adoptedStyleSheets = [sheet];
  } else {
    const style = document.createElement("style");
    style.textContent = css;
    shadow.appendChild(style);
  }

  // Same id as the standalone app's mount point — reuses index.css's `#root { height: 100% }`
  // rule as-is inside the shadow tree.
  const wrapper = document.createElement("div");
  wrapper.id = "root";
  shadow.appendChild(wrapper);

  const appRef = createRef<AppHandle>();
  const root: Root = createRoot(wrapper);
  root.render(
    createElement(App, {
      ref: appRef,
      serverUrl: options.serverUrl,
      rootElement: container,
      initialTheme: options.theme,
      token: options.token,
    }),
  );

  return {
    unmount() {
      root.unmount();
    },
    setTheme(theme) {
      appRef.current?.setTheme(theme);
    },
  };
}
