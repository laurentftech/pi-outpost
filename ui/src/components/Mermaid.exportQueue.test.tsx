/**
 * The viewer's diagrams and the Word export share one mermaid, configured globally.
 * Alone in its file so that no other test's render is waiting in the page's queue.
 */
import { describe, it, expect, vi } from "vitest";
import { render, act, waitFor } from "@testing-library/react";
import { Mermaid } from "./Mermaid";

const renderDiagram = vi.hoisted(() => vi.fn());
const initialize = vi.hoisted(() => vi.fn());

vi.mock("mermaid", () => ({ default: { initialize, render: renderDiagram } }));

const CODE = "graph TD; A-->B;";

async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(400);
  });
}

describe("Mermaid and the Word export", () => {
  it("never draws while the Word export is drawing, and draws in its own configuration afterwards", async () => {
    // An export pressed while the viewer was still drawing the same diagram once lost
    // it: both configure the one global mermaid, and the export's print settings
    // landed in the middle of the viewer's render, or the other way round.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls: string[] = [];
    let active = 0;
    let overlap = 0;
    let release: () => void = () => {};
    initialize.mockImplementation((config: { theme?: string; htmlLabels?: boolean }) => {
      calls.push(config.htmlLabels === false ? "init:export" : `init:${config.theme ?? "reset"}`);
    });
    renderDiagram.mockImplementation(async (id: string) => {
      active++;
      if (active > 1) overlap++;
      calls.push(`render:${id.startsWith("docx-export") ? "export" : "viewer"}`);
      if (id.startsWith("docx-export")) await new Promise<void>((resolve) => (release = resolve));
      active--;
      return { svg: "<svg id='diagram' viewBox='0 0 100 50'></svg>" };
    });
    const { renderDiagram: exportDiagram } = await import("../export/mermaidToImage");

    // The export starts first and is still drawing when the viewer's debounce ends.
    const exporting = exportDiagram(CODE, "docx-export-0").catch(() => undefined);
    render(<Mermaid code={CODE} />);
    await settle();
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls.filter((call) => call === "render:viewer")).toHaveLength(0);

    release();
    await exporting;
    await waitFor(() => expect(calls).toContain("render:viewer"));
    expect(overlap).toBe(0);
    // The viewer set its own screen configuration after the export's, right before drawing.
    const viewerRender = calls.indexOf("render:viewer");
    expect(calls[viewerRender - 1]).toMatch(/^init:(dark|default)$/);
    expect(calls.indexOf("init:export")).toBeLessThan(viewerRender);
    vi.useRealTimers();
  });
});
