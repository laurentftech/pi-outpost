/**
 * A page of a .drawio file drawn by the vendored viewer, as a PNG, to look at what a check says.
 *
 *   npx tsx scripts/probes/drawio-render-png.mts <file.drawio> <out.png> [page index]
 */
import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const viewer = fileURLToPath(new URL("../../web/public/vendor/drawio/viewer-static.min.js", import.meta.url));
const [file, out, index = "0"] = process.argv.slice(2);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });
  await page.setContent("<!doctype html><body style='margin:0;background:#fff'><div id=g></div></body>");
  await page.addScriptTag({ path: viewer });
  const xml = await fs.readFile(file!, "utf8");
  await page.evaluate(([text, at]) => {
    const w = window as unknown as Record<string, any>;
    const doc = w.mxUtils.parseXml(text);
    const diagrams = [...doc.documentElement.getElementsByTagName("diagram")] as Element[];
    const diagram = diagrams[Number(at)];
    const node = diagram === undefined ? doc.documentElement : diagram.firstElementChild ?? w.mxUtils.parseXml(w.Graph.decompress(diagram.textContent)).documentElement;
    const graph = new w.Graph(document.getElementById("g"));
    new w.mxCodec(node.ownerDocument).decode(node, graph.getModel());
    graph.view.setTranslate(10, 10);
  }, [xml, index] as const);
  await page.locator("#g svg").first().screenshot({ path: out! });
} finally {
  await browser.close();
}
