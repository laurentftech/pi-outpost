import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ContentSearchHit, DirEntry } from "@pi-outpost/shared";
import { Sidebar } from "./Sidebar";
import type { ContentSearch, DirState, OpenFile } from "../useAgent";
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

describe("Sidebar content search", () => {
  beforeEach(() => localStorage.clear());

  const lineHit: ContentSearchHit = { path: "src/app.ts", kind: "line", line: 12, column: 6, excerpt: "const Needle = 1;" };
  const secondLine: ContentSearchHit = { path: "src/app.ts", kind: "line", line: 30, column: 0, excerpt: "needle again" };
  const pageHit: ContentSearchHit = { path: "docs/report.pdf", kind: "pdf-page", page: 3, excerpt: "the needle on page three" };
  const loaded = (hits: ContentSearchHit[], extra: Partial<ContentSearch> = {}): ContentSearch => ({
    status: "loaded", query: "needle", requestId: "r1", hits, truncated: false, skipped: 0, ...extra,
  });

  function open(overrides: Partial<Props> = {}) {
    const onSearchContent = vi.fn();
    const onOpenSearchHit = vi.fn();
    const view = setup({ onSearchContent, onOpenSearchHit, ...overrides });
    fireEvent.click(screen.getByRole("button", { name: "Search in files" }));
    return { onSearchContent, onOpenSearchHit, ...view };
  }

  it("is not offered without a search handler", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Search in files" })).toBeNull();
  });

  it("runs the search on Enter, with the query as typed", () => {
    const { onSearchContent } = open();
    const input = screen.getByRole("searchbox", { name: "Text to search for in files" });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "needle" } });
    expect(onSearchContent).not.toHaveBeenCalled();
    fireEvent.submit(input.closest("form")!);
    expect(onSearchContent).toHaveBeenCalledWith("needle");
  });

  it("EmptyContentSearch: with an empty query no matches are shown", () => {
    open({ contentSearch: null });
    expect(screen.queryByRole("list", { name: "Search results" })).toBeNull();
    expect(screen.queryByText("No matches")).toBeNull();
  });

  it("SearchAcrossWorkspaceFiles: hits grouped by file, with line or page and the match marked", () => {
    open({ contentSearch: loaded([lineHit, secondLine, pageHit]) });

    expect(screen.getByRole("status")).toHaveTextContent("3 matches in 2 files");
    const results = screen.getByRole("list", { name: "Search results" });
    expect(results).toHaveTextContent("src/app.ts");
    expect(results).toHaveTextContent("docs/report.pdf");
    const line = screen.getByRole("button", { name: "src/app.ts, line 12" });
    expect(line).toHaveTextContent("12");
    expect(line.querySelector("mark")).toHaveTextContent("Needle");
    expect(screen.getByRole("button", { name: "docs/report.pdf, page 3" })).toHaveTextContent("p. 3");
  });

  it("NoContentMatches: a finished search with no hits says so", () => {
    open({ contentSearch: loaded([]) });
    expect(screen.getByRole("status")).toHaveTextContent("No matches");
  });

  it("says when results are partial, and how many PDFs could not be read", () => {
    open({ contentSearch: loaded([lineHit], { truncated: true, skipped: 2 }) });
    expect(screen.getByRole("status")).toHaveTextContent("partial results");
    expect(screen.getByRole("status")).toHaveTextContent("2 PDFs could not be read.");
  });

  it("shows a search in progress", () => {
    open({ contentSearch: { ...loaded([]), status: "loading" } });
    expect(screen.getByRole("status")).toHaveTextContent("Searching…");
  });

  it("selecting a hit opens it with the query it answered", () => {
    const { onOpenSearchHit } = open({ contentSearch: loaded([lineHit, pageHit]) });
    fireEvent.click(screen.getByRole("button", { name: "src/app.ts, line 12" }));
    expect(onOpenSearchHit).toHaveBeenCalledWith(lineHit, "needle");
    fireEvent.click(screen.getByRole("button", { name: "docs/report.pdf, page 3" }));
    expect(onOpenSearchHit).toHaveBeenCalledWith(pageHit, "needle");
  });

  it("Escape goes back to the tree and keeps the query for the next open", () => {
    open();
    const input = screen.getByRole("searchbox", { name: "Text to search for in files" });
    fireEvent.change(input, { target: { value: "needle" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.getByText("readme.md")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Search in files" }));
    expect(screen.getByRole("searchbox", { name: "Text to search for in files" })).toHaveValue("needle");
  });
});
