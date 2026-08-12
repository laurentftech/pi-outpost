import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { DirEntry } from "@pi-outpost/shared";
import { Sidebar } from "./Sidebar";
import type { DirState, OpenFile } from "../useAgent";

const file = (name: string): DirEntry => ({ name, type: "file" });

type Props = React.ComponentProps<typeof Sidebar>;

function setup(overrides: Partial<Props> = {}) {
  const handlers = { onExpand: vi.fn(), onSelectFile: vi.fn() };
  const props: Props = { tree: { "": [file("readme.md")] }, openFile: null, ...handlers, ...overrides };
  const view = render(<Sidebar {...props} />);
  return { ...handlers, ...view };
}

describe("Sidebar", () => {
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
});
