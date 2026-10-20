/**
 * A draw.io file in the file viewer, as somebody opens it: drawn by draw.io's own viewer,
 * every page reachable, nothing fetched from anywhere — checked in a real browser, since
 * the viewer, its sandbox and its Content-Security-Policy only meet there.
 */
import { expect, test, type Frame, type Page } from "@playwright/test";

async function openDiagram(page: Page, name: string): Promise<Frame> {
  await page.goto(process.env.PI_E2E_SERVER_URL!);
  await expect(page.getByTitle("connected")).toBeVisible();
  await page.getByTitle("Show files").click();
  await page.getByText("diagrams", { exact: true }).click();
  await page.getByText(name, { exact: true }).click();
  await expect(page.getByTestId("drawio-frame")).toBeVisible();
  const frame = await (await page.getByTestId("drawio-frame").elementHandle())!.contentFrame();
  return frame!;
}

/** The labels drawn, once each. */
async function labels(frame: Frame): Promise<string[]> {
  return frame.evaluate(() => [...new Set([...document.querySelectorAll("svg foreignObject div div div, svg text")].map((node) => node.textContent?.trim() ?? "").filter(Boolean))]);
}

// openlore: scenario=ADrawioFileIsDrawn spec=drawio-diagrams
test("ADrawioFileIsDrawn: a file draw.io wrote is drawn, compressed page and all, the source one click away", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const frame = await openDiagram(page, "flow.drawio");
  await expect(page.getByRole("button", { name: /rendered/ })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => labels(frame)).toEqual(expect.arrayContaining(["Lamp doesn't work", "Plug in lamp", "Replace Bulb", "Repair Lamp"]));
  await page.getByRole("button", { name: /source/ }).click();
  await expect(page.getByTestId("drawio-frame")).toHaveCount(0);
  await expect(page.getByText("<mxfile", { exact: false })).toBeVisible();
  expect(errors).toEqual([]);
});

// openlore: scenario=EveryPageIsReachable spec=drawio-diagrams
test("EveryPageIsReachable: the viewer's own toolbar moves to the second page", async ({ page }) => {
  const frame = await openDiagram(page, "two-pages.drawio");
  await expect.poll(() => labels(frame)).toEqual(["Client", "API gateway"]);
  await frame.locator('[title="Next Page"]').click();
  await expect.poll(() => labels(frame)).toEqual(["Remote image", "Remote font"]);
});

// openlore: scenario=TheViewerNeverReachesTheNetwork spec=drawio-diagrams
test("TheViewerNeverReachesTheNetwork: remote image and font refused, opaque origin, nothing of the app reachable", async ({ page }) => {
  const server = new URL(process.env.PI_E2E_SERVER_URL!).origin;
  const answered: string[] = [];
  const refused: string[] = [];
  page.on("response", (response) => {
    if (!response.url().startsWith(server) && !/^(data|blob):/.test(response.url())) answered.push(response.url());
  });
  page.on("requestfailed", (request) => refused.push(request.url()));
  const frame = await openDiagram(page, "two-pages.drawio");
  await expect.poll(() => labels(frame)).toContain("Client");
  await frame.locator('[title="Next Page"]').click();
  await expect.poll(() => labels(frame)).toContain("Remote image");
  await expect.poll(() => refused.some((url) => url.startsWith("https://example.com/"))).toBe(true);
  expect(answered).toEqual([]);
  const seen = await frame.evaluate(() => {
    const report: Record<string, string> = { origin: String(window.origin) };
    try {
      report.parentDocument = String(Boolean(parent.document.body));
    } catch {
      report.parentDocument = "blocked";
    }
    try {
      report.storage = String(localStorage.length);
    } catch {
      report.storage = "blocked";
    }
    return report;
  });
  expect(seen).toEqual({ origin: "null", parentDocument: "blocked", storage: "blocked" });
});

// openlore: scenario=AnUnreadableDiagramSaysWhy spec=drawio-diagrams
test("AnUnreadableDiagramSaysWhy: the reason and the source, not an empty frame", async ({ page }) => {
  await openDiagram(page, "broken.drawio");
  await expect(page.getByTestId("drawio-failure")).toHaveText(/not a draw\.io diagram: its root is <html>/);
  await expect(page.getByText("not a diagram", { exact: false })).toBeVisible();
});

// openlore: scenario=TheDraftIsDrawnBesideIt spec=drawio-diagrams
test("TheDraftIsDrawnBesideIt: typing beside the drawing redraws it, in the same frame", async ({ page }) => {
  await openDiagram(page, "two-pages.drawio");
  await page.getByRole("button", { name: /split/ }).click();
  const frameElement = page.getByTestId("file-split-rendering").getByTestId("drawio-frame");
  await expect(frameElement).toBeVisible();
  const frame = (await (await frameElement.elementHandle())!.contentFrame())!;
  await expect.poll(() => labels(frame)).toContain("API gateway");
  const before = await frameElement.elementHandle();
  const editor = page.getByTestId("file-split").getByTestId("file-editor").locator(".cm-content");
  const source = (await editor.locator(".cm-line").allTextContents()).join("\n");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(source.replace("API gateway", "Edge proxy"));
  await expect.poll(() => labels(frame)).toContain("Edge proxy");
  expect(await page.evaluate(([element]) => element === document.querySelector('[data-testid="file-split-rendering"] [data-testid="drawio-frame"]'), [before])).toBe(true);
});
