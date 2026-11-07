import { describe, expect, it, vi } from "vitest";
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
