import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { preloadCodeEditor } from "./components/lazyCodeEditor";

// The file editor is lazy in the app; loaded up front here, it renders in the same pass
// as the click that opens it, as it does in the app once preloaded.
await preloadCodeEditor();

// jsdom implements no layout, so it ships no scrollIntoView. Components that keep a
// selected row in view call it on every selection change; without this they throw
// during render and the test reports a crash rather than the behaviour it asked about.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// Nor any range geometry. The file editor (CodeMirror) measures text through ranges
// after each update; without these it logs a TypeError for every measurement.
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
}
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
}

class LocalStorageMock implements Storage {
  private store: Record<string, string> = {};
  clear() {
    this.store = {};
  }
  getItem(key: string) {
    return this.store[key] ?? null;
  }
  setItem(key: string, value: string) {
    this.store[key] = String(value);
  }
  removeItem(key: string) {
    delete this.store[key];
  }
  get length() {
    return Object.keys(this.store).length;
  }
  key(index: number) {
    return Object.keys(this.store)[index] ?? null;
  }
}

const storageMock = new LocalStorageMock();
Object.defineProperty(globalThis, "localStorage", { value: storageMock, writable: true, configurable: true });
if (typeof window !== "undefined") {
  Object.defineProperty(window, "localStorage", { value: storageMock, writable: true, configurable: true });
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any;
}

if (typeof window !== "undefined") {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as any;
}

afterEach(() => {
  storageMock.clear();
  cleanup();
});
