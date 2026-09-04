import { describe, it, expect, afterEach, vi } from "vitest";
import {
  hiddenCount,
  persistConversationFilter,
  readConversationFilters,
} from "./conversationFilters";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("conversation filters", () => {
  it("shows both kinds in a browser that has never been told otherwise", () => {
    expect(readConversationFilters()).toEqual({ tools: true, reasoning: true });
  });

  it("keeps the meaning of a preference set before the second filter existed", () => {
    // The key that shipped with the tool toggle, in the polarity it shipped in.
    // Reading it as anything but "tools hidden" would flip the preference of
    // everyone who already set it.
    localStorage.setItem("pi-outpost:hide-tools", "1");
    expect(readConversationFilters()).toEqual({ tools: false, reasoning: true });
  });

  it("reads each kind from its own key", () => {
    localStorage.setItem("pi-outpost:hide-reasoning", "1");
    expect(readConversationFilters()).toEqual({ tools: true, reasoning: false });
  });

  it("writes one kind without touching the other", () => {
    localStorage.setItem("pi-outpost:hide-reasoning", "1");
    persistConversationFilter("tools", false);
    expect(localStorage.getItem("pi-outpost:hide-tools")).toBe("1");
    expect(localStorage.getItem("pi-outpost:hide-reasoning")).toBe("1");

    persistConversationFilter("tools", true);
    expect(localStorage.getItem("pi-outpost:hide-tools")).toBe("0");
    expect(localStorage.getItem("pi-outpost:hide-reasoning")).toBe("1");
  });

  it("shows everything when storage throws rather than failing to read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    expect(readConversationFilters()).toEqual({ tools: true, reasoning: true });
  });

  it("survives a write to storage that throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    expect(() => persistConversationFilter("reasoning", false)).not.toThrow();
  });

  it("counts the hidden kinds for the closed menu", () => {
    expect(hiddenCount({ tools: true, reasoning: true })).toBe(0);
    expect(hiddenCount({ tools: false, reasoning: true })).toBe(1);
    expect(hiddenCount({ tools: false, reasoning: false })).toBe(2);
  });
});
