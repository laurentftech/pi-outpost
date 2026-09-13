/**
 * `write_structure_figure` naming a viewpoint.
 *
 * The agent writing a report used to pass the same two hide lists again for every
 * figure, with nothing recording why a figure showed what it showed. A viewpoint the
 * document declares carries both the selection and the reason, so the tool takes its
 * identifier — and has to refuse one that is not there as usefully as it refuses a bad
 * path: by saying what it could have asked for, and writing nothing.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, describe, test } from "node:test";
import { createStructuredExchangeFigureToolDefinition } from "../src/structuredExchangeFigureTool.ts";
import { realResolve } from "../src/sandbox.ts";

const graph = (extra: Record<string, unknown> = {}) => ({
  schema: "urn:structured-exchange:2",
  kind: "graph",
  ...extra,
  data: {
    nodes: [
      { id: "battery", label: "Battery", kind: "source" },
      { id: "inverter", label: "Inverter", kind: "converter" },
      { id: "motor", label: "Motor", kind: "load" },
      { id: "ecu", label: "ECU", kind: "controller" },
    ],
    edges: [
      { from: "battery", to: "inverter", kind: "power" },
      { from: "inverter", to: "motor", kind: "power" },
      { from: "ecu", to: "inverter", kind: "signal" },
    ],
  },
});

const power = {
  id: "power",
  label: "Power distribution",
  concern: "Where energy is stored, converted and consumed",
  elementKinds: ["source", "converter", "load"],
  relationshipKinds: ["power"],
};
const control = { id: "control", label: "Control", concern: "What commands what", elementKinds: ["controller", "converter"], relationshipKinds: ["signal"] };

describe("write_structure_figure with a viewpoint", () => {
  let root: string;
  let tool: ReturnType<typeof createStructuredExchangeFigureToolDefinition>;

  type ToolResult = { content: { text: string }[]; isError?: boolean };
  const run = (params: Record<string, unknown>): Promise<ToolResult> =>
    (tool.execute as unknown as (id: string, params: unknown, signal?: AbortSignal) => Promise<ToolResult>)(
      "call-1",
      params,
      undefined,
    );
  const figurePath = (name: string) => path.join(root, "figures", name);

  before(async () => {
    root = path.join(await realResolve(await mkdtemp(path.join(tmpdir(), "pi-figuretool-viewpoints-"))), "workspace");
    await mkdir(path.join(root, "figures"), { recursive: true });
    await writeFile(path.join(root, "architecture.json"), JSON.stringify(graph({ viewpoints: [power, control] }), null, 2));
    await writeFile(path.join(root, "plain-architecture.json"), JSON.stringify(graph(), null, 2));
    tool = createStructuredExchangeFigureToolDefinition({
      cwd: root,
      allowedRoots: [root],
      maxBytes: 4_000_000,
      writableRoot: root,
    });
  });

  test("offers the parameter, described as the document's own viewpoints", () => {
    const schema = tool.parameters as unknown as { properties: Record<string, { description?: string }> };
    assert.ok(schema.properties.viewpoint, "the tool takes no viewpoint");
    assert.match(schema.properties.viewpoint.description ?? "", /declares/);
  });

  test("writes the figure a declared viewpoint describes", async () => {
    // AFigureIsWrittenForADeclaredViewpoint, ARequestMayNameADeclaredViewpoint
    const result = await run({ path: "architecture.json", output_path: "figures/power.svg", viewpoint: "power" });
    assert.notEqual(result.isError, true, result.content[0]?.text);
    const svg = await readFile(figurePath("power.svg"), "utf8");
    assert.match(svg, /Viewpoint: Power distribution/);
    assert.match(svg, /Where energy is stored, converted and consumed/);
    assert.equal((svg.match(/data-element-id="/g) ?? []).length, 3, "the figure does not show exactly the viewpoint's elements");
    assert.doesNotMatch(svg, /data-element-id="ecu"/);
  });

  test("names the viewpoint in its result", async () => {
    // TheResultNamesTheViewpoint
    const result = await run({ path: "architecture.json", output_path: "figures/control.svg", viewpoint: "control" });
    assert.match(result.content[0].text, /Drawn for viewpoint `control` \(Control\)/);
    assert.match(result.content[0].text, /2 of 4 elements/);
  });

  test("applies hidden kinds on top of the viewpoint", async () => {
    // HiddenKindsApplyOnTopOfAViewpoint
    const result = await run({
      path: "architecture.json",
      output_path: "figures/power-without-loads.svg",
      viewpoint: "power",
      hide_element_kinds: ["load"],
    });
    assert.notEqual(result.isError, true, result.content[0]?.text);
    const svg = await readFile(figurePath("power-without-loads.svg"), "utf8");
    assert.doesNotMatch(svg, /data-element-id="motor"/);
    assert.match(svg, /\(adjusted\)/);
  });

  test("refuses a viewpoint the document does not declare, listing the ones it does", async () => {
    // AnUndeclaredViewpointIsRefusedWithTheDeclaredOnes
    const result = await run({ path: "architecture.json", output_path: "figures/thermal.svg", viewpoint: "thermal" });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /No figure was written/);
    assert.match(result.content[0].text, /"thermal".*"power", "control"/);
    assert.equal(existsSync(figurePath("thermal.svg")), false, "a refused request wrote a file");
  });

  test("refuses any viewpoint for a document that declares none, saying so", async () => {
    // ADocumentWithoutViewpointsRefusesOne
    const result = await run({ path: "plain-architecture.json", output_path: "figures/plain-power.svg", viewpoint: "power" });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /declares no viewpoints/);
    assert.equal(existsSync(figurePath("plain-power.svg")), false, "a refused request wrote a file");
  });
});
