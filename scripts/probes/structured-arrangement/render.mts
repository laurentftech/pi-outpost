/**
 * structured-exchange-arrangement: write a graph document's figure as SVG and PNG, to look at.
 *
 *   npx tsx scripts/probes/structured-arrangement/render.mts <document.json> <out-dir> [viewpoint]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { figureForDocument, describeFigureRefusal } from "@pi-outpost/shared/structured-exchange/export";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";
import { rasterizeSvg } from "../../../server/src/presentationRender.ts";

const [file, out, viewpoint] = process.argv.slice(2);
if (!file || !out) throw new Error("usage: render.mts <document.json> <out-dir> [viewpoint]");
const result = figureForDocument(await readFile(file, "utf8"), checkStructuredExchangeSchema, viewpoint ? { viewpoint } : {});
if (!result.ok) throw new Error(describeFigureRefusal(result));
await mkdir(out, { recursive: true });
const base = path.join(out, path.basename(file, ".json") + (viewpoint ? `-${viewpoint}` : ""));
await writeFile(`${base}.svg`, result.svg);
const size = /viewBox="[\d.-]+ [\d.-]+ ([\d.]+) ([\d.]+)"/.exec(result.svg);
const png = await rasterizeSvg(Buffer.from(result.svg), Math.round(Number(size?.[1] ?? 1200) * 2), Math.round(Number(size?.[2] ?? 800) * 2));
if (png === null) throw new Error("no canvas to rasterise with");
await writeFile(`${base}.png`, png);
console.log(`${base}.png`);
