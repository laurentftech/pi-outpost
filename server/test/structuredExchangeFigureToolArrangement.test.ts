/**
 * `write_structure_figure` with a graph's arrangement (structured-exchange-arrangement,
 * TheAgentIsToldWhatTheArrangementLeaves): drawn with the arrangement beside the document,
 * the places it computes recorded there so the next version keeps them, and what the
 * arrangement check lists carried in the result.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, describe, test } from "node:test";
import { readArrangement, writeArrangement, type Arrangement } from "@pi-outpost/shared/structured-exchange/arrangement";
import { createStructuredExchangeFigureToolDefinition } from "../src/structuredExchangeFigureTool.ts";
import { realResolve } from "../src/sandbox.ts";

type Node = { id: string; label: string; kind: string };
type Edge = { from: string; to: string; kind: string };

const BASE_NODES: Node[] = [
  { id: "battery", label: "Battery", kind: "source" },
  { id: "inverter", label: "Inverter", kind: "converter" },
  { id: "motor", label: "Motor", kind: "load" },
  { id: "ecu", label: "ECU", kind: "controller" },
];
const BASE_EDGES: Edge[] = [
  { from: "battery", to: "inverter", kind: "power" },
  { from: "inverter", to: "motor", kind: "power" },
  { from: "ecu", to: "inverter", kind: "signal" },
];
const power = { id: "power", label: "Power distribution", concern: "Where energy is stored, converted and consumed", elementKinds: ["source", "converter", "load"], relationshipKinds: ["power"] };

const graph = (nodes: Node[] = BASE_NODES, edges: Edge[] = BASE_EDGES) =>
  JSON.stringify({ schema: "urn:structured-exchange:2", kind: "graph", viewpoints: [power], data: { nodes, edges } }, null, 2);

/** Where the figure draws an element's box: its group's first rect. */
function boxIn(svg: string, id: string): { x: number; y: number } {
  const group = new RegExp(`<g[^>]*data-element-id="${id}"[^>]*>\\s*(?:<title>[^<]*</title>\\s*)?<rect[^>]*?\\bx="(-?[\\d.]+)"[^>]*?\\by="(-?[\\d.]+)"`).exec(svg);
  assert.ok(group, `no box drawn for ${id}`);
  return { x: Number(group[1]), y: Number(group[2]) };
}

describe("write_structure_figure and the arrangement", () => {
  let root: string;
  let readOnly: string;
  let tool: ReturnType<typeof createStructuredExchangeFigureToolDefinition>;

  type ToolResult = { content: { text: string }[]; isError?: boolean };
  const run = async (params: Record<string, unknown>): Promise<string> => {
    const result = await (tool.execute as unknown as (id: string, params: unknown) => Promise<ToolResult>)("call-1", params);
    assert.notEqual(result.isError, true, result.content[0]?.text);
    return result.content[0]!.text;
  };
  const stored = async (name: string): Promise<Arrangement> => {
    const reading = readArrangement(await readFile(path.join(root, name), "utf8"));
    assert.ok(reading.ok, reading.ok ? "" : reading.reason);
    return reading.arrangement;
  };

  before(async () => {
    const base = await realResolve(await mkdtemp(path.join(tmpdir(), "pi-figure-arrangement-")));
    root = path.join(base, "workspace");
    readOnly = path.join(base, "reference");
    await mkdir(path.join(root, "figures"), { recursive: true });
    await mkdir(readOnly, { recursive: true });
    tool = createStructuredExchangeFigureToolDefinition({ cwd: root, allowedRoots: [root, readOnly], maxBytes: 4_000_000, writableRoot: root, projectRoot: root });
  });

  // openlore: scenario=AFigureIsWrittenWithItsArrangement spec=structured-exchange-arrangement
  test("AFigureIsWrittenWithItsArrangement: the boxes are where the arrangement puts them, and the result says it was used", async () => {
    await writeFile(path.join(root, "arranged.json"), graph());
    const arrangement: Arrangement = {
      format: "pi-outpost/structured-exchange-arrangement-1",
      views: { "": { elements: { "id:battery": { x: 40, y: 300 }, "id:inverter": { x: 260, y: 300 }, "id:motor": { x: 480, y: 300 }, "id:ecu": { x: 260, y: 120 } }, relationships: {} } },
    };
    await writeFile(path.join(root, "arranged.arrangement.json"), writeArrangement(arrangement));
    const said = await run({ path: "arranged.json", output_path: "figures/arranged.svg" });
    assert.match(said, /Drawn with the arrangement `arranged\.arrangement\.json`\./);
    const svg = await readFile(path.join(root, "figures", "arranged.svg"), "utf8");
    // The canvas fits what is drawn, so places are compared relative to the battery's
    const battery = boxIn(svg, "battery");
    assert.deepEqual({ x: boxIn(svg, "ecu").x - battery.x, y: boxIn(svg, "ecu").y - battery.y }, { x: 220, y: -180 });
    assert.deepEqual({ x: boxIn(svg, "motor").x - battery.x, y: boxIn(svg, "motor").y - battery.y }, { x: 440, y: 0 });
  });

  // openlore: scenario=ANewElementIsRecordedForNextTime spec=structured-exchange-arrangement
  test("ANewElementIsRecordedForNextTime: a first figure records the layout, and an element added once keeps its place at the next change", async () => {
    await writeFile(path.join(root, "car.json"), graph());
    const first = await run({ path: "car.json", output_path: "figures/car-1.svg" });
    assert.match(first, /Recorded the places it computed in `car\.arrangement\.json`/);
    const recorded = await stored("car.arrangement.json");
    assert.deepEqual(Object.keys(recorded.views[""]!.elements).sort(), ["id:battery", "id:ecu", "id:inverter", "id:motor"]);

    // The chief engineer adds a charger: placed once, recorded
    const charger: Node = { id: "charger", label: "Charger", kind: "source" };
    await writeFile(path.join(root, "car.json"), graph([...BASE_NODES, charger], [...BASE_EDGES, { from: "charger", to: "battery", kind: "power" }]));
    await run({ path: "car.json", output_path: "figures/car-2.svg" });
    const second = await stored("car.arrangement.json");
    const placed = second.views[""]!.elements["id:charger"];
    assert.ok(placed, "the charger's place was not recorded");
    for (const [key, at] of Object.entries(recorded.views[""]!.elements)) assert.deepEqual(second.views[""]!.elements[key], at, `${key} moved`);

    // …then a heater: the charger stays where it was put
    const heater: Node = { id: "heater", label: "Heater", kind: "load" };
    await writeFile(path.join(root, "car.json"), graph([...BASE_NODES, charger, heater], [...BASE_EDGES, { from: "charger", to: "battery", kind: "power" }, { from: "battery", to: "heater", kind: "power" }]));
    await run({ path: "car.json", output_path: "figures/car-3.svg" });
    assert.deepEqual((await stored("car.arrangement.json")).views[""]!.elements["id:charger"], placed);
    const two = await readFile(path.join(root, "figures", "car-2.svg"), "utf8");
    const three = await readFile(path.join(root, "figures", "car-3.svg"), "utf8");
    const relative = (svg: string) => ({ x: boxIn(svg, "charger").x - boxIn(svg, "motor").x, y: boxIn(svg, "charger").y - boxIn(svg, "motor").y });
    assert.deepEqual(relative(three), relative(two));
  });

  // openlore: scenario=WhatIsLeftIsInTheResult spec=structured-exchange-arrangement
  test("WhatIsLeftIsInTheResult: what the arrangement check lists comes back with the figure", async () => {
    await writeFile(path.join(root, "stale.json"), graph());
    const arrangement: Arrangement = {
      format: "pi-outpost/structured-exchange-arrangement-1",
      views: { "": { elements: { "id:battery": { x: 40, y: 40 }, "id:inverter": { x: 260, y: 40 }, "id:motor": { x: 480, y: 40 }, "id:ecu": { x: 260, y: 200 }, "id:pump": { x: 700, y: 40 } }, relationships: {} } },
    };
    await writeFile(path.join(root, "stale.arrangement.json"), writeArrangement(arrangement));
    const said = await run({ path: "stale.json", output_path: "figures/stale.svg" });
    assert.match(said, /The arrangement leaves \d+ things? to look at:/);
    assert.match(said, /- the arrangement places "id:pump", which the document no longer holds/);
  });

  // openlore: scenario=HiddenKindsKeepTheArrangedPlaces spec=structured-exchange-viewpoints
  test("HiddenKindsKeepTheArrangedPlaces: a viewpoint drawn with its own arrangement, a kind hidden on top, the rest where they were arranged", async () => {
    await writeFile(path.join(root, "view.json"), graph());
    const arrangement: Arrangement = {
      format: "pi-outpost/structured-exchange-arrangement-1",
      views: { power: { elements: { "id:battery": { x: 40, y: 40 }, "id:inverter": { x: 40, y: 200 }, "id:motor": { x: 40, y: 360 } }, relationships: {} } },
    };
    await writeFile(path.join(root, "view.arrangement.json"), writeArrangement(arrangement));
    const said = await run({ path: "view.json", output_path: "figures/view.svg", viewpoint: "power", hide_element_kinds: ["load"] });
    assert.match(said, /Drawn with the arrangement `view\.arrangement\.json` for viewpoint `power`\./);
    const svg = await readFile(path.join(root, "figures", "view.svg"), "utf8");
    assert.deepEqual({ x: boxIn(svg, "inverter").x - boxIn(svg, "battery").x, y: boxIn(svg, "inverter").y - boxIn(svg, "battery").y }, { x: 0, y: 160 });
    assert.doesNotMatch(svg, /data-element-id="motor"/);
  });

  test("a document outside the writable zone gets its figure, and the result says the places were not recorded", async () => {
    await writeFile(path.join(readOnly, "reference.json"), graph());
    const said = await run({ path: path.join(readOnly, "reference.json"), output_path: "figures/reference.svg" });
    assert.match(said, /The places it computed were not recorded: Cannot write "[^"]*reference\.arrangement\.json": it is outside the writable zone/);
    await assert.rejects(readFile(path.join(readOnly, "reference.arrangement.json"), "utf8"));
  });

  test("an arrangement that cannot be read is named, the graph laid out without it, and it is not overwritten", async () => {
    await writeFile(path.join(root, "bad.json"), graph());
    await writeFile(path.join(root, "bad.arrangement.json"), "{ nope");
    const said = await run({ path: "bad.json", output_path: "figures/bad.svg" });
    assert.match(said, /The arrangement `bad\.arrangement\.json` beside the document is not used \(it is not parseable JSON\)/);
    assert.equal(await readFile(path.join(root, "bad.arrangement.json"), "utf8"), "{ nope");
  });
});
