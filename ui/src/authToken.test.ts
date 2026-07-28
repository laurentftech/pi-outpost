import { describe, it, expect, beforeEach, vi } from "vitest";
import { bootstrapToken, storedToken, storeToken } from "./authToken";

beforeEach(() => {
  localStorage.clear();
});

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
});

// ---------------------------------------------------------------------------
// storedToken
// ---------------------------------------------------------------------------
describe("storedToken", () => {
  it("returns null when nothing is stored", () => {
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
});
