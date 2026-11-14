import { describe, expect, it, vi } from "vitest";
import {
  clampPanelWidth,
  FILES_SIDEBAR_WIDTH,
  HISTORY_LIST_WIDTH,
  parsePanelWidth,
  readPanelWidth,
  writePanelWidth,
  canShowViewerBeside,
  CONVERSATION_MIN_WIDTH,
  readViewerLayout,
  VIEWER_PANE_WIDTH,
  writeViewerLayout,
} from "./panelWidth";

describe("resizable panel width", () => {
  it("uses the panel default for missing, blank, malformed, and non-finite values", () => {
    expect(parsePanelWidth(null, FILES_SIDEBAR_WIDTH)).toBe(288);
    expect(parsePanelWidth(" ", FILES_SIDEBAR_WIDTH)).toBe(288);
    expect(parsePanelWidth("wide", HISTORY_LIST_WIDTH)).toBe(416);
    expect(parsePanelWidth("Infinity", HISTORY_LIST_WIDTH)).toBe(416);
  });

  it("normalizes finite values to bounded integer pixels", () => {
    expect(clampPanelWidth(320.6, FILES_SIDEBAR_WIDTH)).toBe(321);
    expect(clampPanelWidth(100, FILES_SIDEBAR_WIDTH)).toBe(224);
    expect(clampPanelWidth(900, FILES_SIDEBAR_WIDTH)).toBe(640);
  });

  it("reads and writes each namespaced preference", () => {
    const reader = { getItem: vi.fn().mockReturnValue("352") };
    const writer = { setItem: vi.fn() };

    expect(readPanelWidth(HISTORY_LIST_WIDTH, reader)).toBe(352);
    expect(reader.getItem).toHaveBeenCalledWith(HISTORY_LIST_WIDTH.storageKey);
    writePanelWidth(352.4, HISTORY_LIST_WIDTH, writer);
    expect(writer.setItem).toHaveBeenCalledWith(HISTORY_LIST_WIDTH.storageKey, "352");
  });

  it("falls back safely when storage access is denied", () => {
    const deniedReader = { getItem: vi.fn(() => { throw new Error("denied"); }) };
    const deniedWriter = { setItem: vi.fn(() => { throw new Error("denied"); }) };

    expect(readPanelWidth(FILES_SIDEBAR_WIDTH, deniedReader)).toBe(288);
    expect(() => writePanelWidth(352, FILES_SIDEBAR_WIDTH, deniedWriter)).not.toThrow();
  });
});

describe("viewer layout preference", () => {
  it("offers the side-by-side layout only when both panes fit", () => {
    expect(canShowViewerBeside(VIEWER_PANE_WIDTH.minWidth + CONVERSATION_MIN_WIDTH)).toBe(true);
    expect(canShowViewerBeside(VIEWER_PANE_WIDTH.minWidth + CONVERSATION_MIN_WIDTH - 1)).toBe(false);
  });

  it("remembers the chosen layout and defaults to the overlay", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };

    expect(readViewerLayout(storage)).toBe("overlay");
    writeViewerLayout("beside", storage);
    expect(readViewerLayout(storage)).toBe("beside");
    store.set([...store.keys()][0], "garbage");
    expect(readViewerLayout(storage)).toBe("overlay");
  });

  it("falls back to the overlay when storage access is denied", () => {
    const denied = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    expect(readViewerLayout(denied)).toBe("overlay");
    expect(() => writeViewerLayout("beside", denied)).not.toThrow();
  });
});
