/**
 * A project's colours, where kinds are drawn.
 *
 * The palette takes the declared colours as they are, keeps every other kind
 * automatic and out of their way, and the key says which colours are the project's.
 * With no appearance nothing moves — byte for byte.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { createStructuredExchangeFigureToolDefinition } from "../src/structuredExchangeFigureTool.ts";
import { realResolve } from "../src/sandbox.ts";
import { assignTints, lighten, sharedDeclaredColours } from "@pi-outpost/shared/structured-exchange/palette";
import { graphFigure, sequenceFigure, serializeFigure } from "@pi-outpost/shared/structured-exchange/figure";
import type { StructuredGraphData, StructuredSequenceData } from "@pi-outpost/shared/structured-exchange";

const graph: StructuredGraphData = {
  nodes: [
    { id: "s", label: "Wheel sensor", kind: "sensor" },
    { id: "e", label: "ECU", kind: "controller" },
    { id: "b", label: "Brake", kind: "actuator" },
  ],
  edges: [
    { from: "s", to: "e", kind: "signal" },
    { from: "e", to: "b", kind: "power" },
  ],
};

const sequence: StructuredSequenceData = {
  participants: [
    { id: "s", label: "Sensor", kind: "sensor" },
    { id: "e", label: "ECU", kind: "controller" },
  ],
  messages: [{ from: "s", to: "e", label: "speed" }],
};

describe("assignTints with declared colours", () => {
  test("a declared kind takes its colour exactly, with a derived light fill and no dash", () => {
    const tints = assignTints(["SRR", "PDR"], { SRR: { color: "#dc2626" } });
    assert.deepEqual(tints.get("SRR"), { fill: lighten("#dc2626"), stroke: "#dc2626", declared: true });
    assert.equal(tints.get("PDR")?.declared, undefined);
  });

  test("AnUnnamedKindKeepsAnAutomaticColourDistinctFromDeclaredOnes", () => {
    // Find a kind whose automatic colour would be some palette colour, then declare
    // that very colour for another kind in the same drawing.
    const automatic = assignTints(["alpha"]).get("alpha")!.stroke;
    const tints = assignTints(["taken", "alpha"], { taken: { color: automatic } });
    assert.equal(tints.get("taken")!.stroke, automatic);
    assert.notEqual(tints.get("alpha")!.stroke.toLowerCase(), automatic.toLowerCase());
  });

  test("NoAppearanceChangesNothing (palette)", () => {
    const kinds = ["a", "b", "c", "d", "e"];
    assert.deepEqual(assignTints(kinds, undefined), assignTints(kinds));
    assert.deepEqual(assignTints(kinds, {}), assignTints(kinds));
  });

  test("two kinds sharing a declared colour keep it and are named", () => {
    const tints = assignTints(["SRR", "PDR", "CDR"], { SRR: { color: "#dc2626" }, PDR: { color: "#DC2626" } });
    assert.equal(tints.get("SRR")!.stroke, "#dc2626");
    assert.equal(tints.get("PDR")!.stroke, "#DC2626");
    const shared = sharedDeclaredColours(["SRR", "PDR", "CDR"], tints);
    assert.deepEqual(shared.get("SRR"), ["PDR"]);
    assert.deepEqual(shared.get("PDR"), ["SRR"]);
    assert.equal(shared.has("CDR"), false);
  });
});

describe("figures with a project appearance", () => {
  test("AGraphElementTakesItsProjectColour", () => {
    const svg = serializeFigure(
      graphFigure(graph, { isProposal: false, appearance: { kinds: { sensor: { color: "#0d9488" } } } }),
    );
    assert.match(svg, /#0d9488/);
  });

  test("VocabulariesAreSeparate", () => {
    // `sensor` coloured as a relationship kind leaves the element kind `sensor` automatic.
    const svg = serializeFigure(
      graphFigure(graph, { isProposal: false, appearance: { relationshipKinds: { sensor: { color: "#123456" } } } }),
    );
    assert.doesNotMatch(svg, /#123456/);
    const asRelationship = serializeFigure(
      graphFigure(graph, { isProposal: false, appearance: { relationshipKinds: { power: { color: "#123456" } } } }),
    );
    assert.match(asRelationship, /#123456/);
  });

  test("ALegendMarksAProjectColour", () => {
    const svg = serializeFigure(
      graphFigure(graph, { isProposal: false, appearance: { kinds: { sensor: { color: "#0d9488" } } } }),
    );
    assert.match(svg, /data-colour-source="project"/);
    assert.match(svg, /<title>sensor — project colour<\/title>/);
    // Only the declared entry is marked.
    assert.equal(svg.match(/data-colour-source="project"/g)?.length, 1);
  });

  test("ASharedDeclaredColourIsSaid", () => {
    const svg = serializeFigure(
      graphFigure(graph, {
        isProposal: false,
        appearance: { kinds: { sensor: { color: "#0d9488" }, actuator: { color: "#0d9488" } } },
      }),
    );
    assert.match(svg, /sensor \(same colour as actuator\)/);
    assert.match(svg, /actuator \(same colour as sensor\)/);
  });

  test("a sequence's participants take their project colour", () => {
    const svg = serializeFigure(sequenceFigure(sequence, { isProposal: false, appearance: { kinds: { controller: { color: "#7c2d12" } } } }));
    assert.match(svg, /#7c2d12/);
    assert.match(svg, /data-colour-source="project"/);
  });

  test("NoAppearanceChangesNothing (figures are byte-identical)", () => {
    const before = serializeFigure(graphFigure(graph, { isProposal: false }));
    assert.equal(serializeFigure(graphFigure(graph, { isProposal: false, appearance: {} })), before);
    assert.equal(
      serializeFigure(graphFigure(graph, { isProposal: false, appearance: { kinds: { unused: { color: "#000000" } } } })),
      before,
    );
    assert.equal(
      serializeFigure(sequenceFigure(sequence, { isProposal: false, appearance: {} })),
      serializeFigure(sequenceFigure(sequence, { isProposal: false })),
    );
  });
});

describe("write_structure_figure with project colours", () => {
  test("TheFigureWriterUsesProjectColours", async () => {
    const root = await realResolve(mkdtempSync(path.join(tmpdir(), "pi-appearance-figure-")));
    try {
      mkdirSync(path.join(root, ".pi-outpost"), { recursive: true });
      mkdirSync(path.join(root, "figures"), { recursive: true });
      writeFileSync(
        path.join(root, ".pi-outpost/structured-exchange.json"),
        JSON.stringify({
          schema: "urn:structured-exchange-profile-registry:2",
          appearance: { kinds: { sensor: { color: "#0d9488" } }, relationshipKinds: { power: { color: "#7c2d12" } } },
        }),
      );
      writeFileSync(path.join(root, "brakes.json"), JSON.stringify({ schema: "urn:structured-exchange:2", kind: "graph", data: graph }));
      const tool = createStructuredExchangeFigureToolDefinition({ cwd: root, allowedRoots: [root], maxBytes: 4_000_000, writableRoot: root, projectRoot: root });
      const result = await (tool.execute as unknown as (id: string, params: unknown, signal?: AbortSignal) => Promise<{ isError?: boolean; content: { text: string }[] }>)(
        "call-1",
        { path: "brakes.json", output_path: "figures/brakes.svg" },
        undefined,
      );
      assert.notEqual(result.isError, true, result.content[0].text);
      const svg = readFileSync(path.join(root, "figures/brakes.svg"), "utf8");
      assert.match(svg, /#0d9488/);
      assert.match(svg, /#7c2d12/);
      assert.match(svg, /data-colour-source="project"/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
