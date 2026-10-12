/**
 * A figure compacted by hand downloads compacted: open a graph in the viewer, download it
 * as SVG from the toolbar, drag its boxes together, download again, and compare the two
 * files' sizes. Written for "I tightened a sprawling figure by hand and the SVG came out
 * as before".
 *
 *   npm run build --workspace web
 *   node --import tsx/esm scripts/probes/viewer-figure-fit.mts [graph.json]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";
import { makeWorkspace, startServer } from "../../server/test/harness.mjs";

const source = process.argv[2] ?? path.resolve(import.meta.dirname, "../../shared/conformance/valid/graph-minimal.json");
const name = path.basename(source);
const env: Record<string, string | undefined> = {
  ...Object.fromEntries(Object.keys(process.env).filter((key) => /API_KEY|AUTH_TOKEN|_TOKEN$/.test(key)).map((key) => [key, undefined])),
  ANTHROPIC_API_KEY: "sk-ant-not-a-real-key",
};
const server = await startServer(await makeWorkspace({ [name]: await readFile(source, "utf8") }), {}, { env });
const browser = await chromium.launch();

async function downloadSize(page: Page) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download the figure as SVG" }).click();
  const svg = await readFile(await (await download).path(), "utf8");
  const root = /<svg[^>]*>/.exec(svg)?.[0] ?? "";
  return { width: Number(/\swidth="([\d.]+)"/.exec(root)?.[1]), height: Number(/\sheight="([\d.]+)"/.exec(root)?.[1]), viewBox: /viewBox="([^"]+)"/.exec(root)?.[1] };
}

try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(`http://127.0.0.1:${server.port}/`);
  await page.getByTitle("Show files").click();
  await page.getByText(name, { exact: true }).click();
  await page.getByRole("button", { name: "Download the figure as SVG" }).waitFor();
  const before = await downloadSize(page);

  // Drag every box but the first next to the first, one under another.
  const boxes = page.locator("[data-testid=file-structured-exchange] svg [data-element-id]");
  const count = await boxes.count();
  const first = (await boxes.nth(0).boundingBox())!;
  for (let index = 1; index < count; index += 1) {
    const box = (await boxes.nth(index).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(first.x + first.width * 1.8, first.y + index * (first.height + 12), { steps: 8 });
    await page.mouse.up();
  }
  const after = await downloadSize(page);
  console.log(JSON.stringify({ boxes: count, before, after }, null, 1));
  await page.screenshot({ path: `/tmp/figure-fit-${name}.png` });
} finally {
  await browser.close();
  await server.stop();
}
