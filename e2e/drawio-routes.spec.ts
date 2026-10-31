/**
 * drawio_check routes wires as the viewer pi-outpost ships does (drawio-diagrams:
 * DrawioCheckSeesWires, RoutesMatchTheViewer): the port's route for every wire it routes is held
 * to the route the vendored viewer itself computes, read from the viewer in this page. Without
 * this, a warning about a wire through a box could be about a route nobody sees.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { readDrawio } from "../server/src/drawio.ts";
import { anchorWire, wireAnchorIssues, type AnchorWire } from "@pi-outpost/shared/drawio/anchors";
import { labelPoint, pageGeometry, routeWire } from "@pi-outpost/shared/drawio/routes";
import { readdirSync, readFileSync } from "node:fs";
import { writeDrawio } from "@pi-outpost/shared/drawio/write";
import { graphFigurePage } from "@pi-outpost/shared/structured-exchange/figure";
import { parseStructuredExchange } from "@pi-outpost/shared/structured-exchange/parse";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";
import type { StructuredGraphData } from "@pi-outpost/shared/structured-exchange";
import { corpus } from "./fixtures/drawio-routes-corpus.ts";
import { loadViewer, sameRoute, viewerRoutes } from "./fixtures/drawio-viewer-routes.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server", "test", "fixtures", "drawio");

// openlore: scenario=RoutesMatchTheViewer spec=drawio-diagrams
test("RoutesMatchTheViewer: every routed wire of the live runs', the repository's and generated diagrams has the viewer's points, and its label the viewer's centre", async ({ page }) => {
  test.setTimeout(240_000);
  await loadViewer(page);
  const files = (await fs.readdir(FIXTURES)).filter((name) => name.endsWith(".drawio"));
  const diagrams: Array<[string, string]> = [
    ...(await Promise.all(files.map(async (name) => [name, await fs.readFile(path.join(FIXTURES, name), "utf8")] as [string, string]))),
    ...corpus(80, 1).map((xml, index) => [`generated-${index}`, xml] as [string, string]),
  ];
  let routed = 0;
  let unrouted = 0;
  let labels = 0;
  const mismatches: string[] = [];
  for (const [name, xml] of diagrams) {
    const viewer = await viewerRoutes(page, xml);
    const viewerPages = Object.values(viewer);
    readDrawio(xml).forEach((drawn, index) => {
      const edges = viewer[drawn.name] ?? viewerPages[index] ?? [];
      const geometry = pageGeometry(drawn);
      for (const cell of drawn.cells) {
        if (!cell.edge || cell.id === undefined) continue;
        const route = routeWire(cell, geometry);
        if (route === undefined) {
          unrouted += 1;
          continue;
        }
        routed += 1;
        const seen = edges.find((edge) => edge.id === cell.id);
        if (seen === undefined || !sameRoute(route.points, seen.points)) {
          mismatches.push(`${name} ${cell.id}: ours ${JSON.stringify(route.points)} viewer ${JSON.stringify(seen?.points)}`);
          continue;
        }
        if (seen.label !== undefined && cell.label !== "" && cell.geometry !== undefined) {
          labels += 1;
          const ours = labelPoint(route, { x: cell.geometry.x, y: cell.geometry.y }, cell.geometry.offset);
          const centre = { x: seen.label.x + seen.label.width / 2, y: seen.label.y + seen.label.height / 2 };
          if (Math.abs(ours.x - centre.x) > 2 || Math.abs(ours.y - centre.y) > 2) mismatches.push(`${name} ${cell.id} label: ours ${JSON.stringify(ours)} viewer centre ${JSON.stringify(centre)}`);
        }
      }
    });
  }
  expect(mismatches).toEqual([]);
  // The comparison covered the ground it claims, not a corpus the port happens to skip
  expect(routed).toBeGreaterThan(600);
  expect(unrouted).toBeLessThan(routed / 20);
  expect(labels).toBeGreaterThan(250);
});

// openlore: scenario=AnchorWarningsMatchTheViewer spec=drawio-diagrams
test("AnchorWarningsMatchTheViewer: shared points, ends facing away and detours are the same on the viewer's routes", async ({ page }) => {
  test.setTimeout(240_000);
  await loadViewer(page);
  const files = (await fs.readdir(FIXTURES)).filter((name) => name.endsWith(".drawio"));
  const diagrams: Array<[string, string]> = [
    ...(await Promise.all(files.map(async (name) => [name, await fs.readFile(path.join(FIXTURES, name), "utf8")] as [string, string]))),
    ...corpus(80, 1).map((xml, index) => [`generated-${index}`, xml] as [string, string]),
  ];
  const counts: Record<string, number> = { "shared-point": 0, "facing-away": 0, detour: 0 };
  const differences: string[] = [];
  for (const [name, xml] of diagrams) {
    const viewer = await viewerRoutes(page, xml);
    const viewerPages = Object.values(viewer);
    readDrawio(xml).forEach((drawn, index) => {
      const edges = viewer[drawn.name] ?? viewerPages[index] ?? [];
      const geometry = pageGeometry(drawn);
      const boxes = new Map([...geometry.terminals].map(([id, terminal]) => [id, terminal.box]));
      const ours: AnchorWire[] = [];
      const theirs: AnchorWire[] = [];
      // The wires the check routes, each with its route and with the viewer's
      for (const cell of drawn.cells) {
        if (!cell.edge || cell.id === undefined) continue;
        const route = routeWire(cell, geometry);
        const seen = edges.find((edge) => edge.id === cell.id);
        if (route === undefined || seen === undefined) continue;
        const origin = geometry.origins.get(cell.id) ?? undefined;
        ours.push(anchorWire({ ...cell, id: cell.id }, drawn.cells, route.points, origin));
        theirs.push(anchorWire({ ...cell, id: cell.id }, drawn.cells, seen.points, origin));
      }
      const summary = (wires: AnchorWire[]) => wireAnchorIssues(wires, boxes).map((issue) => `${issue.rule} ${issue.wires.join(",")} on ${issue.shapes.join(",")}`).sort();
      const mine = summary(ours);
      const viewers = summary(theirs);
      for (const issue of mine) counts[issue.split(" ")[0]!] += 1;
      if (JSON.stringify(mine) !== JSON.stringify(viewers)) differences.push(`${name}/${drawn.name}: ours ${JSON.stringify(mine)} viewer ${JSON.stringify(viewers)}`);
    });
  }
  expect(differences).toEqual([]);
  // Each rule fired often enough for the agreement to mean something
  expect(counts["shared-point"]).toBeGreaterThan(50);
  expect(counts["facing-away"]).toBeGreaterThan(50);
  expect(counts.detour).toBeGreaterThan(50);
});

/** Every graph document in the repository, and two that exercise parallel relationships and detours. */
function structuredGraphs(): Array<[string, StructuredGraphData]> {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const valid = path.join(root, "shared", "conformance", "valid");
  const files = [...readdirSync(valid).map((name) => path.join(valid, name)), path.join(root, "models", "vehicle-architecture.json")].filter((file) => file.endsWith(".json"));
  const graphs = files.flatMap((file): Array<[string, StructuredGraphData]> => {
    const outcome = parseStructuredExchange(JSON.parse(readFileSync(file, "utf8")), checkStructuredExchangeSchema);
    return outcome.valid && outcome.envelope.kind === "graph" ? [[path.basename(file), outcome.envelope.data as StructuredGraphData]] : [];
  });
  const node = (id: string) => ({ id, label: id.toUpperCase() });
  graphs.push(["parallel", { nodes: ["a", "b"].map(node), edges: ["one", "two", "three", "four", "five"].map((kind, index) => (index < 3 ? { from: "a", to: "b", kind } : { from: "b", to: "a", kind })) }]);
  graphs.push(["spanning", { nodes: ["a", "b", "c", "d"].map(node), edges: [["a", "b"], ["b", "c"], ["c", "d"], ["a", "d"], ["a", "c"]].map(([from, to]) => ({ from: from!, to: to!, kind: "k" })) }]);
  return graphs;
}

// openlore: scenario=TheRoutesAreDrawioRoutes spec=structured-exchange-arrangement
test("TheRoutesAreDrawioRoutes: a structured-exchange figure's page, drawn by the viewer, follows the routes the figure draws", async ({ page }) => {
  test.setTimeout(240_000);
  await loadViewer(page);
  let compared = 0;
  let detoured = 0;
  const mismatches: string[] = [];
  for (const [name, data] of structuredGraphs()) {
    const figurePage = graphFigurePage(data);
    const viewer = Object.values(await viewerRoutes(page, writeDrawio(figurePage)))[0] ?? [];
    const geometry = pageGeometry(figurePage);
    for (const cell of figurePage.cells) {
      if (!cell.edge || cell.id === undefined || cell.source === cell.target) continue;
      const route = routeWire(cell, geometry);
      const seen = viewer.find((edge) => edge.id === cell.id);
      compared += 1;
      if ((cell.geometry?.points.length ?? 0) > 0) detoured += 1;
      if (route === undefined || seen === undefined || !sameRoute(route.points, seen.points)) mismatches.push(`${name} ${cell.id}: ours ${JSON.stringify(route?.points)} viewer ${JSON.stringify(seen?.points)}`);
    }
  }
  expect(mismatches).toEqual([]);
  expect(compared).toBeGreaterThan(40);
  // The corpus reaches the detour waypoints, not only straight runs
  expect(detoured).toBeGreaterThan(0);
});
