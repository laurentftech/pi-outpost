/**
 * A poster in pi-outpost's file viewer, as somebody uses it: opened in the poster editor
 * the server serves, retouched, saved to the file, exported — and kept from the
 * application by the editor frame's policy. Checked in a real browser against the real
 * server, since the frame, its policy and the file API only meet there.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { readPage } from "@pi-outpost/posters/format";

const POSTER = path.join("posters", "Class rules.poster.html");

async function openPoster(page: Page, name = "Class rules.poster.html"): Promise<FrameLocator> {
  await page.goto(process.env.PI_E2E_SERVER_URL!);
  await expect(page.getByTitle("connected")).toBeVisible();
  await page.getByTitle("Show files").click();
  await page.getByText("posters", { exact: true }).click();
  await page.getByText(name, { exact: true }).click();
  return page.frameLocator('[data-testid="poster-frame"]');
}

test.afterEach(async () => {
  // Each test starts from the poster the setup wrote.
  const file = path.join(process.env.PI_E2E_PRIMARY_PROJECT!, POSTER);
  const page = readPage(await fs.readFile(file, "utf8"));
  if (!page.html.includes("I raise my hand")) throw new Error("a test left the poster changed: reset it in the test");
});

// openlore: scenario=APosterFileOpensInTheEditor spec=poster-files
// openlore: scenario=TouchUpsReachTheAgent spec=poster-files
test("APosterFileOpensInTheEditor and TouchUpsReachTheAgent: drawn in the editor, a correction saved reaches the file", async ({ page }) => {
  const file = path.join(process.env.PI_E2E_PRIMARY_PROJECT!, POSTER);
  const original = await fs.readFile(file, "utf8");
  try {
    const editor = await openPoster(page);
    const canvas = editor.frameLocator("iframe.gjs-frame");
    const title = canvas.locator(".rule.c1 h2");
    await expect(title).toHaveText("I raise my hand", { timeout: 20_000 });
    await expect(page.getByRole("group", { name: "How to show this document" })).not.toContainText("split");
    await title.click();
    await title.dblclick();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("I raise my hand and wait");
    await canvas.locator(".motto").click();
    await editor.locator('button[data-action="save"]').click();
    await expect(editor.locator(".poster-status")).toHaveText(/Saved/);
    await expect.poll(async () => readPage(await fs.readFile(file, "utf8")).html).toContain("I raise my hand and wait");
  } finally {
    await fs.writeFile(file, original);
  }
});

// openlore: scenario=ABrokenPosterSaysWhy spec=poster-files
test("ABrokenPosterSaysWhy: the reason and the source, not an empty editor", async ({ page }) => {
  await openPoster(page, "broken.poster.html");
  await expect(page.getByTestId("poster-unreadable")).toContainText(/no <meta name="poster-format">/);
  await expect(page.locator("pre", { hasText: "not a poster" })).toBeVisible();
  await expect(page.getByTestId("poster-frame")).toHaveCount(0);
});

// openlore: scenario=APowerPointExportDownloads spec=poster-files
test("APowerPointExportDownloads: the browser downloads a .pptx named after the poster", async ({ page }) => {
  const editor = await openPoster(page);
  await expect(editor.frameLocator("iframe.gjs-frame").locator(".rule h2").first()).toBeVisible({ timeout: 20_000 });
  const download = page.waitForEvent("download", { timeout: 30_000 });
  await editor.locator('button[data-action="powerpoint"]').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("Our class rules.pptx");
  const bytes = await fs.readFile((await file.path())!);
  expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
});

// openlore: scenario=APosterCannotReachTheApplication spec=poster-editor
// openlore: scenario=ARemoteImageIsNotFetched spec=poster-documents
test("APosterCannotReachTheApplication: a handler in the poster does not run, nothing is fetched, the policy holds", async ({ page }) => {
  const file = path.join(process.env.PI_E2E_PRIMARY_PROJECT!, POSTER);
  const original = await fs.readFile(file, "utf8");
  const server = new URL(process.env.PI_E2E_SERVER_URL!).origin;
  // A request the policy blocks still shows as a request, then fails: what matters is
  // that none is answered, and that the remote image is among those refused.
  const answered: string[] = [];
  const refused: string[] = [];
  page.on("response", (response) => {
    const url = response.url();
    if (!url.startsWith(server) && !url.startsWith(new URL(page.url() || server).origin) && !/^(data|blob|about):/.test(url)) answered.push(url);
  });
  page.on("requestfailed", (request) => refused.push(`${request.url()} ${request.failure()?.errorText ?? ""}`));
  try {
    const trap = original.replace(
      "<p class=\"motto\">",
      `<img src="x" onerror="parent.parent.__posterPwned = true"><a id="trap" href="javascript:parent.parent.__posterPwned=true">trap</a><img src="https://example.com/leak.png"><p class="motto">`,
    );
    await fs.writeFile(file, trap);
    const editor = await openPoster(page);
    const canvas = editor.frameLocator("iframe.gjs-frame");
    await expect(canvas.locator(".rule h2").first()).toBeVisible({ timeout: 20_000 });
    await canvas.locator("#trap").click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { __posterPwned?: boolean }).__posterPwned)).toBeUndefined();
    await expect.poll(() => refused.some((entry) => entry.startsWith("https://example.com/leak.png"))).toBe(true);
    // ARemoteImageIsNotFetched: exporting draws the page too, and still fetches nothing.
    const download = page.waitForEvent("download", { timeout: 30_000 });
    await editor.locator('button[data-action="word"]').click();
    await download;
    expect(answered).toEqual([]);
    console.log("refused:", refused.filter((entry) => entry.includes("example.com")));
    // The editor page carries the policy that holds its canvas.
    const policy = await page.evaluate(async (url) => (await (await fetch(url)).text()).match(/Content-Security-Policy"\s+content="([^"]+)"/)?.[1], `${server}/poster-editor.html`);
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("connect-src 'none'");
  } finally {
    await fs.writeFile(file, original);
  }
});

// openlore: scenario=ASaveInFlightDoesNotLandElsewhere spec=poster-files
test("ASaveInFlightDoesNotLandElsewhere: leaving for another file mid-save writes the poster only, and nothing breaks", async ({ page }) => {
  const root = process.env.PI_E2E_PRIMARY_PROJECT!;
  const file = path.join(root, POSTER);
  const original = await fs.readFile(file, "utf8");
  const other = path.join(root, "diagrams", "two-pages.drawio");
  const otherBefore = await fs.readFile(other, "utf8");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    const editor = await openPoster(page);
    const canvas = editor.frameLocator("iframe.gjs-frame");
    const title = canvas.locator(".rule.c1 h2");
    await expect(title).toHaveText("I raise my hand", { timeout: 20_000 });
    await title.click();
    await title.dblclick();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("Saved while leaving");
    await canvas.locator(".motto").click();
    await editor.locator('button[data-action="save"]').click();
    // Straight away, before the answer.
    await page.getByText("diagrams", { exact: true }).click();
    await page.getByText("two-pages.drawio", { exact: true }).click();
    await expect(page.getByTestId("drawio-frame")).toBeVisible();
    await expect(page.getByTestId("poster-frame")).toHaveCount(0);
    await expect.poll(async () => readPage(await fs.readFile(file, "utf8")).html).toContain("Saved while leaving");
    expect(await fs.readFile(other, "utf8")).toBe(otherBefore);
    expect(errors).toEqual([]);
  } finally {
    await fs.writeFile(file, original);
  }
});

// openlore: scenario=APosterOpensAndPrintsInABrowser spec=poster-documents
test("APosterOpensAndPrintsInABrowser: the poster file, opened as a page and printed, is one A4 portrait page in colour", async ({ browser }) => {
  const file = path.join(process.env.PI_E2E_PRIMARY_PROJECT!, POSTER);
  const tab = await browser.newPage();
  await tab.goto(pathToFileURL(file).href);
  await expect(tab.locator(".banner h1")).toHaveText("Our class rules");
  // The banner's colour survives printing.
  await tab.emulateMedia({ media: "print" });
  expect(await tab.locator(".banner").evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(63, 81, 181)");
  const pdf = (await tab.pdf({ preferCSSPageSize: true, printBackground: true })).toString("latin1");
  const pages = [...pdf.matchAll(/\/Type\s*\/Page[^s]/g)].length;
  const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf);
  expect(pages).toBe(1);
  // A4 in points: 595 x 842.
  expect(Math.round(Number(box![1]))).toBe(595);
  expect(Math.round(Number(box![2]))).toBe(842);
  await tab.close();
});
