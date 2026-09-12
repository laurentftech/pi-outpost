/**
 * Turning a diagram, from the reader's side.
 *
 * The rule itself is tested where it lives, and the figure is tested with no browser
 * at all. What is left here is only answerable by mounting the thing: whether the
 * control appears where it should and nowhere else, whether both copies of the
 * rendering agree, and whether what leaves the page is what the reader was looking at.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ChatItem } from "@pi-outpost/shared";
import { STRUCTURED_EXCHANGE_SCHEMA_V1 as S } from "@pi-outpost/shared/structured-exchange";
import { structuredExchangePresentation } from "./StructuredExchangeView";

type ToolItem = Extract<ChatItem, { kind: "tool" }>;

const withStructured = (document: unknown): ToolItem => ({
  kind: "tool",
  toolCallId: "t1",
  toolName: "some_tool",
  args: {},
  output: "the original output",
  structured: JSON.stringify(document),
});

/** Wide enough that landscape overflows the reading column: the reported case. */
const wideGraph = {
  schema: S,
  kind: "graph",
  data: {
    nodes: Array.from({ length: 12 }, (_, index) => ({ id: `n${index}`, label: `Element ${index}`, kind: "part" })),
    edges: Array.from({ length: 11 }, (_, index) => ({ from: `n${index}`, to: `n${index + 1}`, kind: "feeds" })),
  },
};

const smallGraph = {
  schema: S,
  kind: "graph",
  data: {
    nodes: [
      { id: "a", label: "A", kind: "part" },
      { id: "b", label: "B", kind: "part" },
    ],
    edges: [{ from: "a", to: "b", kind: "feeds" }],
  },
};

const sequence = {
  schema: S,
  kind: "sequence",
  data: {
    participants: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ],
    messages: [{ from: "a", to: "b", label: "go" }],
  },
};

const table = {
  schema: S,
  kind: "table",
  data: { columns: [{ key: "c", label: "C" }], rows: [{ cells: { c: "one" } }] },
};

const renderBody = (item: ToolItem) =>
  render(<structuredExchangePresentation.Expanded item={item} dispatch={vi.fn()} />);

const control = () => screen.queryByTestId("diagram-orientation");

/** The extent of the drawn diagram, as the SVG itself reports it. */
const extent = (index = 0) => {
  const [, , width, height] = (graph(index)?.getAttribute("viewBox") ?? "0 0 0 0").split(" ").map(Number);
  return { width, height };
};

const graph = (index = 0) =>
  [...document.querySelectorAll("svg[viewBox]")].filter((candidate) =>
    candidate.getAttribute("aria-label")?.startsWith("Graph of"),
  )[index] as SVGSVGElement | undefined;

/**
 * Where the boxes sit, which is what turning actually moves.
 *
 * Not the extent: the key is laid out across under the diagram and sets a floor on
 * the canvas width, so a two-box graph comes out wider than tall whichever way its
 * boxes run. Asserting on the extent would be asserting about the key.
 */
const boxes = (index = 0) =>
  [...(graph(index)?.querySelectorAll("[data-element-id] rect") ?? [])].map((rect) => ({
    x: Number(rect.getAttribute("x")),
    y: Number(rect.getAttribute("y")),
  }));

const spread = (points: { x: number; y: number }[]) => ({
  across: Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x)),
  down: Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y)),
});

describe("the orientation control appears where there is an orientation to choose", () => {
  it("offers the choice on a graph", () => {
    renderBody(withStructured(smallGraph));
    expect(control()).not.toBeNull();
  });

  it("offers nothing on a sequence, whose lifelines run one way only", () => {
    renderBody(withStructured(sequence));
    expect(control()).toBeNull();
  });

  it("offers nothing on a table", () => {
    renderBody(withStructured(table));
    expect(control()).toBeNull();
  });

  it("names the orientation the diagram is currently drawn in", () => {
    renderBody(withStructured(smallGraph));
    // A small graph fits, so it is across; the control says so rather than saying
    // what the click would do.
    expect(control()!.textContent).toContain("landscape");
    expect(control()!.getAttribute("aria-label")).toBe("Diagram drawn landscape; switch to portrait");
  });

  it("arrives turned when landscape would be too wide to read", () => {
    renderBody(withStructured(wideGraph));
    expect(control()!.textContent).toContain("portrait");
    const { width, height } = extent();
    expect(height).toBeGreaterThan(width);
  });
});

describe("the reader decides last", () => {
  it("turns the diagram, and offers to turn it back", () => {
    renderBody(withStructured(smallGraph));
    const flat = spread(boxes());
    expect(flat.across).toBeGreaterThan(0);
    expect(flat.down).toBe(0);

    fireEvent.click(control()!);
    expect(control()!.textContent).toContain("portrait");
    const tall = spread(boxes());
    expect(tall.down).toBeGreaterThan(0);
    expect(tall.across).toBe(0);

    fireEvent.click(control()!);
    expect(control()!.textContent).toContain("landscape");
    expect(spread(boxes())).toEqual(flat);
  });

  it("overrides the automatic choice", () => {
    // The one that matters: a diagram the system turned, turned back by the reader,
    // stays back. An auto-choice recomputed on every render would undo this.
    renderBody(withStructured(wideGraph));
    expect(control()!.textContent).toContain("portrait");
    fireEvent.click(control()!);
    expect(control()!.textContent).toContain("landscape");
    const { width, height } = extent();
    expect(width).toBeGreaterThan(height);
  });

  it("turns both copies of the rendering at once", () => {
    // The inline rendering and the enlarged one are two instances of one component.
    // Turning one and finding the other still across is the shape of bug that made
    // the nudges live in the parent in the first place.
    renderBody(withStructured(smallGraph));
    fireEvent.click(screen.getByLabelText("Show graph view at full size"));
    expect(document.querySelectorAll('svg[aria-label^="Graph of"]').length).toBe(2);
    fireEvent.click(control()!);
    for (const index of [0, 1]) {
      const placed = spread(boxes(index));
      expect(placed.down, `copy ${index} was not turned`).toBeGreaterThan(0);
      expect(placed.across, `copy ${index} was not turned`).toBe(0);
    }
  });

  it("starts the arrangement again rather than carrying offsets across", () => {
    renderBody(withStructured(smallGraph));
    const node = document.querySelector('[data-draggable="node"]') as SVGGElement;
    (node as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
    (node as unknown as { releasePointerCapture: () => void }).releasePointerCapture = () => {};
    fireEvent.pointerDown(node, { clientX: 100, clientY: 200, button: 0, pointerId: 1 });
    fireEvent.pointerMove(node, { clientX: 260, clientY: 340, button: 0, pointerId: 1 });
    fireEvent.pointerUp(node, { clientX: 260, clientY: 340, button: 0, pointerId: 1 });
    expect(screen.queryByText("reset layout"), "the drag did not register").not.toBeNull();

    fireEvent.click(control()!);
    // The offer to reset is gone because there is nothing left to reset: the offsets
    // were measured against a layout that no longer exists.
    expect(screen.queryByText("reset layout")).toBeNull();
  });
});

describe("what leaves the page is what the reader was shown", () => {
  it("copies the markup of the diagram as it is currently drawn", async () => {
    const copied: string[] = [];
    Object.assign(navigator, { clipboard: { writeText: async (text: string) => void copied.push(text) } });
    renderBody(withStructured(smallGraph));
    fireEvent.click(control()!);
    const { width, height } = extent();
    // The picture on screen really is the turned one, so the markup below is not
    // trivially equal to the untouched rendering.
    expect(spread(boxes()).across).toBe(0);

    fireEvent.click(screen.getByText("copy markup"));
    await vi.waitFor(() => expect(copied.length).toBe(1));
    expect(copied[0]).toContain(`viewBox="0 0 ${width} ${height}"`);
    for (const box of boxes()) expect(copied[0]).toContain(`y="${box.y}"`);
  });

  it("leaves the document itself untouched", () => {
    // An adjustment is presentation only. The envelope a handover recovers is the
    // one the producer sent, whichever way the reader was looking at it.
    const item = withStructured(smallGraph);
    renderBody(item);
    fireEvent.click(control()!);
    expect(item.structured).toBe(JSON.stringify(smallGraph));
  });
});
