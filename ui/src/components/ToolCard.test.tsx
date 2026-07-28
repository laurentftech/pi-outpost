import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolCard } from "./ToolCard";
import type { ChatItem } from "@pi-outpost/shared";

vi.mock("react-markdown", () => ({
  default: ({ children }: any) => <div data-testid="markdown">{children}</div>,
}));

vi.mock("rehype-katex", () => ({ default: () => ({}) }));
vi.mock("remark-gfm", () => ({ default: () => ({}) }));
vi.mock("remark-math", () => ({ default: () => ({}) }));

vi.mock("../util/diff", () => ({
  diffLines: vi.fn(() => [
    { type: "del" as const, text: "old line" },
    { type: "add" as const, text: "new line" },
  ]),
}));

vi.mock("./DiffBlocks", () => ({
  DiffBlock: ({ lines }: any) => <div data-testid="diff-block">{lines.length} lines</div>,
  SplitDiffBlock: ({ lines }: any) => <div data-testid="split-diff-block">{lines.length} diff lines</div>,
}));

vi.mock("./RenderedHtml", () => ({
  RenderedHtml: ({ html }: any) => <div data-testid="rendered-html">{html}</div>,
}));

vi.mock("../util/toolOutput", () => ({
  getFormattedToolOutput: vi.fn((output) => {
    if (typeof output === "string" && output.includes("__pi_render")) {
      return "formatted output";
    }
    return undefined;
  }),
}));

type ToolItem = Extract<ChatItem, { kind: "tool" }>;

/** The ToolCard root is always container.children[0] (testing-library wraps output in a div). */
function cardRoot(container: HTMLElement): HTMLElement {
  return container.children[0] as HTMLElement;
}

describe("ToolCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders running tool with amber dot", () => {
    const item: ToolItem = {
      kind: "tool",
      toolName: "bash",
      running: true,
      isError: false,
      args: { command: "ls -la" },
    };

    const { container } = render(<ToolCard item={item} />);

    const button = cardRoot(container).querySelector("button");
    const statusDot = button?.querySelector("span");
    expect(statusDot).toHaveClass("animate-pulse");
    expect(statusDot).toHaveClass("bg-amber-400");
  });

  it("renders error tool with red dot", () => {
    const item: ToolItem = {
      kind: "tool",
      toolName: "bash",
      running: false,
      isError: true,
      args: { command: "invalid-command" },
    };

    const { container } = render(<ToolCard item={item} />);

    const button = cardRoot(container).querySelector("button");
    const statusDot = button?.querySelector("span");
    expect(statusDot).toHaveClass("bg-red-500");
    expect(statusDot).not.toHaveClass("animate-pulse");
  });

  it("renders completed tool with emerald dot", () => {
    const item: ToolItem = {
      kind: "tool",
      toolName: "bash",
      running: false,
      isError: false,
      args: { command: "echo hello" },
      output: "hello\n",
    };

    const { container } = render(<ToolCard item={item} />);

    const button = cardRoot(container).querySelector("button");
    const statusDot = button?.querySelector("span");
    expect(statusDot).toHaveClass("bg-emerald-500");
    expect(statusDot).not.toHaveClass("animate-pulse");
  });

  it("renders tool with callHtml in header", () => {
    const item: ToolItem = {
      kind: "tool",
      toolName: "bash",
      running: false,
      isError: false,
      callHtml: "<div>Custom HTML</div>",
    };

    render(<ToolCard item={item} />);

    const renderedHtml = screen.getAllByTestId("rendered-html")[0];
    expect(renderedHtml).toBeInTheDocument();
    expect(renderedHtml).toHaveTextContent("<div>Custom HTML</div>");
  });

  it("renders tool with command summary in args", () => {
    const item: ToolItem = {
      kind: "tool",
      toolName: "bash",
      running: false,
      isError: false,
      args: { command: "npm install" },
    };

    const { container } = render(<ToolCard item={item} />);

    expect(cardRoot(container).querySelector("span[class*='font-mono']")?.textContent).toBe("bash");
    expect(cardRoot(container).querySelector("span[class*='text-xs']")?.textContent).toBe("npm install");
  });

  it("renders tool with formatted output in collapsed state", () => {
    const item: ToolItem = {
      kind: "tool",
      toolName: "bash",
      running: false,
      isError: false,
      args: { command: "echo test" },
      output: "__pi_render: formatted output",
    };

    render(<ToolCard item={item} />);

    const markdownElements = screen.getAllByTestId("markdown");
    expect(markdownElements.length).toBeGreaterThan(0);
    expect(markdownElements[0]).toHaveTextContent("formatted output");
  });

  it("renders edit tool with before/after pairs", () => {
    const item: ToolItem = {
      kind: "tool",
      toolName: "edit",
      running: false,
      isError: false,
      args: {
        edits: [
          { oldText: "old content", newText: "new content" },
        ],
      },
    };

    render(<ToolCard item={item} />);

    const splitDiffBlocks = screen.getAllByTestId("split-diff-block");
    expect(splitDiffBlocks.length).toBeGreaterThan(0);
  });

  it("renders write tool with new content", () => {
    const item: ToolItem = {
      kind: "tool",
      toolName: "write",
      running: false,
      isError: false,
      args: {
        content: "new file content\nline 2\n",
      },
    };

    render(<ToolCard item={item} />);

    const diffBlocks = screen.getAllByTestId("diff-block");
    expect(diffBlocks.length).toBeGreaterThan(0);
  });

  it("renders tool with outputHtml in expanded content", () => {
    const item: ToolItem = {
      kind: "tool",
      toolName: "bash",
      running: false,
      isError: false,
      callHtml: "<div>Call HTML</div>",
      outputHtml: "<div>Rendered HTML output</div>",
    };

    const { container } = render(<ToolCard item={item} />);

    const button = cardRoot(container).querySelector("button");
    if (button) fireEvent.click(button);

    const renderedHtmlElements = screen.getAllByTestId("rendered-html");
    expect(renderedHtmlElements.length).toBeGreaterThan(1);
    expect(renderedHtmlElements[1]).toHaveTextContent("<div>Rendered HTML output</div>");
  });

  it("renders tool with plain text output", () => {
    const item: ToolItem = {
      kind: "tool",
      toolName: "bash",
      running: false,
      isError: false,
      output: "plain text output\nline 2\n",
    };

    const { container } = render(<ToolCard item={item} />);

    const button = cardRoot(container).querySelector("button");
    if (button) fireEvent.click(button);

    const preElement = cardRoot(container).querySelector("pre");
    expect(preElement?.textContent).toContain("plain text output");
    expect(preElement?.textContent).toContain("line 2");
  });

  it("renders tool with no output", () => {
    const item: ToolItem = {
      kind: "tool",
      toolName: "bash",
      running: false,
      isError: false,
      args: { command: "echo" },
    };

    const { container } = render(<ToolCard item={item} />);

    const button = cardRoot(container).querySelector("button");
    if (button) fireEvent.click(button);

    expect(cardRoot(container)).toHaveTextContent("(no output)");
  });

  it("toggles expand/collapse state", () => {
    const item: ToolItem = {
      kind: "tool",
      toolName: "bash",
      running: false,
      isError: false,
      output: "test output",
    };

    const { container } = render(<ToolCard item={item} />);
    const root = cardRoot(container);

    expect(root.children.length).toBe(1);
    expect(root.children[0].tagName).toBe("BUTTON");

    const button = root.querySelector("button");
    if (button) fireEvent.click(button);

    expect(root.children.length).toBe(2);
    expect(root.children[1]).toHaveTextContent("test output");

    if (button) fireEvent.click(button);

    expect(root.children.length).toBe(1);
  });

  it("starts expanded for edit/write tools", () => {
    const editItem: ToolItem = {
      kind: "tool",
      toolName: "edit",
      running: false,
      isError: false,
      args: {
        edits: [{ oldText: "old", newText: "new" }],
      },
    };

    const writeItem: ToolItem = {
      kind: "tool",
      toolName: "write",
      running: false,
      isError: false,
      args: {
        content: "new content",
      },
    };

    const editRoot = cardRoot(render(<ToolCard item={editItem} />).container);
    const writeRoot = cardRoot(render(<ToolCard item={writeItem} />).container);

    expect(editRoot.children.length).toBe(2);
    expect(writeRoot.children.length).toBe(2);
  });

  it("starts collapsed for non-edit/write tools", () => {
    const item: ToolItem = {
      kind: "tool",
      toolName: "bash",
      running: false,
      isError: false,
      output: "test output",
    };

    const root = cardRoot(render(<ToolCard item={item} />).container);

    expect(root.children.length).toBe(1);
    expect(root.children[0].tagName).toBe("BUTTON");
  });

  it("shows running message when tool is running with no output", () => {
    const item: ToolItem = {
      kind: "tool",
      toolName: "bash",
      running: true,
      isError: false,
      args: { command: "long-running-command" },
    };

    const { container } = render(<ToolCard item={item} />);

    const button = cardRoot(container).querySelector("button");
    if (button) fireEvent.click(button);

    expect(cardRoot(container)).toHaveTextContent("running…");
  });
});
