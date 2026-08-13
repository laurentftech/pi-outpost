import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ToolCard } from "./ToolCard";
import type { ChatItem } from "@pi-outpost/shared";

vi.mock("react-markdown", () => ({
  default: ({ children }: any) => <div data-testid="markdown">{children}</div>,
}));
vi.mock("rehype-katex", () => ({ default: () => ({}) }));
vi.mock("remark-gfm", () => ({ default: () => ({}) }));
vi.mock("remark-math", () => ({ default: () => ({}) }));

type ToolItem = Extract<ChatItem, { kind: "tool" }>;

function tool(partial: Partial<ToolItem>): ToolItem {
  return { kind: "tool", toolName: "bash", running: false, isError: false, ...partial } as ToolItem;
}

function cardRoot(container: HTMLElement): HTMLElement {
  return container.children[0] as HTMLElement;
}

describe("ToolCard collapsed extension rendering", () => {
  it("shows the compact rendering the extension supplied while folded", () => {
    const { container } = render(
      <ToolCard
        item={tool({
          outputHtml: "<b>full body</b>",
          outputHtmlCollapsed: "<i>compact</i>",
        })}
      />,
    );

    const root = cardRoot(container);
    expect(root.children.length).toBe(2);
    expect(root).toHaveTextContent("compact");
    expect(root).not.toHaveTextContent("full body");
  });

  it("shows the full rendering once expanded", () => {
    const { container } = render(
      <ToolCard item={tool({ outputHtml: "<b>full body</b>", outputHtmlCollapsed: "<i>compact</i>" })} />,
    );

    fireEvent.click(cardRoot(container).querySelector("button")!);
    expect(cardRoot(container)).toHaveTextContent("full body");
  });

  it("stays a bare header when the extension supplied no compact rendering", () => {
    const { container } = render(<ToolCard item={tool({ outputHtml: "<b>full body</b>" })} />);

    const root = cardRoot(container);
    expect(root.children.length).toBe(1);
    expect(root.children[0].tagName).toBe("BUTTON");
  });
});

describe("ToolCard output is inert", () => {
  const HOSTILE = '<script>alert(1)</script><img src=x onerror="alert(2)">';

  it("never parses a tool's own output as markup", () => {
    const { container } = render(<ToolCard item={tool({ output: HOSTILE })} />);
    fireEvent.click(cardRoot(container).querySelector("button")!);

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("pre")?.textContent).toBe(HOSTILE);
  });

  it("never reaches the HTML pipeline from output alone", () => {
    const { container } = render(<ToolCard item={tool({ output: HOSTILE })} />);
    fireEvent.click(cardRoot(container).querySelector("button")!);

    // RenderedHtml is the only innerHTML sink; it is reached from outputHtml and
    // callHtml — the extension channel — and from nothing the tool itself wrote.
    expect(container.querySelector(".rendered-ansi")).toBeNull();
  });

  it("keeps the raw output reachable behind a reveal when a presentation reshapes it", () => {
    const output = ["src/a.ts:1:hit", "src/a.ts:2:hit again"].join("\n");
    const { container } = render(<ToolCard item={tool({ toolName: "grep", args: { pattern: "hit" }, output })} />);

    fireEvent.click(cardRoot(container).querySelector("button")!);
    expect(container.querySelector("pre")).toBeNull();

    fireEvent.click(screen.getByText("raw output"));
    expect(container.querySelector("pre")?.textContent).toBe(output);
  });
});

describe("ToolCard presentation stability", () => {
  it("does not swap renderer when the output of a running call lands", () => {
    const running = tool({ args: { command: "git diff" }, running: true });
    const { container, rerender } = render(<ToolCard item={running} />);

    fireEvent.click(cardRoot(container).querySelector("button")!);
    expect(cardRoot(container)).toHaveTextContent("running…");

    // The command was a diff; the output is an error. The card keeps the
    // presentation it already showed and falls back inside it.
    rerender(<ToolCard item={tool({ args: { command: "git diff" }, output: "fatal: not a git repository" })} />);
    expect(container.querySelector("pre")?.textContent).toBe("fatal: not a git repository");
    expect(screen.getByText("raw output")).toBeInTheDocument();
  });
});
