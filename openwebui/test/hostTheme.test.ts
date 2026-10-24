import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";

const originalWindow = globalThis.window;
const originalParent = globalThis.parent;
const originalMutationObserver = globalThis.MutationObserver;
const originalMatchMedia = globalThis.window?.matchMedia;
let frameWindow: JSDOM["window"] | undefined;

function installFrame({ readable = true, dark = false, systemDark = false } = {}) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  frameWindow = dom.window;
  const root = dom.window.document.documentElement;
  root.classList.toggle("dark", dark);
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const media = {
    matches: systemDark,
    addEventListener: (_: string, callback: (event: { matches: boolean }) => void) => listeners.add(callback),
    removeEventListener: (_: string, callback: (event: { matches: boolean }) => void) => listeners.delete(callback),
    set(matches: boolean) {
      this.matches = matches;
      for (const callback of listeners) callback({ matches });
    },
    get listenerCount() { return listeners.size; },
  };
  Object.defineProperty(globalThis, "parent", {
    configurable: true,
    value: readable ? { document: dom.window.document } : Object.defineProperty({}, "document", { get() { throw new Error("cross-origin"); } }),
  });
  Object.defineProperty(globalThis, "MutationObserver", { configurable: true, value: dom.window.MutationObserver });
  Object.defineProperty(dom.window, "matchMedia", { configurable: true, value: () => media });
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  return { dom, root, media };
}

beforeEach(() => {
  // The helper reads globals at call time; tests replace parent and browser APIs per case.
});

afterEach(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  Object.defineProperty(globalThis, "parent", { configurable: true, value: originalParent });
  Object.defineProperty(globalThis, "MutationObserver", { configurable: true, value: originalMutationObserver });
  if (originalWindow && originalMatchMedia) Object.defineProperty(originalWindow, "matchMedia", { configurable: true, value: originalMatchMedia });
  frameWindow?.close();
  frameWindow = undefined;
});

test("readable parent selects light and dark from its root class", async () => {
  const { followHostTheme } = await import("../viewer/hostTheme.ts");
  for (const [dark, expected] of [[false, "light"], [true, "dark"]] as const) {
    installFrame({ dark });
    const themes: string[] = [];
    const stop = followHostTheme((theme) => themes.push(theme));
    assert.deepEqual(themes, [expected]);
    stop();
  }
});

test("readable parent class changes are observed and stopped", async () => {
  const { followHostTheme } = await import("../viewer/hostTheme.ts");
  const { dom, root } = installFrame();
  const themes: string[] = [];
  const stop = followHostTheme((theme) => themes.push(theme));
  root.classList.add("dark");
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  assert.deepEqual(themes, ["light", "dark"]);
  stop();
  root.classList.remove("dark");
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  assert.deepEqual(themes, ["light", "dark"]);
  dom.window.close();
});

test("unreadable parent follows system changes and removes its listener", async () => {
  const { followHostTheme } = await import("../viewer/hostTheme.ts");
  const { media } = installFrame({ readable: false, systemDark: false });
  const themes: string[] = [];
  const stop = followHostTheme((theme) => themes.push(theme));
  assert.deepEqual(themes, ["light"]);
  media.set(true);
  assert.deepEqual(themes, ["light", "dark"]);
  assert.equal(media.listenerCount, 1);
  stop();
  assert.equal(media.listenerCount, 0);
  media.set(false);
  assert.deepEqual(themes, ["light", "dark"]);
});
