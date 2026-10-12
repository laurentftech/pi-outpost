/**
 * What a structured-exchange file offers in the viewer's rendered mode: the buttons
 * next to each kind's figure, read from the running interface. Written for "on the
 * rendered view of a structured-exchange JSON there is no SVG download".
 *
 *   npm run build --workspace web
 *   node --import tsx/esm scripts/probes/viewer-structured-exports.mts [another document.json]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import { makeWorkspace, startServer } from "../../server/test/harness.mjs";

const REPO = path.resolve(import.meta.dirname, "../..");
const sample = (name: string) => readFile(path.join(REPO, "shared/conformance/valid", name), "utf8");
const files: Record<string, string> = {
  "graph.json": await sample("v2-graph-minimal.json"),
  "sequence.json": await sample("sequence-minimal.json"),
  "timeline.json": await sample("v3-timeline-calendar.json"),
  ...(process.argv[2] ? { [path.basename(process.argv[2])]: await readFile(process.argv[2], "utf8") } : {}),
};
const env: Record<string, string | undefined> = {
  ...Object.fromEntries(Object.keys(process.env).filter((key) => /API_KEY|AUTH_TOKEN|_TOKEN$/.test(key)).map((key) => [key, undefined])),
  ANTHROPIC_API_KEY: "sk-ant-not-a-real-key",
};
const server = await startServer(await makeWorkspace(files), {}, { env });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(`http://127.0.0.1:${server.port}/`);
  await page.getByTitle("Show files").click();
  for (const name of Object.keys(files)) {
    await page.getByText(name, { exact: true }).click();
    await page.waitForTimeout(1200);
    const view = page.locator("[data-testid=file-structured-exchange]");
    const buttons = (await view.count()) ? await view.getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.textContent ?? "")) : ["(no rendering)"];
    console.log(name, "→", buttons.map((text) => text.trim()).filter(Boolean).join(" | "));
    await page.screenshot({ path: `/tmp/viewer-${name}.png` });
  }
} finally {
  await browser.close();
  await server.stop();
}
