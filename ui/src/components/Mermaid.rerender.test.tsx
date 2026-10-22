/**
 * A diagram drawn again must stay on screen.
 *
 * Before it renders, mermaid removes whatever element in the document already carries
 * the id it was given (`removeExistingElements` in mermaid.core.mjs:
 * `doc.getElementById(id)?.remove()`), and the SVG it returns carries that id. So a
 * component that renders every time under one id deletes its own diagram on each
 * render — invisibly when the new SVG differs, since React writes it back, and for good
 * when it is identical: React does not rewrite an unchanged `innerHTML`, and the block
 * is left with its buttons and no picture. Two orientation clicks inside the debounce
 * bring the diagram back to where it was, which is exactly that.
 *
 * The mock does what mermaid does at that boundary, and nothing else.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { Mermaid } from "./Mermaid";

const renderDiagram = vi.hoisted(() =>
  vi.fn(async (id: string, source: string) => {
    document.getElementById(id)?.remove();
    const direction = /flowchart (\w+)/.exec(source)?.[1] ?? "";
    return { svg: `<svg id="${id}" viewBox="0 0 400 200" width="100%"><g data-direction="${direction}"/></svg>` };
  }),
);
const initialize = vi.hoisted(() => vi.fn());

vi.mock("mermaid", () => ({ default: { initialize, render: renderDiagram } }));

const ACROSS = "flowchart LR\n  a[Start] --> b[End]";

async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(400);
  });
}

describe("a diagram drawn again", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderDiagram.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is still on screen after two turns that cancel out", async () => {
    const { container } = render(<Mermaid code={ACROSS} />);
    await settle();
    await waitFor(() => expect(container.querySelector("svg g[data-direction='LR']")).not.toBeNull());

    const turn = screen.getByTestId("mermaid-orientation");
    fireEvent.click(turn);
    fireEvent.click(turn);
    await settle();
    await waitFor(() => expect(renderDiagram).toHaveBeenCalledTimes(2));
    await settle();

    expect(container.querySelector("svg g[data-direction='LR']")).not.toBeNull();
  });
});
