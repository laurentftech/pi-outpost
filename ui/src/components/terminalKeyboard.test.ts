import { describe, expect, it, vi } from "vitest";
import { terminalKeyboardHandler } from "./terminalKeyboard";

describe("TerminalClipboardShortcuts", () => {
  it("Ctrl+C copies a selection and otherwise remains a shell interrupt", async () => {
    const terminal = { hasSelection: () => true, getSelection: () => "selected output" };
    const copy = vi.fn().mockResolvedValue(undefined);
    const handler = terminalKeyboardHandler(terminal, copy, vi.fn());
    const event = new KeyboardEvent("keydown", { key: "c", ctrlKey: true, cancelable: true });
    expect(handler(event)).toBe(false);
    await Promise.resolve();
    expect(copy).toHaveBeenCalledWith("selected output");
    expect(event.defaultPrevented).toBe(true);
    terminal.hasSelection = () => false;
    expect(handler(new KeyboardEvent("keydown", { key: "c", ctrlKey: true }))).toBe(true);
    expect(copy).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+V and Ctrl+Shift+V allow native paste without sending control characters", () => {
    const handler = terminalKeyboardHandler({ hasSelection: () => false, getSelection: () => "" }, vi.fn(), vi.fn());
    for (const modifiers of [{ ctrlKey: true }, { ctrlKey: true, shiftKey: true }, { metaKey: true }]) {
      const event = new KeyboardEvent("keydown", { key: "v", cancelable: true, ...modifiers });
      expect(handler(event)).toBe(false);
      expect(event.defaultPrevented).toBe(false);
    }
    for (const key of ["a", "l", "r", "u"]) expect(handler(new KeyboardEvent("keydown", { key, ctrlKey: true }))).toBe(true);
  });

  it("a clipboard refusal is reported without throwing or interrupting the shell", async () => {
    const refused = vi.fn();
    const handler = terminalKeyboardHandler({ hasSelection: () => true, getSelection: () => "text" }, () => { throw Error("denied"); }, refused);
    expect(handler(new KeyboardEvent("keydown", { key: "c", ctrlKey: true }))).toBe(false);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(refused).toHaveBeenCalledOnce();
  });
});
