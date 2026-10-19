/**
 * Which theme wins, and why it matters who is asking.
 *
 * The rank that this file is really about: a host application names a theme on
 * every `mount()`, and a value this browser remembered from some earlier visit
 * was silently beating it. In a page that asked for light, a single past click
 * on ☾ left the widget dark for good, with nothing the host could do about it.
 */
import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { useTheme } from "./useTheme";

const STORAGE_KEY = "pi-outpost:theme";

beforeAll(() => {
  // jsdom ships no matchMedia, and the hook asks it what the OS prefers. "Not
  // dark" keeps every case below about precedence rather than about the OS.
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

function mount(configured: "light" | "dark" | "system", hostTheme?: "light" | "dark" | "system") {
  const root = document.createElement("div");
  return renderHook(() => useTheme(configured, true, root, hostTheme)).result;
}

describe("useTheme precedence", () => {
  it("takes the server's configured default when nothing else has an opinion", () => {
    expect(mount("light").current.theme).toBe("light");
  });

  it("lets a stored pick from an earlier visit override the configured default", () => {
    localStorage.setItem(STORAGE_KEY, "dark");

    expect(mount("light").current.theme).toBe("dark");
  });

  it("gives the host the theme it asked for, over anything this browser remembered", () => {
    localStorage.setItem(STORAGE_KEY, "dark");

    // mount(container, { theme: "light" }) — an instruction repeated every mount
    expect(mount("dark", "light").current.theme).toBe("light");
  });

  it("keeps the host's theme when branding arrives with a different default", () => {
    // Branding lands after the first render; without an override marked, the
    // effect that adopts it would undo what the host asked for.
    const root = document.createElement("div");
    const { result, rerender } = renderHook(
      ({ configured }: { configured: "light" | "dark" }) => useTheme(configured, true, root, "light"),
      { initialProps: { configured: "system" as "light" | "dark" } },
    );

    rerender({ configured: "dark" });

    expect(result.current.theme).toBe("light");
    expect(root.dataset.theme).toBe("light");
  });

  it("still lets the reader change it afterwards, and remembers that", () => {
    const result = mount("dark", "light");

    act(() => result.current.setTheme("dark"));

    expect(result.current.theme).toBe("dark");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("dark");
  });

  it("ignores a stored pick when the deployment turned the toggle off", () => {
    localStorage.setItem(STORAGE_KEY, "dark");

    const root = document.createElement("div");
    const { result } = renderHook(() => useTheme("light", false, root));

    expect(result.current.theme).toBe("light");
  });
});

describe("useTheme following what changes after mount", () => {
  it("takes the theme a host page posts, and ignores any other message or value", async () => {
    const result = mount("light");
    const post = (data: unknown) => act(() => window.dispatchEvent(new MessageEvent("message", { data })));
    post({ type: "something-else", theme: "dark" });
    post({ type: "pi-outpost:set-theme", theme: "purple" });
    expect(result.current.theme).toBe("light");
    post({ type: "pi-outpost:set-theme", theme: "dark" });
    expect(result.current.theme).toBe("dark");
  });

  it("follows the system while set to system, as the OS switches", () => {
    let listener: (() => void) | undefined;
    const query = { matches: false, addEventListener: (_: string, next: () => void) => (listener = next), removeEventListener: () => {} };
    const previous = window.matchMedia;
    window.matchMedia = (() => query) as unknown as typeof window.matchMedia;
    try {
      const result = mount("system");
      expect(result.current.theme).toBe("light");
      query.matches = true;
      act(() => listener?.());
      expect(result.current.theme).toBe("dark");
    } finally {
      window.matchMedia = previous;
    }
  });

  it("toggles to the other theme and remembers the pick", () => {
    const result = mount("light");
    act(() => result.current.toggle());
    expect(result.current.theme).toBe("dark");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("dark");
  });
});
