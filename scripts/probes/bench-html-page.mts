/**
 * A workspace HTML page in the file viewer, driven destructively in the running bench:
 * its script, anchors, links and escape attempts, files switched under a page still
 * being prepared, and a stylesheet removed from disk under it.
 *
 *   npm run bench            (in another terminal; seeds report/index.html)
 *   node --import tsx/esm scripts/probes/bench-html-page.mts <bench workspace> [server url]
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";

const [workspace, server = "http://127.0.0.1:4322"] = process.argv.slice(2);
if (!workspace) throw new Error("usage: bench-html-page.mts <bench workspace> [server url]");

const browser = await chromium.launch();
const errors: string[] = [];
const seen: Record<string, unknown> = {};
const frameOf = (page: Page) => page.frameLocator('[data-testid="html-page"]');

async function openReport(page: Page) {
  await page.getByText("index.html", { exact: true }).click();
  await frameOf(page).locator("#top").waitFor();
}

try {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(server);
  await page.getByTitle("Show files").click();
  await page.getByText("report", { exact: true }).click();
  await openReport(page);
  const frame = frameOf(page);

  // The page's own script, clicked fast.
  for (let index = 0; index < 5; index++) await frame.locator("#more").click();
  seen.counter = await frame.locator("#counter").textContent();
  seen.titleColor = await frame.locator("#top").evaluate((element) => getComputedStyle(element).color);
  seen.chartLoaded = await frame.locator('img[alt="chart"]').evaluate((image: HTMLImageElement) => image.naturalWidth);
  seen.missingPictureKept = await frame.locator('img[alt="missing picture"]').getAttribute("src");

  // An attempt to take the whole window.
  const before = page.url();
  await frame.locator("#escape").click();
  await page.waitForTimeout(500);
  seen.escape = { counter: await frame.locator("#counter").textContent(), windowStayed: page.url() === before };

  // Anchors: down, then back up, the page still there.
  await frame.getByText("to the end").click();
  await page.waitForTimeout(300);
  seen.scrolledToEnd = await frame.locator("body").evaluate(() => window.scrollY > 0);
  await frame.getByText("back to top").click();
  await page.waitForTimeout(300);
  seen.backToTop = await frame.locator("#top").evaluate((element) => Math.abs(element.getBoundingClientRect().top) < 2);
  seen.pageStillThere = await frame.locator("#top").textContent();

  // An external link opens a tab, not the frame.
  const [popup] = await Promise.all([context.waitForEvent("page", { timeout: 5000 }).catch(() => null), frame.getByText("example.com").click()]);
  seen.externalOpenedTab = popup === null ? null : popup.url();
  await popup?.close();
  seen.frameAfterExternal = await frame.locator("#top").textContent();

  // A relative link to a file that does not exist.
  await frame.getByText("a missing page").click();
  await page.waitForTimeout(800);
  seen.missingLink = await page.locator(".text-red-600").first().textContent({ timeout: 3000 }).catch(() => "(nothing said)");

  // The relative link to another folder.
  await openReport(page);
  await frameOf(page).getByText("the notes").click();
  await page.getByRole("heading", { name: "notes" }).waitFor({ timeout: 5000 }).then(
    () => (seen.notesOpened = true),
    () => (seen.notesOpened = false),
  );

  // Switching files while the page is still being prepared: no frame left over a Markdown file.
  await openReport(page);
  await page.getByText("index.html", { exact: true }).click();
  await page.getByText("style.css", { exact: true }).click();
  await page.getByText("index.html", { exact: true }).click();
  await page.getByText("readme.md", { exact: true }).click();
  await page.waitForTimeout(1000);
  seen.frameOverMarkdown = await page.getByTestId("html-page").count();

  // Modes toggled hard.
  await openReport(page);
  for (let index = 0; index < 4; index++) {
    await page.getByRole("button", { name: /source/ }).click();
    await page.getByRole("button", { name: /split/ }).click();
    await page.getByRole("button", { name: /rendered/ }).click();
  }
  seen.afterToggles = await frameOf(page).locator("#top").textContent();

  // The stylesheet removed from disk, then the page opened again.
  await rm(path.join(workspace, "report", "style.css"));
  await page.getByText("readme.md", { exact: true }).click();
  await page.waitForTimeout(500);
  await openReport(page);
  seen.afterStylesheetRemoved = {
    title: await frameOf(page).locator("#top").textContent(),
    color: await frameOf(page).locator("#top").evaluate((element) => getComputedStyle(element).color),
  };

} finally {
  seen.consoleErrors = errors;
  console.log(JSON.stringify(seen, null, 2));
  await browser.close();
}
