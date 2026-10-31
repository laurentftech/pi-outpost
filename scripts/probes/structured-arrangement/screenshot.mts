/** structured-exchange-arrangement: SVG files screenshotted in Chromium, where fonts and accents render as in the app. */
import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";

const files = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
for (const file of files) {
  await page.setContent(`<body style="margin:0;background:#fff">${await readFile(file, "utf8")}</body>`);
  await page.locator("svg").first().screenshot({ path: file.replace(/\.svg$/, ".png") });
  console.log(file.replace(/\.svg$/, ".png"));
}
await browser.close();
