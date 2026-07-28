import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RenderedHtml } from "./RenderedHtml";

function getContainer(html: string, props?: Record<string, unknown>) {
  const { container } = render(<RenderedHtml html={html} {...(props as any)} />);
  return container.firstElementChild as HTMLElement;
}

describe("RenderedHtml", () => {
  it("renders html string via dangerouslySetInnerHTML", () => {
    render(<RenderedHtml html="<p>Test paragraph</p>" />);
    expect(screen.getByText("Test paragraph")).toBeInTheDocument();
  });

  it("renders as div by default with 'rendered-ansi' class", () => {
    const el = getContainer("<span>Test</span>");
    expect(el).toHaveClass("rendered-ansi");
    expect(el.tagName).toBe("DIV");
  });

  it("accepts optional className prop", () => {
    const el = getContainer("<p>Test</p>", { className: "custom-class" });
    expect(el).toHaveClass("custom-class");
  });

  it("renders as span when as=span", () => {
    const el = getContainer("<span>Test</span>", { as: "span" });
    expect(el.tagName).toBe("SPAN");
  });

  it("applies font-mono and text-xs classes", () => {
    const el = getContainer("<p>Test</p>");
    expect(el).toHaveClass("font-mono", "text-xs");
  });

  it("handles empty html string", () => {
    const el = getContainer("");
    expect(el).toBeInTheDocument();
    expect(el.tagName).toBe("DIV");
  });
});
