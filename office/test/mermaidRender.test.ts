import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createMermaidRenderer, MAX_MERMAID_CHARS, MermaidError } from "../src/mermaidRender.ts";

const require = createRequire(import.meta.url);
const canvas = require("@napi-rs/canvas") as {
  loadImage(source: Buffer): Promise<{ width: number; height: number }>;
  createCanvas(width: number, height: number): {
    getContext(kind: "2d"): {
      drawImage(image: unknown, x: number, y: number): void;
      getImageData(x: number, y: number, width: number, height: number): { data: Uint8ClampedArray };
    };
  };
};

/** How many pixels of a PNG are not white: a blank raster has none. */
async function inkedPixels(png: Uint8Array): Promise<number> {
  const image = await canvas.loadImage(Buffer.from(png));
  const surface = canvas.createCanvas(image.width, image.height);
  const context = surface.getContext("2d");
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, image.width, image.height);
  let inked = 0;
  for (let at = 0; at < data.length; at += 4) if (data[at] < 200 || data[at + 1] < 200 || data[at + 2] < 200) inked++;
  return inked;
}

const FLOWCHART = "flowchart LR\n  A[Start here] --> B{Clear?}\n  B -->|yes| C[Write the document]\n  B -->|no| A";

describe("createMermaidRenderer", () => {
  const renderer = createMermaidRenderer();
  after(() => renderer.close());

  test("draws a flowchart as a styled vector and a raster that is not blank", async () => {
    const image = await renderer.render(FLOWCHART);
    // Mermaid writes each word in its own tspan: the text is read without the markup.
    const text = image.svg.replace(/<[^>]+>/g, "");
    for (const label of ["Start here", "Clear?", "yes", "no", "Write the", "document"]) assert.ok(text.includes(label), `the vector carries "${label}"`);
    assert.ok(image.width > 100 && image.height > 50, `a real size: ${image.width}×${image.height}`);
    assert.match(image.svg, /^<svg\b[^>]*\bwidth="[\d.]+"[^>]*\bheight="[\d.]+"/, "the root carries its own size");
    // Styled for a reader that runs no CSS (LibreOffice): no stylesheet, no classes,
    // and the node shapes carry their own fill.
    assert.doesNotMatch(image.svg, /<style/);
    assert.doesNotMatch(image.svg, /\sclass="/);
    assert.match(image.svg, /<(rect|polygon|path)\b[^>]*\bfill="(?!none)[^"]+"/);
    assert.deepEqual([...image.png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "a PNG");
    assert.ok((await inkedPixels(image.png)) > 500, "the raster shows the diagram");
  });

  test("draws the other kinds the gate names", async () => {
    const sources = {
      sequence: "sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi",
      gantt: "gantt\n  dateFormat YYYY-MM-DD\n  Task :a1, 2026-01-01, 5d",
      pie: 'pie title Pets\n  "Dogs" : 3\n  "Cats" : 2',
      class: "classDiagram\n  Animal <|-- Dog",
    };
    for (const [kind, source] of Object.entries(sources)) {
      const image = await renderer.render(source);
      assert.ok(image.width > 0 && image.height > 0, `${kind} has a size`);
      assert.ok((await inkedPixels(image.png)) > 100, `${kind}'s raster is not blank`);
    }
  });

  test("sizes a pie chart's legend to its labels", async () => {
    const image = await renderer.render('pie title Where the time goes\n  "Writing" : 45\n  "Diagrams" : 30');
    // The legend sits right of the pie: the picture is wider than the pie alone (450).
    assert.ok(image.width > 500, `width ${image.width}`);
  });

  test("refuses a source Mermaid cannot parse, with Mermaid's message", async () => {
    await assert.rejects(renderer.render("flowchart LR\n  A --> "), (error: unknown) => error instanceof MermaidError && /parse error/i.test(error.message));
    // And the next diagram still draws: a refusal does not cost the renderer.
    const image = await renderer.render("flowchart LR\n  X --> Y");
    assert.ok(image.svg.includes("X"));
  });

  test("refuses an empty or oversized source before drawing", async () => {
    await assert.rejects(renderer.render("   "), MermaidError);
    await assert.rejects(renderer.render("flowchart LR\n" + "x".repeat(MAX_MERMAID_CHARS)), /longer than/);
  });

  test("leaves no DOM globals in the caller's thread", async () => {
    await renderer.render("flowchart LR\n  A --> B");
    const scope = globalThis as Record<string, unknown>;
    assert.equal(scope.window, undefined);
    assert.equal(scope.document, undefined);
  });
});

describe("a diagram that does not finish", () => {
  test("is refused when its time runs out, and the renderer draws again afterwards", async () => {
    const renderer = createMermaidRenderer({ timeoutMs: 1 });
    try {
      await assert.rejects(renderer.render(FLOWCHART), /longer than/);
    } finally {
      await renderer.close();
    }
    const fresh = createMermaidRenderer();
    try {
      assert.ok((await fresh.render("flowchart LR\n  A --> B")).svg.includes("A"));
    } finally {
      await fresh.close();
    }
  });
});
