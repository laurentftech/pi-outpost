/**
 * structured-exchange-arrangement: a graph drawn, its arrangement recorded, then revised (an
 * element added) and drawn again with that arrangement — before and after as PNG, to look at.
 *
 *   npx tsx scripts/probes/structured-arrangement/revision.mts <out-dir>
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { graphFigure, graphFigurePage, serializeFigure } from "@pi-outpost/shared/structured-exchange/figure";
import { viewFromPage } from "@pi-outpost/shared/structured-exchange/placement";
import { writeArrangement, emptyArrangement } from "@pi-outpost/shared/structured-exchange/arrangement";
import type { StructuredGraphData } from "@pi-outpost/shared/structured-exchange";
import { rasterizeSvg } from "../../../server/src/presentationRender.ts";
import { vehicle } from "./vehicle.mts";

const revised: StructuredGraphData = {
  nodes: [...vehicle.nodes, { id: "heatpump", label: "Pompe à chaleur", kind: "thermal" }],
  edges: [...vehicle.edges, { from: "cooling", to: "heatpump", kind: "thermal", label: "calories" }],
};

const out = process.argv[2];
if (!out) throw new Error("usage: revision.mts <out-dir>");
await mkdir(out, { recursive: true });
const view = viewFromPage(vehicle, graphFigurePage(vehicle));
await writeFile(path.join(out, "vehicle.arrangement.json"), writeArrangement({ ...emptyArrangement(), views: { "": view } }));
for (const [name, data] of [["before", vehicle], ["after", revised]] as const) {
  const svg = serializeFigure(graphFigure(data, { isProposal: false, arrangement: view }));
  await writeFile(path.join(out, `${name}.svg`), svg);
  const size = /viewBox="[\d.-]+ [\d.-]+ ([\d.]+) ([\d.]+)"/.exec(svg);
  const png = await rasterizeSvg(Buffer.from(svg), Math.round(Number(size?.[1]) * 2), Math.round(Number(size?.[2]) * 2));
  await writeFile(path.join(out, `${name}.png`), png!);
  console.log(path.join(out, `${name}.png`));
}
