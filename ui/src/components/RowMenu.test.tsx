import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RowMenu } from "./RowMenu";
import type { RowAction } from "./fileTreeModel";

const groups: RowAction[][] = [
  [
    { id: "open", label: "Open" },
    { id: "reveal", label: "Show in file manager" },
  ],
  [{ id: "download", label: "Download" }],
  [{ id: "delete", label: "Delete…", danger: true, shortcut: "Del" }],
];

function setup(extra: Partial<React.ComponentProps<typeof RowMenu>> = {}) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  render(
    <div style={{ position: "relative" }}>
      <button type="button">outside</button>
      <RowMenu label="Actions for readme.md" groups={groups} anchor={{ left: 10, top: 20 }} onSelect={onSelect} onClose={onClose} {...extra} />
    </div>,
  );
  return { onSelect, onClose, menu: screen.getByRole("menu", { name: "Actions for readme.md" }) };
}

describe("RowMenu", () => {
  it("TheMenuIsAKeyboardMenu: focus starts on the first item and the arrows, Home and End move it", () => {
    const { menu } = setup();
    const item = (name: string) => screen.getByRole("menuitem", { name: new RegExp(`^${name}`) });

    expect(item("Open")).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(item("Show in file manager")).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(item("Download")).toHaveFocus();
    fireEvent.keyDown(menu, { key: "End" });
    expect(item("Delete…")).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(item("Open")).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(item("Delete…")).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Home" });
    expect(item("Open")).toHaveFocus();
  });

  it("Enter on an item runs it; Escape closes without running anything", () => {
    const { onSelect, onClose, menu } = setup();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Show in file manager" }));
    expect(onSelect).toHaveBeenCalledWith("reveal");

    fireEvent.keyDown(menu, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("OneMenuAtATime: a press outside the menu closes it", () => {
    const { onClose } = setup();
    fireEvent.mouseDown(screen.getByRole("button", { name: "outside" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("groups are separated, and a disabled item is skipped by the arrows", () => {
    const { menu } = setup({ disabled: new Set(["reveal"]) });
    expect(screen.getAllByRole("separator")).toHaveLength(2);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Download" })).toHaveFocus();
    expect(screen.getByRole("menuitem", { name: "Show in file manager" })).toBeDisabled();
  });
});

describe("RowMenu: Tab and a menu with nothing to run", () => {
  it("Tab closes the menu as Escape does", () => {
    const { onClose, onSelect, menu } = setup();
    fireEvent.keyDown(menu, { key: "Tab" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("with every item disabled, the arrows move nothing and nothing has focus inside", () => {
    const { menu } = setup({ disabled: new Set(["open", "reveal", "download", "delete"]) });
    for (const key of ["ArrowDown", "ArrowUp", "Home", "End"]) fireEvent.keyDown(menu, { key });
    expect(menu.contains(document.activeElement)).toBe(false);
  });

  it("other keys are left alone", () => {
    const { onClose, menu } = setup();
    fireEvent.keyDown(menu, { key: "a" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("menuitem", { name: "Open" })).toHaveFocus();
  });
});

/**
 * jsdom lays nothing out: the menu's size, its container's and what can be seen are given
 * here, as a browser would measure them.
 */
describe("RowMenu: where it opens", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function layout({ menuHeight, menuWidth, containerWidth, container, viewport }: {
    menuHeight: number;
    menuWidth: number;
    containerWidth: number;
    container: { top: number; bottom: number };
    viewport?: { top: number; bottom: number };
  }) {
    vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockImplementation(function (this: HTMLElement) {
      return this.getAttribute("role") === "menu" ? this.parentElement : null;
    });
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.getAttribute("role") === "menu" ? menuHeight : 0;
    });
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.getAttribute("role") === "menu" ? menuWidth : 0;
    });
    vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (this: Element) {
      return this.getAttribute("data-testid") === "container" ? containerWidth : 0;
    });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const testid = this.getAttribute("data-testid");
      const rect = testid === "container" ? container : testid === "viewport" ? viewport : this === document.documentElement ? { top: 0, bottom: 10_000 } : undefined;
      return { top: rect?.top ?? 0, bottom: rect?.bottom ?? 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: rect?.top ?? 0, toJSON: () => ({}) } as DOMRect;
    });
  }

  function open(anchor: React.ComponentProps<typeof RowMenu>["anchor"], { scrolls = true } = {}) {
    render(
      <div data-testid="viewport" style={scrolls ? { overflowY: "auto" } : undefined}>
        <div data-testid="container" style={{ position: "relative" }}>
          <RowMenu label="Actions" groups={groups} anchor={anchor} onSelect={() => {}} onClose={() => {}} />
        </div>
      </div>,
    );
    const menu = screen.getByRole("menu", { name: "Actions" });
    return { top: menu.style.top, left: menu.style.left };
  }

  it("below its row when it fits in what can be seen", () => {
    layout({ menuHeight: 80, menuWidth: 100, containerWidth: 300, container: { top: 0, bottom: 400 }, viewport: { top: 0, bottom: 400 } });
    expect(open({ left: 10, top: 20, above: 4 })).toEqual({ top: "20px", left: "10px" });
  });

  it("above its row, ending where the row starts, when the scrolled box would cut it off below", () => {
    layout({ menuHeight: 80, menuWidth: 100, containerWidth: 300, container: { top: 0, bottom: 1_000 }, viewport: { top: 0, bottom: 200 } });
    expect(open({ left: 10, top: 180, above: 160 })).toEqual({ top: "80px", left: "10px" });
  });

  it("from its own top when no row start is given", () => {
    layout({ menuHeight: 80, menuWidth: 100, containerWidth: 300, container: { top: 0, bottom: 1_000 }, viewport: { top: 0, bottom: 200 } });
    expect(open({ left: 10, top: 180 })).toEqual({ top: "100px", left: "10px" });
  });

  it("below after all when there is no room above either", () => {
    layout({ menuHeight: 150, menuWidth: 100, containerWidth: 300, container: { top: 0, bottom: 1_000 }, viewport: { top: 0, bottom: 200 } });
    expect(open({ left: 10, top: 120, above: 100 })).toEqual({ top: "120px", left: "10px" });
  });

  it("clamped sideways so the panel does not cut it off", () => {
    layout({ menuHeight: 80, menuWidth: 100, containerWidth: 150, container: { top: 0, bottom: 400 }, viewport: { top: 0, bottom: 400 } });
    expect(open({ left: 120, top: 20 }).left).toBe("50px");
  });

  it("never past the panel's left edge, even when wider than the panel", () => {
    layout({ menuHeight: 80, menuWidth: 200, containerWidth: 150, container: { top: 0, bottom: 400 }, viewport: { top: 0, bottom: 400 } });
    expect(open({ left: 120, top: 20 }).left).toBe("0px");
  });

  it("measured against the window when nothing above it scrolls", () => {
    // The page itself is what can be seen: the window's height bounds it.
    layout({ menuHeight: 80, menuWidth: 100, containerWidth: 300, container: { top: 0, bottom: 10_000 } });
    expect(open({ left: 10, top: window.innerHeight - 20, above: window.innerHeight - 40 }, { scrolls: false }).top).toBe(`${window.innerHeight - 120}px`);
  });
});
