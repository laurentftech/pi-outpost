export const RESIZABLE_PANEL_MIN_WIDTH = 224;
export const RESIZABLE_PANEL_MAX_WIDTH = 640;
export const RESIZABLE_PANEL_KEYBOARD_STEP = 16;

export interface PanelWidthConfig {
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  keyboardStep: number;
  storageKey: string;
}

export const FILES_SIDEBAR_WIDTH: PanelWidthConfig = {
  defaultWidth: 288,
  minWidth: RESIZABLE_PANEL_MIN_WIDTH,
  maxWidth: RESIZABLE_PANEL_MAX_WIDTH,
  keyboardStep: RESIZABLE_PANEL_KEYBOARD_STEP,
  storageKey: "pi-outpost.files-sidebar-width.v1",
};

export const HISTORY_LIST_WIDTH: PanelWidthConfig = {
  defaultWidth: 416,
  minWidth: RESIZABLE_PANEL_MIN_WIDTH,
  maxWidth: RESIZABLE_PANEL_MAX_WIDTH,
  keyboardStep: RESIZABLE_PANEL_KEYBOARD_STEP,
  storageKey: "pi-outpost.history-list-width.v1",
};

export const TERMINAL_PANEL_HEIGHT: PanelWidthConfig = {
  defaultWidth: 288,
  minWidth: 160,
  maxWidth: 640,
  keyboardStep: 16,
  storageKey: "pi-outpost.terminal-height.v1",
};

interface StorageReader {
  getItem(key: string): string | null;
}

interface StorageWriter {
  setItem(key: string, value: string): void;
}

export function clampPanelWidth(value: number, config: PanelWidthConfig): number {
  if (!Number.isFinite(value)) return config.defaultWidth;
  return Math.min(config.maxWidth, Math.max(config.minWidth, Math.round(value)));
}

export function parsePanelWidth(raw: string | null, config: PanelWidthConfig): number {
  if (raw === null || raw.trim() === "") return config.defaultWidth;
  return clampPanelWidth(Number(raw), config);
}

export function readPanelWidth(config: PanelWidthConfig, storage?: StorageReader): number {
  try {
    const source = storage ?? window.localStorage;
    return parsePanelWidth(source.getItem(config.storageKey), config);
  } catch {
    return config.defaultWidth;
  }
}

export function writePanelWidth(width: number, config: PanelWidthConfig, storage?: StorageWriter): void {
  try {
    const target = storage ?? window.localStorage;
    target.setItem(config.storageKey, String(clampPanelWidth(width, config)));
  } catch {
    // Storage can be disabled by an embedding host or browser privacy policy.
  }
}

/** The file viewer's pane when it sits beside the conversation. */
export const VIEWER_PANE_WIDTH: PanelWidthConfig = {
  defaultWidth: 640,
  minWidth: 360,
  maxWidth: 1600,
  keyboardStep: 16,
  storageKey: "pi-outpost.viewer-pane-width.v1",
};

/** The conversation keeps at least this much beside the viewer. */
export const CONVERSATION_MIN_WIDTH = 380;

/** Beside the conversation only when both panes fit at their minimum widths. */
export function canShowViewerBeside(availableWidth: number): boolean {
  return availableWidth >= VIEWER_PANE_WIDTH.minWidth + CONVERSATION_MIN_WIDTH;
}

export type ViewerLayout = "overlay" | "beside";

const VIEWER_LAYOUT_KEY = "pi-outpost.viewer-layout.v1";

export function readViewerLayout(storage?: StorageReader): ViewerLayout {
  try {
    return (storage ?? window.localStorage).getItem(VIEWER_LAYOUT_KEY) === "beside" ? "beside" : "overlay";
  } catch {
    return "overlay";
  }
}

export function writeViewerLayout(layout: ViewerLayout, storage?: StorageWriter): void {
  try {
    (storage ?? window.localStorage).setItem(VIEWER_LAYOUT_KEY, layout);
  } catch {
    // Storage can be disabled by an embedding host or browser privacy policy.
  }
}
