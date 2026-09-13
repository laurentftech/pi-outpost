/**
 * The seam: what the browser draws and what the serializer writes are one picture.
 *
 * This is the test the whole primitives arrangement exists for. Two renderers
 * consume one list — React maps a shape to an element, `serializeFigure` maps the
 * same shape to a string — and the failure mode being guarded against is the
 * silent one: the two drift, nobody opens both, and the figure an agent writes
 * into a report stops being the picture the reader approved.
 *
 * Bytes are not compared, and the spec says so: attribute order and number
 * formatting are a renderer's business. Geometry, text and colour are not.
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, within } from "@testing-library/react";
import { STRUCTURED_EXCHANGE_SCHEMA_V1 as S } from "@pi-outpost/shared/structured-exchange";
import type { ValidatedStructuredExchange } from "@pi-outpost/shared/structured-exchange";
import { figureForEnvelope } from "@pi-outpost/shared/structured-exchange/export";
import { StructuredExchangeDocument } from "./StructuredExchangeView";

const graph = {
  schema: S,
  kind: "graph",
  data: {
    nodes: [
      { id: "batt", label: "Batterie", kind: "power", container: "hv" },
      { id: "ecu", label: "Calculateur & co", kind: "compute", container: "hv" },
      { id: "dash", label: "Tableau de bord\nsecondaire", kind: "compute" },
    ],
    edges: [
      { from: "batt", to: "ecu", label: "400V", kind: "power" },
      { from: "ecu", to: "dash", label: "état <ok>", kind: "signal" },
      { from: "dash", to: "batt", kind: "signal" },
    ],
    containers: [{ id: "hv", label: "Haute tension" }],
  },
} as unknown as ValidatedStructuredExchange;

const proposal = {
  schema: S,
  kind: "graph",
  target: "artifact-1",
  data: {
    nodes: [
      { id: "keep", ref: "EL-1", label: "Ledger" },
      { id: "rename", ref: "EL-2", label: "Journal", set: { label: "General Journal" } },
      { id: "fresh", label: "Brand new", kind: "compute" },
    ],
    edges: [{ from: "fresh", to: "keep", kind: "composition" }],
  },
} as unknown as ValidatedStructuredExchange;

const sequence = {
  schema: S,
  kind: "sequence",
  data: {
    participants: [
      { id: "batt", label: "Batterie", container: "hv" },
      { id: "dash", label: "Tableau de bord" },
      { id: "ecu", label: "Calculateur", container: "hv" },
    ],
    messages: [
      { from: "batt", to: "ecu", label: "400V" },
      { from: "ecu", to: "dash", label: "état" },
      { from: "dash", to: "dash", label: "auto-test" },
    ],
    containers: [{ id: "hv", label: "Haute tension" }],
  },
} as unknown as ValidatedStructuredExchange;

/** Geometry to two decimals: "120" and "120.00" are the same place. */
const number = (value: string | null): string | null =>
  value === null || value.trim() === "" || Number.isNaN(Number(value)) ? value : String(Math.round(Number(value) * 100) / 100);

/** The attributes that decide what a shape looks like — and no others. */
const WATCHED: Record<string, string[]> = {
  rect: ["x", "y", "width", "height", "rx", "fill", "stroke", "stroke-width", "stroke-dasharray", "opacity"],
  text: ["x", "y", "font-size", "font-weight", "text-anchor", "fill", "stroke", "stroke-width", "opacity"],
  line: ["x1", "y1", "x2", "y2", "stroke", "stroke-width", "stroke-dasharray", "opacity", "marker-end"],
  path: ["d", "fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "opacity", "marker-end"],
};

/**
 * One picture as a comparable list.
 *
 * Document order is part of it: SVG paints in order, so two lists with the same
 * shapes in a different sequence are two different pictures.
 *
 * Anything carrying `data-hit` is skipped by name. Those are the transparent
 * shapes a browser adds so a pointer can find a one-pixel line or a ten-pixel
 * swatch; they belong to the browser alone, and their absence from the figure is
 * the subject of its own test below rather than a difference normalised away here.
 */
function shapesOf(svg: Element): string[] {
  const shapes: string[] = [];
  for (const element of svg.querySelectorAll("rect, text, line, path")) {
    if (element.hasAttribute("data-hit")) continue;
    const tag = element.tagName.toLowerCase();
    const watched = WATCHED[tag] ?? [];
    const attributes = watched.map((name) => `${name}=${number(element.getAttribute(name))}`).join(" ");
    shapes.push(`${tag} ${attributes} :: ${tag === "text" ? element.textContent : ""}`);
  }
  return shapes;
}

/** The picture the browser draws for this document. */
function browserFigure(envelope: ValidatedStructuredExchange): SVGSVGElement {
  const { container } = render(<StructuredExchangeDocument envelope={envelope} source="{}" />);
  const svg = container.querySelector("svg");
  if (svg === null) throw new Error("the browser drew no diagram at all");
  return svg as SVGSVGElement;
}

/** The picture the serializer writes, parsed back so the two can be compared. */
function serializedFigure(envelope: ValidatedStructuredExchange): SVGSVGElement {
  const result = figureForEnvelope(envelope);
  if (!result.ok) throw new Error(`no figure was produced: ${result.reason}`);
  const parsed = new DOMParser().parseFromString(result.svg, "image/svg+xml");
  const error = parsed.querySelector("parsererror");
  if (error !== null) throw new Error(`the serialized figure is not well-formed XML: ${error.textContent}`);
  return parsed.documentElement as unknown as SVGSVGElement;
}

describe("the browser and the serializer draw one picture", () => {
  for (const [name, envelope] of [
    ["a graph", graph],
    ["a proposal", proposal],
    ["a sequence", sequence],
  ] as const) {
    it(`agrees shape for shape on ${name}`, () => {
      expect(shapesOf(serializedFigure(envelope))).toEqual(shapesOf(browserFigure(envelope)));
    });

    it(`agrees on the canvas for ${name}`, () => {
      const written = serializedFigure(envelope);
      const drawn = browserFigure(envelope);
      for (const attribute of ["viewBox", "width", "height", "aria-label"]) {
        expect(written.getAttribute(attribute)).toBe(drawn.getAttribute(attribute));
      }
    });

    it(`declares the same arrowheads for ${name}`, () => {
      const ids = (svg: Element) => [...svg.querySelectorAll("marker")].map((m) => m.getAttribute("id")).sort();
      const fills = (svg: Element) => [...svg.querySelectorAll("marker path")].map((p) => p.getAttribute("fill")).sort();
      expect(ids(serializedFigure(envelope))).toEqual(ids(browserFigure(envelope)));
      expect(fills(serializedFigure(envelope))).toEqual(fills(browserFigure(envelope)));
    });
  }

  it("agrees under a narrowing, which is where the two would drift first", () => {
    const narrowed = { hiddenRelationshipKinds: ["signal"] };
    const written = serializedFigure({ ...graph } as ValidatedStructuredExchange);
    expect(written).toBeDefined();

    const result = figureForEnvelope(graph, narrowed);
    if (!result.ok) throw new Error(result.reason);
    const parsed = new DOMParser().parseFromString(result.svg, "image/svg+xml");

    // The browser reaches the same narrowing through its legend; driving it here
    // would test the legend. What is compared is the narrowed picture against the
    // same narrowing applied to the browser's own figure computation.
    const { container } = render(<StructuredExchangeDocument envelope={graph} source="{}" />);
    const entry = container.querySelector('[data-legend-entry="relationship:signal"]')!;
    const target = entry.querySelector("text") ?? entry;
    const at = { clientX: 5, clientY: 5, button: 0, bubbles: true, cancelable: true };
    target.dispatchEvent(Object.assign(new MouseEvent("pointerdown", at), { pointerId: 1 }));
    target.dispatchEvent(Object.assign(new MouseEvent("pointerup", at), { pointerId: 1 }));
    // Through fireEvent, not dispatchEvent: a raw click is not wrapped in `act`, so
    // the state it sets never flushes and the picture never changes — the test then
    // compares a narrowed figure against an unnarrowed rendering and blames the seam.
    fireEvent.click(target);

    expect(shapesOf(parsed.documentElement)).toEqual(shapesOf(container.querySelector("svg")!));
  });
});

describe("a viewpoint's figure is the same whoever draws it", () => {
  /** A graph declaring a viewpoint, so the reader and the agent can each ask for it. */
  const withViewpoint = {
    schema: "urn:structured-exchange:2",
    kind: "graph",
    viewpoints: [
      {
        id: "power",
        label: "Power distribution",
        concern: "Where energy is stored, converted and consumed",
        elementKinds: ["power", "compute"],
        relationshipKinds: ["power"],
      },
    ],
    data: {
      nodes: [
        { id: "batt", label: "Batterie", kind: "power" },
        { id: "ecu", label: "Calculateur", kind: "compute" },
        { id: "sensor", label: "Capteur", kind: "sensor" },
      ],
      edges: [
        { from: "batt", to: "ecu", label: "400V", kind: "power" },
        { from: "sensor", to: "ecu", label: "mesure", kind: "signal" },
      ],
    },
  } as unknown as ValidatedStructuredExchange;

  it("draws what the reader selects exactly as the agent writes it", () => {
    // TheReaderAndTheAgentProduceTheSameViewpointFigure. The reader reaches the
    // viewpoint through the selector it is actually offered; the agent names it to the
    // export the figure tool calls. Nothing else is adjusted on either side.
    const result = figureForEnvelope(withViewpoint, { viewpoint: "power" });
    if (!result.ok) throw new Error(result.reason);
    const written = new DOMParser().parseFromString(result.svg, "image/svg+xml").documentElement;

    const { container } = render(<StructuredExchangeDocument envelope={withViewpoint} source="{}" />);
    fireEvent.change(within(container).getByTestId("viewpoint-select"), { target: { value: "power" } });
    const drawn = container.querySelector("svg")!;

    // The comparison would pass on two unnarrowed figures, so first prove both are
    // really drawn for the viewpoint: the sensor is not in it, and both say so.
    expect(drawn.querySelector('[data-element-id="sensor"]')).toBeNull();
    expect(written.textContent).toContain("Viewpoint: Power distribution");
    expect(drawn.textContent).toContain("Viewpoint: Power distribution");

    expect(shapesOf(written)).toEqual(shapesOf(drawn));
    for (const attribute of ["viewBox", "width", "height", "aria-label"]) {
      expect(written.getAttribute(attribute)).toBe(drawn.getAttribute(attribute));
    }
  });
});

describe("what only exists for pointing does not travel", () => {
  it("the browser adds hit areas and the figure has none", () => {
    // Both halves matter: without the first, the second passes for a picture that
    // simply has no edges and no key.
    const drawn = browserFigure(graph);
    expect(drawn.querySelectorAll('[data-hit="edge"]').length).toBeGreaterThan(0);
    expect(drawn.querySelectorAll('[data-hit="legend"]').length).toBeGreaterThan(0);
    expect(serializedFigure(graph).querySelectorAll("[data-hit]").length).toBe(0);
  });

  it("carries no cursor, touch-action or pointer-events", () => {
    const markup = (figureForEnvelope(graph) as { svg: string }).svg;
    for (const hint of ["cursor", "touch-action", "touchAction", "pointer-events", "pointerEvents", "onclick", "onpointer"]) {
      expect(markup.toLowerCase()).not.toContain(hint.toLowerCase());
    }
  });

  it("carries no style attribute at all", () => {
    expect((figureForEnvelope(graph) as { svg: string }).svg).not.toContain("style=");
  });
});

describe("what the reader downloads is a figure too", () => {
  it("carries none of the hit areas the rendering it came from needs", () => {
    // The download serializes the live tree, so what the reader arranged by
    // dragging is what leaves. That tree is full of transparent targets, and this
    // is the check that they are taken out on the way — the seam test above cannot
    // see them, because it compares the figure against the same tree minus them.
    const { container } = render(<StructuredExchangeDocument envelope={graph} source="{}" />);
    expect(container.querySelectorAll("[data-hit]").length).toBeGreaterThan(0);

    let downloaded = "";
    const createObjectURL = vi.fn((blob: Blob) => {
      // Read synchronously: the click handler revokes the URL before any async
      // read of the blob could finish.
      downloaded = (blob as unknown as { __text: string }).__text;
      return "blob:figure";
    });
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL: vi.fn() });
    const OriginalBlob = globalThis.Blob;
    vi.stubGlobal(
      "Blob",
      class extends OriginalBlob {
        __text: string;
        constructor(parts: BlobPart[], options?: BlobPropertyBag) {
          super(parts, options);
          this.__text = parts.join("");
        }
      },
    );

    fireEvent.click(within(container).getAllByRole("button", { name: /download SVG/ })[0]);

    expect(downloaded).not.toBe("");
    expect(downloaded).not.toContain("data-hit");
    expect(downloaded).not.toContain("cursor");
    expect(downloaded).not.toContain("touch-action");
    vi.unstubAllGlobals();
  });
});

describe("the figure stands on its own", () => {
  const markup = (envelope: ValidatedStructuredExchange) => (figureForEnvelope(envelope) as { svg: string }).svg;

  it("references no stylesheet, script, font file or address", () => {
    for (const envelope of [graph, proposal, sequence]) {
      const svg = markup(envelope);
      expect(svg).not.toContain("<script");
      expect(svg).not.toContain("<style");
      expect(svg).not.toContain("<image");
      expect(svg).not.toContain("xlink:href");
      expect(svg).not.toContain("@import");
      expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
      // The only url() a figure may carry is a reference to its own arrowheads.
      for (const reference of svg.match(/url\(([^)]*)\)/g) ?? []) {
        expect(reference).toMatch(/^url\(#/);
      }
    }
  });

  it("declares the namespace, so a file opened directly is an SVG", () => {
    expect(markup(graph)).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it("names the font as a family rather than fetching one", () => {
    const svg = markup(graph);
    expect(svg).toContain("font-family=");
    expect(svg).not.toContain("@font-face");
  });

  it("escapes what a producer wrote, so text cannot become markup", () => {
    // The label carries `<ok>`; a figure that reproduced it literally would be
    // malformed XML at best and an injection at worst.
    expect(markup(graph)).toContain("&lt;ok&gt;");
    expect(markup(graph)).not.toContain("<ok>");
  });
});

describe("producing a figure is deterministic", () => {
  it("draws the same picture twice", () => {
    for (const envelope of [graph, proposal, sequence]) {
      expect((figureForEnvelope(envelope) as { svg: string }).svg).toBe(
        (figureForEnvelope(envelope) as { svg: string }).svg,
      );
    }
  });

  it("draws the same picture twice under a narrowing", () => {
    const narrowing = { hiddenElementKinds: ["compute"], hiddenRelationshipKinds: ["signal"] };
    expect((figureForEnvelope(graph, narrowing) as { svg: string }).svg).toBe(
      (figureForEnvelope(graph, narrowing) as { svg: string }).svg,
    );
  });
});
