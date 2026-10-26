/**
 * The routes draw.io itself gives a diagram's wires, and where it puts their labels, printed as
 * JSON by file and page (e2e/fixtures/drawio-viewer-routes.ts reads them from the vendored
 * viewer).
 *
 *   npx tsx scripts/probes/drawio-routes-oracle.mts <file.drawio> [...]
 */
import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadViewer, viewerRoutes, type ViewerEdge } from "../../e2e/fixtures/drawio-viewer-routes.ts";

export type OracleEdge = ViewerEdge;

/** Every page's edges, by file and page name. */
export async function oracle(files: string[]): Promise<Record<string, Record<string, OracleEdge[]>>> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await loadViewer(page);
    const out: Record<string, Record<string, OracleEdge[]>> = {};
    for (const file of files) out[file] = await viewerRoutes(page, await fs.readFile(file, "utf8"));
    return out;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  console.log(JSON.stringify(await oracle(process.argv.slice(2)), null, 1));
}
