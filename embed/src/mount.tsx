import { createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Theme } from "@pi-outpost/shared";
import App, { type AppHandle } from "web/App";
// eslint-disable-next-line import/no-unresolved -- resolved at build time via the `?inline` query (raw CSS string)
import css from "web/index.css?inline";

export interface MountOptions {
  /** pi-outpost backend origin, e.g. "https://api.example.com". Defaults to same-origin as the host page. */
  serverUrl?: string;
  /** Initial theme; falls back to the server's branding.defaultTheme, then "system". */
  theme?: Theme;
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

  const style = document.createElement("style");
  style.textContent = css;
  shadow.appendChild(style);

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
