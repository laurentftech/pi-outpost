/**
 * The wrapper around mermaid, not mermaid itself.
 *
 * The library is mocked at the module boundary because what matters here is our
 * side of it: the diagram source stays on screen until a rendering succeeds, an
 * error is shown beside the source rather than replacing it, and a render that
 * lands after the component is gone is dropped. Those are the behaviours that
 * decide whether a failed diagram costs the reader the content or just the
 * picture.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { Mermaid } from "./Mermaid";

const renderDiagram = vi.hoisted(() => vi.fn());
const initialize = vi.hoisted(() => vi.fn());

vi.mock("mermaid", () => ({ default: { initialize, render: renderDiagram } }));

const CODE = "graph TD; A-->B;";

/** Let the 300 ms debounce elapse and the mocked render settle. */
async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(400);
  });
}

describe("Mermaid", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderDiagram.mockReset().mockResolvedValue({ svg: "<svg id='diagram'></svg>" });
    initialize.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the source while the diagram is still being drawn", () => {
    render(<Mermaid code={CODE} />);
    // Nothing has been rendered yet: the reader sees the diagram's source, not a blank
    expect(screen.getByText(CODE)).toBeInTheDocument();
  });

  it("waits out the debounce before drawing, so a streamed diagram is drawn once", async () => {
    render(<Mermaid code={CODE} />);
    expect(renderDiagram).not.toHaveBeenCalled();
    await settle();
    expect(renderDiagram).toHaveBeenCalledTimes(1);
  });

  it("draws only the code it settled on", async () => {
    const { rerender } = render(<Mermaid code="graph TD; A" />);
    rerender(<Mermaid code="graph TD; A-->B" />);
    rerender(<Mermaid code={CODE} />);
    await settle();
    expect(renderDiagram).toHaveBeenCalledTimes(1);
    expect(renderDiagram).toHaveBeenCalledWith(expect.any(String), CODE);
  });

  it("replaces the source with the drawing once it arrives", async () => {
    const { container } = render(<Mermaid code={CODE} />);
    await settle();
    await waitFor(() => expect(container.querySelector("#diagram")).not.toBeNull());
  });

  it("keeps the source, and says why, when the drawing fails", async () => {
    renderDiagram.mockRejectedValue(new Error("Parse error on line 2"));
    render(<Mermaid code={CODE} />);
    await settle();
    // Both: a broken diagram must not cost the reader its content
    await waitFor(() => expect(screen.getByText("Parse error on line 2")).toBeInTheDocument());
    expect(screen.getByText(CODE)).toBeInTheDocument();
  });

  it("reports a non-Error rejection rather than swallowing it", async () => {
    renderDiagram.mockRejectedValue("something went wrong");
    render(<Mermaid code={CODE} />);
    await settle();
    await waitFor(() => expect(screen.getByText("something went wrong")).toBeInTheDocument());
  });

  it("keeps mermaid from injecting its own error markup into the page", async () => {
    // The module remembers that it has initialized, so this needs a fresh copy of it
    // rather than a fresh mock — otherwise the call happened in an earlier test
    vi.resetModules();
    const { Mermaid: Fresh } = await import("./Mermaid");
    render(<Fresh code={CODE} />);
    await settle();
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ suppressErrorRendering: true, securityLevel: "strict" }));
  });

  it("offers the source beside a drawn diagram", async () => {
    render(<Mermaid code={CODE} />);
    await settle();
    const toggle = await screen.findByTitle("Show code");
    fireEvent.click(toggle);
    expect(screen.getByText(CODE)).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Show diagram"));
    expect(screen.queryByTitle("Show code")).toBeInTheDocument();
  });

  it("offers to copy the source", async () => {
    render(<Mermaid code={CODE} />);
    await settle();
    expect(await screen.findByRole("button", { name: /copy/i })).toBeInTheDocument();
  });

  it("drops a drawing that lands after the diagram is gone", async () => {
    const { unmount } = render(<Mermaid code={CODE} />);
    unmount();
    await settle();
    // The debounce timer was cleared with the component: nothing was ever asked for
    expect(renderDiagram).not.toHaveBeenCalled();
  });
});
