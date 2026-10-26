/**
 * The check's routes against the viewer's (drawio-wire-overlaps, design 3): for every wire the
 * port routes, its points must be the viewer's within half a unit. Prints each mismatch and a
 * tally; exits non-zero on any mismatch.
 *
 *   npx tsx scripts/probes/drawio-routes-compare.mts <file.drawio> [...]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readDrawio } from "../../server/src/drawio.ts";
import { labelPoint, pageGeometry, routeWire, type Point } from "../../server/src/drawioRoutes.ts";
import { sameRoute } from "../../e2e/fixtures/drawio-viewer-routes.ts";
import { oracle } from "./drawio-routes-oracle.mts";

export interface Comparison {
  /** Each labelled wire: where the port centres its label, the viewer's measured box, the text and font size. */
  labels: Array<{ ours: Point; viewer: { x: number; y: number; width: number; height: number }; text: string; fontSize: number }>;
  routed: number;
  unrouted: number;
  mismatches: Array<{ file: string; page: string; id: string; ours: Point[]; viewer: Point[] }>;
}

export async function compare(files: string[]): Promise<Comparison> {
  const truth = await oracle(files);
  const result: Comparison = { labels: [], routed: 0, unrouted: 0, mismatches: [] };
  for (const file of files) {
    const pages = readDrawio(await fs.readFile(file, "utf8"));
    const viewerPages = truth[file] ?? {};
    const names = Object.keys(viewerPages);
    pages.forEach((page, index) => {
      const viewer = viewerPages[page.name] ?? viewerPages[names[index] ?? ""] ?? [];
      const geometry = pageGeometry(page);
      for (const cell of page.cells) {
        if (!cell.edge || cell.id === undefined) continue;
        const route = routeWire(cell, geometry);
        if (route === undefined) {
          result.unrouted += 1;
          continue;
        }
        result.routed += 1;
        const seen = viewer.find((edge) => edge.id === cell.id);
        if (seen?.label !== undefined && cell.label !== "" && cell.geometry !== undefined) {
          const fontSize = Number(/(?:^|;)fontSize=([\d.]+)/.exec(cell.style)?.[1] ?? 11);
          result.labels.push({ ours: labelPoint(route, { x: cell.geometry.x, y: cell.geometry.y }, cell.geometry.offset), viewer: seen.label, text: cell.label, fontSize });
        }
        if (seen === undefined || !sameRoute(route.points, seen.points)) {
          result.mismatches.push({ file, page: page.name, id: cell.id, ours: route.points, viewer: seen?.points ?? [] });
        }
      }
    });
  }
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const result = await compare(process.argv.slice(2));
  for (const miss of result.mismatches) {
    const show = (points: Point[]) => points.map((p) => `${p.x},${p.y}`).join(" ");
    console.log(`${miss.file} [${miss.page}] ${miss.id}\n  ours   ${show(miss.ours)}\n  viewer ${show(miss.viewer)}`);
  }
  let off = 0;
  const ratios: number[] = [];
  for (const label of result.labels) {
    const c = { x: label.viewer.x + label.viewer.width / 2, y: label.viewer.y + label.viewer.height / 2 };
    if (Math.abs(c.x - label.ours.x) > 2 || Math.abs(c.y - label.ours.y) > 2) {
      off += 1;
      if (off <= 10) console.log(`label off: ours ${label.ours.x},${label.ours.y} viewer centre ${c.x},${c.y} "${label.text}"`);
    }
    ratios.push(label.viewer.width / (label.text.length * label.fontSize));
  }
  ratios.sort((a, b) => a - b);
  const heights = result.labels.map((label) => label.viewer.height / label.fontSize).sort((a, b) => a - b);
  console.log(`labels ${result.labels.length}, centres off by > 2: ${off}; width/(chars*fontSize) min ${ratios[0]?.toFixed(3)} median ${ratios[ratios.length >> 1]?.toFixed(3)} max ${ratios.at(-1)?.toFixed(3)}; height/fontSize min ${heights[0]?.toFixed(2)} median ${heights[heights.length >> 1]?.toFixed(2)} max ${heights.at(-1)?.toFixed(2)}`);
  console.log(`routed ${result.routed}, unrouted ${result.unrouted}, mismatches ${result.mismatches.length}`);
  process.exitCode = result.mismatches.length > 0 ? 1 : 0;
}
