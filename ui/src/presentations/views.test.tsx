import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CodeSearchView, codeSearchPresentation } from "./CodeSearchView";
import { GitDiffView, gitDiffCommand, gitDiffPresentation } from "./GitDiffView";
import { parseSearchHits, countHits } from "./parseSearchHits";
import { parseUnifiedDiff } from "./parseUnifiedDiff";
import type { ToolItem } from "./types";

vi.mock("../components/DiffBlocks", () => ({
  DiffBlock: ({ lines }: any) => <div data-testid="diff-block">{lines.length} lines</div>,
  SplitDiffBlock: ({ lines }: any) => <div data-testid="split-diff-block">{lines.length} lines</div>,
}));

function tool(partial: Partial<ToolItem>): ToolItem {
  return { kind: "tool", toolName: "bash", running: false, isError: false, ...partial } as ToolItem;
}

const DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 111..222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,3 +1,3 @@",
  " keep",
  "-old",
  "+new",
  "+also new",
  "diff --git a/src/b.ts b/src/b.ts",
  "--- /dev/null",
  "+++ b/src/b.ts",
  "@@ -0,0 +1,1 @@",
  "+created",
].join("\n");

describe("parseUnifiedDiff", () => {
  it("splits per file and counts additions and removals", () => {
    const files = parseUnifiedDiff(DIFF);
    expect(files.map((f) => f.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(files[0]).toMatchObject({ added: 2, removed: 1 });
    expect(files[0].lines).toHaveLength(4);
    expect(files[1]).toMatchObject({ added: 1, removed: 0 });
  });

  it("reads a git show result, commit header and all", () => {
    const show = ["commit abc123", "Author: Someone", "", "    a message", "", DIFF].join("\n");
    expect(parseUnifiedDiff(show).map((f) => f.path)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("yields nothing for output that is not a diff", () => {
    expect(parseUnifiedDiff("fatal: not a git repository")).toEqual([]);
    expect(parseUnifiedDiff("")).toEqual([]);
  });
});

describe("gitDiffCommand", () => {
  it("claims only a command that starts with git diff or git show", () => {
    expect(gitDiffCommand(tool({ args: { command: "git diff" } }))).toBe("git diff");
    expect(gitDiffCommand(tool({ args: { command: "  git show HEAD" } }))).toBe("  git show HEAD");
    expect(gitDiffCommand(tool({ args: { command: "git difftool" } }))).toBeNull();
    expect(gitDiffCommand(tool({ args: { command: "echo git diff" } }))).toBeNull();
    expect(gitDiffCommand(tool({ toolName: "read", args: { command: "git diff" } }))).toBeNull();
    expect(gitDiffCommand(tool({ args: null }))).toBeNull();
  });
});

describe("GitDiffView", () => {
  it("shows a header per file with its added and removed counts", () => {
    render(<GitDiffView item={tool({ args: { command: "git diff" }, output: DIFF })} dispatch={vi.fn()} />);

    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(screen.getByText("src/b.ts")).toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.getByText("−1")).toBeInTheDocument();
    expect(screen.getAllByTestId("diff-block")).toHaveLength(2);
  });

  it("names an action rather than acting: open and history dispatch by path", () => {
    const dispatch = vi.fn();
    render(<GitDiffView item={tool({ args: { command: "git diff" }, output: DIFF })} dispatch={dispatch} />);

    fireEvent.click(screen.getAllByText("open")[0]);
    fireEvent.click(screen.getAllByText("history")[0]);

    expect(dispatch).toHaveBeenNthCalledWith(1, { kind: "openFile", path: "src/a.ts" });
    expect(dispatch).toHaveBeenNthCalledWith(2, { kind: "openFileHistory", path: "src/a.ts" });
  });

  it("falls back to the raw output when the command matched but the output is not a diff", () => {
    const { container } = render(
      <GitDiffView item={tool({ args: { command: "git diff" }, output: "fatal: not a git repository" })} dispatch={vi.fn()} />,
    );
    expect(container.querySelector("pre")?.textContent).toBe("fatal: not a git repository");
  });

  it("holds back the tail of a large diff behind one reveal", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      [`diff --git a/src/f${i}.ts b/src/f${i}.ts`, `--- a/src/f${i}.ts`, `+++ b/src/f${i}.ts`, "@@ -1 +1 @@", "+x"].join("\n"),
    ).join("\n");
    render(<GitDiffView item={tool({ args: { command: "git diff" }, output: many })} dispatch={vi.fn()} />);

    expect(screen.queryByText("src/f8.ts")).toBeNull();
    fireEvent.click(screen.getByText("show 3 more files"));
    expect(screen.getByText("src/f8.ts")).toBeInTheDocument();
  });

  it("matches on the command alone, before any output exists", () => {
    expect(gitDiffPresentation.match(tool({ args: { command: "git diff" }, running: true }))).toBe(true);
    expect(gitDiffPresentation.stable).toBe(true);
  });
});

const HITS = [
  "src/a.ts:12:const needle = 1;",
  "src/a.ts:40:  needle();",
  "src/b.ts:3:// needle",
  "not a hit line",
].join("\n");

describe("parseSearchHits", () => {
  it("groups by file in first-seen order", () => {
    const groups = parseSearchHits(HITS);
    expect(groups.map((g) => g.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(groups[0].hits).toEqual([
      { line: 12, text: "const needle = 1;" },
      { line: 40, text: "  needle();" },
    ]);
    expect(countHits(groups)).toBe(3);
  });

  it("yields nothing for output with no path:line:text lines", () => {
    expect(parseSearchHits("No matches found")).toEqual([]);
  });
});

describe("CodeSearchView", () => {
  it("counts matches and files", () => {
    render(<CodeSearchView item={tool({ toolName: "grep", output: HITS })} dispatch={vi.fn()} />);
    expect(screen.getByText("3 matches in 2 files")).toBeInTheDocument();
  });

  it("opens a file by dispatching, not by messaging the server", () => {
    const dispatch = vi.fn();
    render(<CodeSearchView item={tool({ toolName: "grep", output: HITS })} dispatch={dispatch} />);

    fireEvent.click(screen.getByText("src/b.ts"));
    expect(dispatch).toHaveBeenCalledWith({ kind: "openFile", path: "src/b.ts" });
  });

  it("falls back to the raw output when nothing parses as a hit", () => {
    const { container } = render(
      <CodeSearchView item={tool({ toolName: "grep", output: "No matches found" })} dispatch={vi.fn()} />,
    );
    expect(container.querySelector("pre")?.textContent).toBe("No matches found");
  });

  it("holds back the tail of a long hit list behind one reveal", () => {
    const many = Array.from({ length: 10 }, (_, i) => `src/f${i}.ts:1:hit`).join("\n");
    render(<CodeSearchView item={tool({ toolName: "grep", output: many })} dispatch={vi.fn()} />);

    expect(screen.queryByText("src/f9.ts")).toBeNull();
    fireEvent.click(screen.getByText("show 2 more files"));
    expect(screen.getByText("src/f9.ts")).toBeInTheDocument();
  });

  it("caps the hits shown per file and says how many it kept back", () => {
    const many = Array.from({ length: 7 }, (_, i) => `src/a.ts:${i + 1}:hit`).join("\n");
    render(<CodeSearchView item={tool({ toolName: "grep", output: many })} dispatch={vi.fn()} />);

    expect(screen.getByText("+2 more in this file")).toBeInTheDocument();
  });

  it("matches on the tool identity alone, before any output exists", () => {
    expect(codeSearchPresentation.match(tool({ toolName: "grep", running: true }))).toBe(true);
    expect(codeSearchPresentation.match(tool({ toolName: "bash", output: HITS }))).toBe(false);
    expect(codeSearchPresentation.stable).toBe(true);
  });

  it("keeps matched text inert — a hit that looks like markup stays text", () => {
    const { container } = render(
      <CodeSearchView item={tool({ toolName: "grep", output: "src/a.ts:1:<script>alert(1)</script>" })} dispatch={vi.fn()} />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container).toHaveTextContent("<script>alert(1)</script>");
  });
});
