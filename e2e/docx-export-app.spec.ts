/**
 * The export as somebody actually uses it, and then abused.
 *
 * The happy path is the sequence the code was written against, so it is the one
 * least likely to be broken. What follows the first test is a deliberate attempt
 * to break the feature at its transitions — a second click before the first
 * finishes, the context changing underneath a running export, the viewer closing
 * while one is in flight. Those are where the defects in this repository's history
 * have actually lived.
 */
import { expect, test, type Page } from "@playwright/test";

/** Open the workspace file that every one of these tests works from. */
async function openReadme(page: Page) {
  await page.goto(process.env.PI_E2E_SERVER_URL!);
  await expect(page.getByTitle("connected")).toBeVisible();
  await page.getByTitle("Show files").click();
  await page.getByText("readme.md").click();
  await expect(page.getByRole("button", { name: /download as a word document/i })).toBeVisible();
}

/** Console errors are collected for every test: a silent unmount says nothing else. */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  return errors;
}

/** The viewer is still there and still showing this file. */
async function viewerAlive(page: Page) {
  await expect(page.getByRole("button", { name: /download as a word document/i })).toBeVisible();
}

test("exports the open file, and hands over a .docx named after it", async ({ page }) => {
  const errors = watchConsole(page);
  await openReadme(page);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /download as a word document/i }).click();
  const file = await download;

  expect(file.suggestedFilename()).toBe("readme.docx");
  // Not merely a file: a real package. The zip's local file header, then the part
  // every word-processing document must carry.
  const path = await file.path();
  const { readFile } = await import("node:fs/promises");
  const bytes = await readFile(path);
  expect([...bytes.subarray(0, 2)]).toEqual([0x50, 0x4b]);
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  expect(zip.file("word/document.xml")).not.toBeNull();

  expect(errors).toEqual([]);
});

test("a double click produces one download, not two", async ({ page }) => {
  // Two exports of one document is two files in the reader's downloads folder for
  // one intention — and they race for mermaid's global configuration on the way.
  const errors = watchConsole(page);
  await openReadme(page);

  const downloads: unknown[] = [];
  page.on("download", (download) => downloads.push(download));

  const button = page.getByRole("button", { name: /download as a word document/i });
  await button.click({ clickCount: 2, delay: 10 });
  await button.click({ force: true }).catch(() => {});

  await page.waitForTimeout(3000);
  expect(downloads).toHaveLength(1);
  expect(errors).toEqual([]);
  await viewerAlive(page);
});

test("survives the view mode being changed while an export is running", async ({ page }) => {
  const errors = watchConsole(page);
  await openReadme(page);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /download as a word document/i }).click();
  // Straight into a burst of mode switches, before the export can have finished.
  for (const mode of [/source/, /rendered/, /source/, /rendered/]) {
    await page.getByRole("button", { name: mode }).click();
  }

  // The export still lands, and it is the document rather than the view.
  expect((await download).suggestedFilename()).toBe("readme.docx");
  expect(errors).toEqual([]);
  await viewerAlive(page);
});

test("survives the viewer being closed while an export is running", async ({ page }) => {
  // A handler holding a component that has gone is the shape of the PdfViewer
  // regression: the whole application unmounted and the user saw a blank page.
  const errors = watchConsole(page);
  await openReadme(page);

  await page.getByRole("button", { name: /download as a word document/i }).click();
  await page.getByRole("button", { name: /close file viewer/i }).click();
  await page.waitForTimeout(2500);

  // The application is still there and still usable.
  await expect(page.getByRole("textbox", { name: /message pi/i })).toBeVisible();
  expect(errors).toEqual([]);
});

test("survives the project changing under a running export", async ({ page }) => {
  // A reply answering a question that has since changed is the failure shape here:
  // the export must not hand over the previous project's file under the new one.
  const errors = watchConsole(page);
  await openReadme(page);

  await page.getByRole("button", { name: /download as a word document/i }).click();
  await page.getByTitle(/^Project:/).click();
  await page.getByRole("menuitem").filter({ hasText: process.env.PI_E2E_SECOND_PROJECT! }).click();
  await page.waitForTimeout(2500);

  await expect(page.getByRole("textbox", { name: /message pi/i })).toBeVisible();
  expect(errors).toEqual([]);
});

test("offers the export for a file it cannot render, and not for the diff view", async ({ page }) => {
  const errors = watchConsole(page);
  await openReadme(page);

  // Editing then exporting: the draft is what the reader sees, so the draft is
  // what must travel — asserted here through the running app rather than a mock.
  await page.getByRole("button", { name: /edit/ }).click();
  const editor = page.getByRole("textbox").first();
  await editor.fill("# Edited in the browser\n\nA new body.\n");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /download as a word document/i }).click();
  const file = await download;

  const JSZip = (await import("jszip")).default;
  const { readFile } = await import("node:fs/promises");
  const zip = await JSZip.loadAsync(await readFile(await file.path()));
  const xml = await zip.file("word/document.xml")!.async("string");
  expect(xml).toContain("Edited in the browser");

  // Nothing was saved on the way: the editor still holds an unsaved draft.
  await expect(page.getByRole("button", { name: /^save$/ })).toBeVisible();
  expect(errors).toEqual([]);
});
