/**
 * An HTML file in the file viewer, as somebody opens it: rendered with nothing to choose,
 * its relative stylesheet, picture and script in place, its links working — and a page
 * that cannot reach the application, checked from inside the page itself.
 */
import { expect, test, type Page } from "@playwright/test";

async function openPage(page: Page) {
  await page.goto(process.env.PI_E2E_SERVER_URL!);
  await expect(page.getByTitle("connected")).toBeVisible();
  await page.getByTitle("Show files").click();
  await page.getByText("site", { exact: true }).click();
  await page.getByText("index.html", { exact: true }).click();
  await expect(page.getByTestId("html-page")).toBeVisible();
  return page.frameLocator('[data-testid="html-page"]');
}

function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  return errors;
}

// openlore: scenario=AnHtmlReportOpensRendered spec=file
test("AnHtmlReportOpensRendered: rendered with no choice asked, stylesheet, picture and script in place", async ({ page }) => {
  const errors = watchConsole(page);
  const frame = await openPage(page);
  await expect(page.getByRole("button", { name: /rendered/ })).toHaveAttribute("aria-pressed", "true");
  await expect(frame.locator("#title")).toHaveText("HTML report");
  await expect(frame.locator("#title")).toHaveCSS("color", "rgb(1, 2, 3)");
  await expect(frame.locator("#written")).toHaveText("script ran");
  await expect.poll(() => frame.locator("#logo").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth)).toBe(40);
  // The source is one click away, as for Markdown.
  await page.getByRole("button", { name: /source/ }).click();
  await expect(page.getByTestId("html-page")).toHaveCount(0);
  await expect(page.getByText('<h1 id="title">HTML report</h1>', { exact: false })).toBeVisible();
  expect(errors).toEqual([]);
});

// openlore: scenario=ThePageCannotReachTheApplication spec=file
test("ThePageCannotReachTheApplication: opaque origin, no document, storage or cookie of the app, no token in the page", async ({ page }) => {
  const frame = await openPage(page);
  const seen = JSON.parse((await frame.locator("#probe").textContent()) ?? "{}");
  expect(seen).toEqual({ parentDocument: "blocked", storage: "blocked", cookie: "blocked", origin: "null" });
  const srcdoc = (await page.getByTestId("html-page").getAttribute("srcdoc")) ?? "";
  expect(srcdoc).not.toMatch(/files\/raw|token=/);
  expect(await page.getByTestId("html-page").getAttribute("sandbox")).toBe("allow-scripts allow-popups allow-popups-to-escape-sandbox");
});

// openlore: scenario=ARelativeLinkOpensInTheViewer spec=file
test("ARelativeLinkOpensInTheViewer: a forged message opens nothing, the page's own link opens the file", async ({ page }) => {
  const frame = await openPage(page);
  // The same message, posted by the application's own window rather than the frame.
  await page.evaluate(() => window.postMessage({ type: "pi-outpost:open", href: "notes.md" }, "*"));
  await page.waitForTimeout(500);
  await expect(page.getByTestId("html-page")).toBeVisible();
  // An anchor stays in the page: a srcdoc page's fragment would otherwise resolve against
  // the application's address and navigate the frame away, leaving it blank.
  await frame.locator("#anchor").click();
  await page.waitForTimeout(500);
  await expect(frame.locator("#title")).toHaveText("HTML report");
  await frame.locator("#relative").click();
  await expect(page.getByRole("heading", { name: "Site notes" })).toBeVisible();
  await expect(page.getByTestId("html-page")).toHaveCount(0);
});

// openlore: scenario=HtmlIsEditedBesideItsRendering spec=file
test("HtmlIsEditedBesideItsRendering: the rendering follows the draft", async ({ page }) => {
  await openPage(page);
  await page.getByRole("button", { name: /split/ }).click();
  const editor = page.getByTestId("file-split").locator("textarea");
  await expect(editor).toBeVisible();
  await editor.fill((await editor.inputValue()).replace("HTML report", "Edited report"));
  const frame = page.frameLocator('[data-testid="file-split-rendering"] [data-testid="html-page"]');
  await expect(frame.locator("#title")).toHaveText("Edited report");
  await expect(frame.locator("#title")).toHaveCSS("color", "rgb(1, 2, 3)");
  // Leaving without saving keeps the file as it was.
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /rendered/ }).click();
  await expect(page.frameLocator('[data-testid="html-page"]').locator("#title")).toHaveText("HTML report");
});
