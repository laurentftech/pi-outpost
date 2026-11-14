import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DRAWIO_MARKDOWN, DRAWIO_MARKDOWN_PATH, SERVICES_DIAGRAM, SERVICES_DIAGRAM_PATH } from "./fixtures/drawio-conversation";

const file = (relative: string) => path.join(process.env.PI_E2E_DRAWIO_CHAT_ROOT!, relative);

test.describe.configure({ mode: "serial" });
test.beforeEach(async () => {
  await writeFile(file(SERVICES_DIAGRAM_PATH), SERVICES_DIAGRAM);
  await writeFile(file(DRAWIO_MARKDOWN_PATH), DRAWIO_MARKDOWN);
});

async function openReport(page: Page) {
  await page.goto(process.env.PI_E2E_DRAWIO_CHAT_URL!);
  await expect(page.getByTitle("connected")).toBeVisible();
  await page.getByTitle("Show files").click();
  await page.getByText("diagrams", { exact: true }).click();
  await page.getByText("report.md", { exact: true }).dblclick(); // a file row opens on double-click
  await expect(page.getByRole("heading", { name: "Structure" })).toBeVisible();
  return page.locator(".prose-chat").filter({ has: page.getByRole("heading", { name: "Structure" }) });
}

async function labels(element: Locator) {
  const frame = (await (await element.elementHandle())!.contentFrame())!;
  return frame.evaluate(() => [...document.querySelectorAll("svg foreignObject div, svg text")]
    .filter((node) => node.querySelector("div") === null)
    .map((node) => node.textContent?.trim()).filter(Boolean));
}

// openlore: scenario=AReferencedDiagramIsDrawnInMarkdown spec=drawio-diagrams
// openlore: scenario=MarkdownDiagramsStayMounted spec=drawio-diagrams
// openlore: scenario=EnlargeShowsTheDiagramAtFullSize spec=drawio-diagrams
// openlore: scenario=DownloadSvgSavesThePageShown spec=drawio-diagrams
test("a sibling diagram is drawn in Markdown and keeps its frame through find, prose updates and a diagram saved elsewhere", async ({ page }) => {
  const errors: string[] = [];
  const images: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("request", (request) => { if (request.resourceType() === "image") images.push(request.url()); });
  const report = await openReport(page);
  const frame = report.getByTestId("drawio-frame");
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  await expect.poll(() => labels(frame)).toEqual(expect.arrayContaining(["Alpha", "Bravo", "Charlie"]));
  expect(await frame.evaluate((element) => element.closest("p"))).toBeNull();
  await expect(report.getByRole("button", { name: "Show diagram at full size" })).toBeVisible();
  const original = await frame.elementHandle();
  const logo = report.getByRole("img", { name: "logo" });
  await expect.poll(() => logo.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(80);
  const originalLogo = await logo.elementHandle();

  // Each keystroke updates the viewer. Neither a frame nor an ordinary image may remount.
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("ControlOrMeta+f");
    await page.getByRole("textbox", { name: "Find", exact: true }).fill(i % 2 ? "services" : "Structure");
    await page.keyboard.press("Escape");
  }
  await writeFile(file(DRAWIO_MARKDOWN_PATH), DRAWIO_MARKDOWN.replace("The services.", "The updated services."));
  await expect(report).toContainText("The updated services.");
  expect(await frame.evaluate((element, before) => element === before, original)).toBe(true);
  expect(await logo.evaluate((element, before) => element === before, originalLogo)).toBe(true);
  expect(images.filter((url) => url.includes("path=diagrams%2Flogo.svg"))).toHaveLength(1);
  expect(images.some((url) => /\.drawio(?:&|$)/i.test(url))).toBe(false);

  await writeFile(file(SERVICES_DIAGRAM_PATH), SERVICES_DIAGRAM.replace("Alpha", "Updated Alpha"));
  await expect.poll(() => labels(frame)).toContain("Updated Alpha");
  expect(await frame.evaluate((element, before) => element === before, original)).toBe(true);

  await report.getByRole("button", { name: "Show diagram at full size" }).click();
  const enlarged = page.getByTestId("drawio-enlarged");
  await expect.poll(() => labels(enlarged.getByTestId("drawio-frame"))).toContain("Updated Alpha");
  const download = page.waitForEvent("download");
  await enlarged.getByRole("button", { name: "⤓ download SVG" }).click();
  const svg = await download;
  expect(svg.suggestedFilename()).toBe("services-Services.svg");
  expect(await readFile((await svg.path())!, "utf8")).toContain("Updated Alpha");
  await page.keyboard.press("Escape");
  await expect(enlarged).toHaveCount(0);
  expect(await frame.evaluate((element, before) => element === before, original)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: test.info().outputPath("markdown-drawio.png"), fullPage: true });
  await report.getByRole("button", { name: "↗ open" }).click();
  await expect(page.getByTestId("file-drawio")).toBeVisible();
  await expect.poll(() => labels(page.getByTestId("file-drawio").getByTestId("drawio-frame"))).toContain("Updated Alpha");
});

// openlore: scenario=AMissingMarkdownDiagramSaysSo spec=drawio-diagrams
test("a missing, deleted or malformed diagram explains itself and recovers when its file is repaired", async ({ page }) => {
  const missing = "diagrams/temporary.drawio";
  await rm(file(missing), { force: true });
  await writeFile(file(DRAWIO_MARKDOWN_PATH), "# Structure\n\n![structure](temporary.drawio)\n");
  const report = await openReport(page);
  await expect(report.getByTestId("drawio-block-missing")).toContainText(missing);
  await expect(report.locator("img, iframe")).toHaveCount(0);

  await writeFile(file(missing), SERVICES_DIAGRAM);
  const frame = report.getByTestId("drawio-frame");
  await expect(frame).toBeVisible();
  await expect.poll(() => labels(frame)).toContain("Alpha");
  await writeFile(file(missing), "<html>not a diagram</html>");
  await expect(report.getByTestId("drawio-failure")).toContainText("not a draw.io diagram");
  await writeFile(file(missing), SERVICES_DIAGRAM.replace("Alpha", "Repaired"));
  await expect.poll(() => labels(frame)).toContain("Repaired");
  await expect(report.getByTestId("drawio-failure")).toHaveCount(0);
  await rm(file(missing));
  await expect(report.getByTestId("drawio-block-missing")).toContainText(missing);
  await expect(report.locator("img, iframe")).toHaveCount(0);
});

// openlore: scenario=MarkdownDiagramReferencesFollowDraft spec=drawio-diagrams
test("the split preview follows a changed, encoded .dio reference and survives rapid mode changes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const report = await openReport(page);
  await page.getByRole("button", { name: /split/ }).click();
  const preview = page.getByTestId("file-split-rendering");
  const frame = preview.getByTestId("drawio-frame");
  await expect.poll(() => labels(frame)).toContain("Alpha");
  const editor = page.getByTestId("file-split").getByTestId("file-editor").locator(".cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(DRAWIO_MARKDOWN.replace("services.drawio", "alternate%20plan.DIO"));
  await expect(frame).toHaveAttribute("title", "diagrams/alternate plan.DIO");
  await expect.poll(() => labels(frame)).toContain("Alternate");
  expect(await labels(frame)).not.toContain("Alpha");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /rendered/ }).click();
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: /source/ }).click();
    await page.getByRole("button", { name: /rendered/ }).click();
  }
  await expect.poll(() => labels(report.getByTestId("drawio-frame"))).toContain("Alpha");
  expect(errors).toEqual([]);
});
