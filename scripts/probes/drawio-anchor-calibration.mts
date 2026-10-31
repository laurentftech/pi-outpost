/**
 * drawio-wire-anchors, task 1.2: what the anchor rules report on real agent diagrams and on
 * the generated route corpus, with the numbers each detour was judged on.
 *
 *   npx tsx scripts/probes/drawio-anchor-calibration.mts
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { corpus } from "../../e2e/fixtures/drawio-routes-corpus.ts";
import { readDrawio } from "../../server/src/drawio.ts";
import { anchorWire, wireAnchorIssues } from "@pi-outpost/shared/drawio/anchors";
import { pageGeometry, routeWire } from "@pi-outpost/shared/drawio/routes";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "server", "test", "fixtures", "drawio");

function report(name: string, xml: string, verbose: boolean) {
  const counts: Record<string, number> = {};
  for (const page of readDrawio(xml)) {
    const geometry = pageGeometry(page);
    const byId = new Map(page.cells.map((cell) => [cell.id, cell]));
    const wires = page.cells.flatMap((cell) => {
      if (!cell.edge || cell.id === undefined) return [];
      const route = routeWire(cell, geometry);
      return route === undefined ? [] : [anchorWire({ ...cell, id: cell.id }, page.cells, route.points)];
    });
    const describe = (id: string) => {
      const label = byId.get(id)?.label ?? "";
      return label === "" ? `"${id}"` : `"${id}" (${label.slice(0, 30)})`;
    };
    const issues = wireAnchorIssues(wires, new Map([...geometry.terminals].map(([id, t]) => [id, t.box])), describe);
    for (const issue of issues) {
      counts[issue.rule] = (counts[issue.rule] ?? 0) + 1;
      if (verbose) console.log(`  [${page.name}] ${issue.rule}: ${issue.message}`);
    }
    if (verbose) console.log(`  [${page.name}] ${wires.length} routed wires`);
  }
  return counts;
}

for (const name of (await readdir(FIXTURES)).filter((file) => file.endsWith(".drawio"))) {
  console.log(`== ${name}`);
  console.log("  ", report(name, await readFile(path.join(FIXTURES, name), "utf8"), true));
}
const totals: Record<string, number> = {};
for (const xml of corpus(80, 1)) for (const [rule, count] of Object.entries(report("corpus", xml, false))) totals[rule] = (totals[rule] ?? 0) + count;
console.log("== generated corpus (80 files)", totals);
