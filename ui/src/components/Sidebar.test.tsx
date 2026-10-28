import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { DirEntry } from "@pi-outpost/shared";
import { Sidebar } from "./Sidebar";
import type { DirState, OpenFile } from "../useAgent";
import {
  FILES_SIDEBAR_WIDTH,
} from "../util/panelWidth";

const {
  defaultWidth: FILES_SIDEBAR_DEFAULT_WIDTH,
  maxWidth: FILES_SIDEBAR_MAX_WIDTH,
  minWidth: FILES_SIDEBAR_MIN_WIDTH,
  storageKey: FILES_SIDEBAR_WIDTH_STORAGE_KEY,
} = FILES_SIDEBAR_WIDTH;

const file = (name: string): DirEntry => ({ name, type: "file" });

type Props = React.ComponentProps<typeof Sidebar>;

function setup(overrides: Partial<Props> = {}) {
  const handlers = { onExpand: vi.fn(), onSelectFile: vi.fn() };
  const props: Props = { tree: { "": [file("readme.md")] }, openFile: null, ...handlers, ...overrides };
  const view = render(<Sidebar {...props} />);
  return { ...handlers, ...view };
}

describe("Sidebar", () => {
  beforeEach(() => localStorage.clear());

  it("asks for the root listing on mount, when it has none", () => {
    const { onExpand } = setup({ tree: {} as Record<string, DirState> });
    expect(onExpand).toHaveBeenCalledWith("");
  });

  it("does not re-ask for a root it already holds", () => {
    const { onExpand } = setup();
    expect(onExpand).not.toHaveBeenCalled();
  });

  it("asks only once, however often it re-renders", () => {
    const onExpand = vi.fn();
    const { rerender } = render(<Sidebar tree={{}} openFile={null} onExpand={onExpand} onSelectFile={vi.fn()} />);
    rerender(<Sidebar tree={{}} openFile={null} onExpand={onExpand} onSelectFile={vi.fn()} />);
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("shows the tree under a heading", () => {
    setup();
    expect(screen.getByText("Files")).toBeInTheDocument();
    expect(screen.getByText("readme.md")).toBeInTheDocument();
  });

  it("passes a file selection straight through", () => {
    const { onSelectFile } = setup();
    fireEvent.click(screen.getByText("readme.md"));
    expect(onSelectFile).toHaveBeenCalledWith("readme.md");
  });

  it("tells the tree which file the viewer has open", () => {
    const open: OpenFile = { status: "loaded", path: "readme.md", content: "", size: 0, mtimeMs: 1 };
    setup({ openFile: open });
    expect(screen.getByText("readme.md").closest("div")!.className).toMatch(/bg-zinc-100/);
  });

  it("forwards the git badges it is given", () => {
    setup({ gitFiles: { "readme.md": "modified" } });
    expect(screen.getByRole("button", { name: "Show diff of readme.md" })).toBeInTheDocument();
  });

  it("forwards the writable zone, so the tree can dim what is read-only", () => {
    setup({ writableRoot: null });
    expect(screen.getByText("readme.md").className).toMatch(/(^|\s)text-zinc-400\b/);
  });

  it("Resize with pointer input: follows the horizontal pointer and commits only when the drag ends", () => {
    setup();
    const sidebar = screen.getByRole("complementary", { name: "Files" });
    const separator = screen.getByRole("separator", { name: "Resize Files sidebar" });

    expect(sidebar).toHaveStyle({ width: `${FILES_SIDEBAR_DEFAULT_WIDTH}px` });
    fireEvent.pointerDown(separator, { pointerId: 7, clientX: FILES_SIDEBAR_DEFAULT_WIDTH, button: 0, isPrimary: true });
    fireEvent.pointerMove(separator, { pointerId: 7, clientX: 400 });

    expect(sidebar).toHaveStyle({ width: "400px" });
    expect(localStorage.getItem(FILES_SIDEBAR_WIDTH_STORAGE_KEY)).toBeNull();

    fireEvent.pointerUp(separator, { pointerId: 7, clientX: 400 });
    expect(localStorage.getItem(FILES_SIDEBAR_WIDTH_STORAGE_KEY)).toBe("400");
  });

  it("Enforce resizing bounds: clamps pointer movement at both boundaries", () => {
    setup();
    const sidebar = screen.getByRole("complementary", { name: "Files" });
    const separator = screen.getByRole("separator", { name: "Resize Files sidebar" });

    fireEvent.pointerDown(separator, { pointerId: 1, clientX: FILES_SIDEBAR_DEFAULT_WIDTH, button: 0, isPrimary: true });
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: -1000 });
    expect(sidebar).toHaveStyle({ width: `${FILES_SIDEBAR_MIN_WIDTH}px` });
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 2000 });
    expect(sidebar).toHaveStyle({ width: `${FILES_SIDEBAR_MAX_WIDTH}px` });
    fireEvent.pointerUp(separator, { pointerId: 1, clientX: 2000 });
  });

  it("reverts an interrupted pointer resize without persisting it", () => {
    setup();
    const sidebar = screen.getByRole("complementary", { name: "Files" });
    const separator = screen.getByRole("separator", { name: "Resize Files sidebar" });

    fireEvent.pointerDown(separator, { pointerId: 3, clientX: FILES_SIDEBAR_DEFAULT_WIDTH, button: 0, isPrimary: true });
    fireEvent.pointerMove(separator, { pointerId: 3, clientX: 420 });
    fireEvent.pointerCancel(separator, { pointerId: 3 });

    expect(sidebar).toHaveStyle({ width: `${FILES_SIDEBAR_DEFAULT_WIDTH}px` });
    expect(localStorage.getItem(FILES_SIDEBAR_WIDTH_STORAGE_KEY)).toBeNull();
  });

  it("ignores non-primary pointer buttons", () => {
    setup();
    const sidebar = screen.getByRole("complementary", { name: "Files" });
    const separator = screen.getByRole("separator", { name: "Resize Files sidebar" });

    fireEvent.pointerDown(separator, { pointerId: 4, clientX: FILES_SIDEBAR_DEFAULT_WIDTH, button: 2, isPrimary: true });
    fireEvent.pointerMove(separator, { pointerId: 4, clientX: 420 });

    expect(sidebar).toHaveStyle({ width: `${FILES_SIDEBAR_DEFAULT_WIDTH}px` });
    expect(localStorage.getItem(FILES_SIDEBAR_WIDTH_STORAGE_KEY)).toBeNull();
  });

  it("Resize with the keyboard: changes by one step, resets with Home, and updates ARIA", () => {
    setup();
    const sidebar = screen.getByRole("complementary", { name: "Files" });
    const separator = screen.getByRole("separator", { name: "Resize Files sidebar" });

    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(sidebar).toHaveStyle({ width: "304px" });
    expect(separator).toHaveAttribute("aria-valuenow", "304");
    expect(localStorage.getItem(FILES_SIDEBAR_WIDTH_STORAGE_KEY)).toBe("304");

    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(sidebar).toHaveStyle({ width: `${FILES_SIDEBAR_DEFAULT_WIDTH}px` });
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    fireEvent.keyDown(separator, { key: "Home" });
    expect(sidebar).toHaveStyle({ width: `${FILES_SIDEBAR_DEFAULT_WIDTH}px` });
  });

  it("Restore the preferred width: restores a completed resize after remounting", () => {
    const first = setup();
    const separator = screen.getByRole("separator", { name: "Resize Files sidebar" });
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    first.unmount();

    setup();
    expect(screen.getByRole("complementary", { name: "Files" })).toHaveStyle({ width: "304px" });
  });

  it("Recover from an invalid stored preference: defaults malformed values and clamps finite ones", () => {
    localStorage.setItem(FILES_SIDEBAR_WIDTH_STORAGE_KEY, "not-a-width");
    const malformed = setup();
    expect(screen.getByRole("complementary", { name: "Files" })).toHaveStyle({
      width: `${FILES_SIDEBAR_DEFAULT_WIDTH}px`,
    });
    malformed.unmount();

    localStorage.setItem(FILES_SIDEBAR_WIDTH_STORAGE_KEY, "9999");
    setup();
    expect(screen.getByRole("complementary", { name: "Files" })).toHaveStyle({
      width: `${FILES_SIDEBAR_MAX_WIDTH}px`,
    });
  });
});


describe("sidebar external-drop containment", () => {
  it("keeps drops inside the tree when imports are available, including read-only trees", () => {
    const onDrop = vi.fn();
    const onUploadFile = vi.fn(async () => "unused");
    render(<div onDrop={onDrop}><Sidebar tree={{ "": [] }} openFile={null} writableRoot={null} onExpand={vi.fn()} onSelectFile={vi.fn()} onUploadFile={onUploadFile} /></div>);
    fireEvent.drop(screen.getByRole("complementary", { name: "Files" }), { dataTransfer: { types: ["Files"], files: [] } });
    expect(onDrop).not.toHaveBeenCalled();
    expect(onUploadFile).not.toHaveBeenCalled();
  });
  it("preserves the host's drop handler when no import callback was supplied", () => {
    const onDrop = vi.fn();
    render(<div onDrop={onDrop}><Sidebar tree={{ "": [] }} openFile={null} onExpand={vi.fn()} onSelectFile={vi.fn()} /></div>);
    fireEvent.drop(screen.getByRole("complementary", { name: "Files" }), { dataTransfer: { types: ["Files"], files: [] } });
    expect(onDrop).toHaveBeenCalledTimes(1);
  });
  it("contains the complete external drag lifecycle and clears the host overlay", () => {
    const host = vi.fn();
    const clearOverlay = vi.fn();
    render(<div onDragEnter={host} onDragLeave={host} onDragOver={host} onDrop={host}><Sidebar tree={{ "": [] }} openFile={null} onExpand={vi.fn()} onSelectFile={vi.fn()} onUploadFile={vi.fn()} onExternalDragEnter={clearOverlay} /></div>);
    const target = screen.getByRole("complementary", { name: "Files" });
    const dataTransfer = { types: ["Files"], files: [], dropEffect: "copy" };
    fireEvent.dragEnter(target, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    expect(dataTransfer.dropEffect).toBe("none");
    fireEvent.dragLeave(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    expect(host).not.toHaveBeenCalled();
    expect(clearOverlay).toHaveBeenCalledTimes(2);
  });

});
