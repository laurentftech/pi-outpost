/**
 * The source of a function as the vendored draw.io viewer actually runs it, to check a port
 * against what is shipped rather than against mxGraph's repository.
 *
 *   npx tsx scripts/probes/drawio-viewer-source.mts mxEdgeStyle.TopToBottom [more…]
 */
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";

const viewer = fileURLToPath(new URL("../../web/public/vendor/drawio/viewer-static.min.js", import.meta.url));
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent("<div id=g></div>");
  await page.addScriptTag({ path: viewer });
  for (const name of process.argv.slice(2)) {
    const source = await page.evaluate((path) => {
      let value: unknown = window;
      for (const part of path.split(".")) value = (value as Record<string, unknown>)?.[part];
      return typeof value === "function" ? value.toString() : JSON.stringify(value);
    }, name);
    console.log(`== ${name}\n${source}\n`);
  }
} finally {
  await browser.close();
}
