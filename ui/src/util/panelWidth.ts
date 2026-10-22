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
