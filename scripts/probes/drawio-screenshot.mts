/**
 * PNG screenshots of .drawio files as the vendored viewer draws them, white background.
 *
 *   npx tsx scripts/probes/drawio-screenshot.mts <out dir> <file.drawio>...
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import { DRAWIO_VIEWER } from "../../e2e/fixtures/drawio-viewer-routes.ts";

const [out, ...files] = process.argv.slice(2);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  for (const file of files) {
    await page.setContent("<!doctype html><html><body style='margin:0;background:#fff'><div id=g style='display:inline-block;padding:20px'></div></body></html>");
    await page.addScriptTag({ path: DRAWIO_VIEWER });
    const xml = await readFile(file, "utf8");
    await page.evaluate((text) => {
      const w = window as unknown as Record<string, any>;
      const doc = w.mxUtils.parseXml(text);
      const diagram = doc.documentElement.getElementsByTagName("diagram")[0];
      const node = diagram.firstElementChild ?? w.mxUtils.parseXml(w.Graph.decompress(diagram.textContent)).documentElement;
      const container = document.getElementById("g")!;
      const graph = new w.Graph(container);
      new w.mxCodec(node.ownerDocument).decode(node, graph.getModel());
      graph.fit(0);
      const bounds = graph.getGraphBounds();
      container.style.width = `${Math.ceil(bounds.x + bounds.width + 20)}px`;
      container.style.height = `${Math.ceil(bounds.y + bounds.height + 20)}px`;
    }, xml);
    await page.waitForTimeout(300);
    const target = path.join(out!, `${path.basename(file, ".drawio")}.png`);
    await page.locator("#g").screenshot({ path: target });
    console.log(target);
  }
} finally {
  await browser.close();
}
