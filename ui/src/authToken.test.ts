import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { bootstrapToken, storedToken, storeToken } from "./authToken";

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, "", "/");
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** Put the page on a URL, as if it had been opened with these parameters. */
function openAt(url: string) {
  history.replaceState(null, "", url);
}

// ---------------------------------------------------------------------------
// bootstrapToken
// ---------------------------------------------------------------------------
describe("bootstrapToken", () => {
  it("falls back to localStorage when URL has no token", () => {
    storeToken("sekret");
    expect(bootstrapToken()).toBe("sekret");
  });

  it("returns null when no token is stored", () => {
    expect(bootstrapToken()).toBeNull();
  });

  it("preserves a token already in localStorage", () => {
    storeToken("stored-token");
    expect(bootstrapToken()).toBe("stored-token");
  });

  it("captures a token from the URL and persists it", () => {
    openAt("/?token=from-url");
    expect(bootstrapToken()).toBe("from-url");
    expect(storedToken()).toBe("from-url");
  });

  it("strips the token from the address bar, so it cannot linger in history", () => {
    // The whole point of the module: a token in the URL survives screenshots,
    // browser history and shared links until it is taken back out
    openAt("/?token=from-url");
    bootstrapToken();
    expect(window.location.search).not.toContain("token");
  });

  it("keeps the rest of the URL intact while stripping the token", () => {
    openAt("/app?token=from-url&view=tree#section");
    bootstrapToken();
    expect(window.location.pathname).toBe("/app");
    expect(window.location.search).toBe("?view=tree");
    expect(window.location.hash).toBe("#section");
  });

  it("leaves a URL without a token alone", () => {
    openAt("/app?view=tree");
    bootstrapToken();
    expect(window.location.search).toBe("?view=tree");
  });

  it("lets a fresh URL token replace a stored one", () => {
    storeToken("old");
    openAt("/?token=new");
    expect(bootstrapToken()).toBe("new");
    expect(storedToken()).toBe("new");
  });

  it("still drives the session from the URL when storage is unavailable", () => {
    // A sandboxed iframe throws on localStorage: the token cannot persist, but it
    // must still authenticate this session rather than being dropped
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    openAt("/?token=from-url");
    expect(bootstrapToken()).toBe("from-url");
  });

  it("returns null when storage is unavailable and the URL carries nothing", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(bootstrapToken()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// storedToken
// ---------------------------------------------------------------------------
describe("storedToken", () => {
  it("returns null when nothing is stored", () => {
    expect(storedToken()).toBeNull();
  });

  it("ignores a token in the URL — the host page owns its own parameters", () => {
    openAt("/?token=from-url");
    expect(storedToken()).toBeNull();
    expect(window.location.search).toBe("?token=from-url");
  });

  it("returns null rather than throwing when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(storedToken()).toBeNull();
  });

  it("returns the stored token", () => {
    storeToken("my-token");
    expect(storedToken()).toBe("my-token");
  });
});

// ---------------------------------------------------------------------------
// storeToken
// ---------------------------------------------------------------------------
describe("storeToken", () => {
  it("writes the token to localStorage", () => {
    storeToken("hello");
    expect(localStorage.getItem("pi-outpost:token")).toBe("hello");
  });

  it("overwrites a previous token", () => {
    storeToken("first");
    storeToken("second");
    expect(storedToken()).toBe("second");
  });

  it("swallows a storage failure instead of breaking the session", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => storeToken("hello")).not.toThrow();
  });
});
