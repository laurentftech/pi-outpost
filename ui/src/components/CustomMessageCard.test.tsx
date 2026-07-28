import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CustomMessageCard } from "./CustomMessageCard";
import type { ChatItem } from "@pi-outpost/shared";

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));
vi.mock("rehype-katex", () => ({ default: vi.fn() }));
vi.mock("remark-gfm", () => ({ default: vi.fn() }));
vi.mock("remark-math", () => ({ default: vi.fn() }));

vi.mock("./RenderedHtml", () => ({
  RenderedHtml: ({ html, className }: { html: string; className?: string }) => (
    <div data-testid="rendered-html" className={className}>{html}</div>
  ),
}));

describe("CustomMessageCard", () => {
  it("shows [customType] badge", () => {
    render(<CustomMessageCard item={{ kind: "custom", customType: "myExt", text: "Hi" }} />);
    expect(screen.getByText("[myExt]")).toBeInTheDocument();
  });

  it("renders HTML when contentHtml exists", () => {
    render(<CustomMessageCard item={{ kind: "custom", customType: "t", contentHtml: "<p>HTML</p>" }} />);
    expect(screen.getByTestId("rendered-html")).toBeInTheDocument();
  });

  it("renders markdown when no contentHtml", () => {
    render(<CustomMessageCard item={{ kind: "custom", customType: "t", text: "# md" }} />);
    expect(screen.getByTestId("markdown")).toBeInTheDocument();
  });

  it("shows toggle when details exist", () => {
    render(<CustomMessageCard item={{ kind: "custom", customType: "t", text: "m", details: { k: "v" } }} />);
    expect(screen.getByTitle("Show details")).toBeInTheDocument();
  });

  it("shows toggle when contentHtmlCollapsed exists", () => {
    render(<CustomMessageCard item={{ kind: "custom", customType: "t", contentHtml: "<p>F</p>", contentHtmlCollapsed: "<p>C</p>" }} />);
    expect(screen.getByTitle("Show details")).toBeInTheDocument();
  });

  it("hides toggle when no details or collapsed", () => {
    render(<CustomMessageCard item={{ kind: "custom", customType: "t", text: "simple" }} />);
    expect(screen.queryByTitle("Show details")).not.toBeInTheDocument();
  });

  it("toggles details panel", () => {
    render(<CustomMessageCard item={{ kind: "custom", customType: "t", text: "m", details: { key: "val" } }} />);
    const btn = screen.getByTitle("Show details");
    expect(screen.queryByText(/"key"/)).not.toBeInTheDocument();
    fireEvent.click(btn);
    expect(screen.getByText(/"key"/)).toBeInTheDocument();
    fireEvent.click(btn);
    expect(screen.queryByText(/"key"/)).not.toBeInTheDocument();
  });

  it("shows JSON details when expanded", () => {
    render(<CustomMessageCard item={{ kind: "custom", customType: "t", text: "m", details: { arr: [1] } }} />);
    fireEvent.click(screen.getByTitle("Show details"));
    expect(screen.getByText(/"arr"/)).toBeInTheDocument();
  });

  it("uses contentHtmlCollapsed for preview", () => {
    render(<CustomMessageCard item={{ kind: "custom", customType: "t", contentHtml: "<p>Full</p>", contentHtmlCollapsed: "<p>Preview</p>" }} />);
    expect(screen.getByText("<p>Preview</p>")).toBeInTheDocument();
  });

  it("uses full contentHtml when expanded", () => {
    render(<CustomMessageCard item={{ kind: "custom", customType: "t", contentHtml: "<p>Full</p>", contentHtmlCollapsed: "<p>Prev</p>" }} />);
    fireEvent.click(screen.getByTitle("Show details"));
    expect(screen.getByText("<p>Full</p>")).toBeInTheDocument();
  });
});
