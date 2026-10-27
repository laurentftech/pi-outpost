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
import { readAllZipEntries } from "@pi-outpost/office/zip.ts";
import { pageOf, readPage } from "@pi-outpost/posters/format";

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
// openlore: scenario=SaveIsAvailableOnlyForUnsavedChanges spec=openwebui-embed-theme
test("APosterFileOpensInTheEditor and TouchUpsReachTheAgent: drawn in the editor, a correction saved reaches the file", async ({ page }) => {
  const file = path.join(process.env.PI_E2E_PRIMARY_PROJECT!, POSTER);
  const original = await fs.readFile(file, "utf8");
  try {
    const editor = await openPoster(page);
    const canvas = editor.frameLocator("iframe.gjs-frame");
    const title = canvas.locator(".rule.c1 h2");
    await expect(title).toHaveText("I raise my hand", { timeout: 20_000 });
    await expect(editor.locator('button[data-action="style"]')).toHaveText("Format");
    const save = editor.locator('button[data-action="save"]');
    await expect(save).toBeDisabled();
    await expect(page.getByRole("group", { name: "How to show this document" })).not.toContainText("split");
    await title.click();
    await title.dblclick();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("I raise my hand and wait");
    await canvas.locator(".motto").click();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(editor.locator(".poster-status")).toHaveText(/Saved/);
    await expect(save).toBeDisabled();
    await expect.poll(async () => readPage(await fs.readFile(file, "utf8")).html).toContain("I raise my hand and wait");
  } finally {
    await fs.writeFile(file, original);
  }
});

/** The poster file with its first card's title replaced, as the agent would write it. */
function withTitle(page: string, title: string): string {
  return page.replace("I raise my hand", title);
}

/** Marks the editor's canvas frame: reopening the poster replaces it, and the mark with it. */
async function markCanvas(editor: FrameLocator) {
  await editor.locator("iframe.gjs-frame").evaluate((frame) => frame.setAttribute("data-e2e-mark", "kept"));
}

// openlore: scenario=AnAgentRewriteIsShown spec=poster-files
test("AnAgentRewriteIsShown: the agent's new version replaces the one on screen, and saving over it works", async ({ page }) => {
  const file = path.join(process.env.PI_E2E_PRIMARY_PROJECT!, POSTER);
  const original = await fs.readFile(file, "utf8");
  try {
    const editor = await openPoster(page);
    const canvas = editor.frameLocator("iframe.gjs-frame");
    await expect(canvas.locator(".rule.c1 h2")).toHaveText("I raise my hand", { timeout: 20_000 });
    await fs.writeFile(file, withTitle(original, "I raise my hand, said the agent"));
    await expect(canvas.locator(".rule.c1 h2")).toHaveText("I raise my hand, said the agent", { timeout: 15_000 });
    // A save is checked against the version shown, the agent's: it is not refused.
    const title = canvas.locator(".rule.c1 h2");
    await title.click();
    await title.dblclick();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("I raise my hand, and so do you");
    await canvas.locator(".motto").click();
    await editor.locator('button[data-action="save"]').click();
    await expect(editor.locator(".poster-status")).toHaveText(/Saved/);
    await expect.poll(async () => readPage(await fs.readFile(file, "utf8")).html).toContain("I raise my hand, and so do you");
  } finally {
    await fs.writeFile(file, original);
  }
});

// openlore: scenario=UnsavedTouchUpsAreKeptOverARewrite spec=poster-files
test("UnsavedTouchUpsAreKeptOverARewrite: a rewrite leaves unsaved touch-ups alone, refuses their save, and shows once they are discarded", async ({ page }) => {
  const file = path.join(process.env.PI_E2E_PRIMARY_PROJECT!, POSTER);
  const original = await fs.readFile(file, "utf8");
  try {
    const editor = await openPoster(page);
    const canvas = editor.frameLocator("iframe.gjs-frame");
    const title = canvas.locator(".rule.c1 h2");
    await expect(title).toHaveText("I raise my hand", { timeout: 20_000 });
    await title.click();
    await title.dblclick();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("Mine, not saved");
    await canvas.locator(".motto").click();
    await expect(editor.locator('button[data-action="save"]')).toBeEnabled();
    await markCanvas(editor);
    await fs.writeFile(file, withTitle(original, "The agent's title"));
    // Long enough for the viewer to read the new version; the touch-up is still there.
    await page.waitForTimeout(3000);
    await expect(title).toHaveText("Mine, not saved");
    await expect(editor.locator("iframe.gjs-frame")).toHaveAttribute("data-e2e-mark", "kept");
    // Saving them would overwrite the agent's version: refused, and the file is the agent's.
    await editor.locator('button[data-action="save"]').click();
    await expect(editor.locator(".poster-status")).toContainText("changed on disk");
    expect(readPage(await fs.readFile(file, "utf8")).html).toContain("The agent's title");
    // Discarded, the touch-ups are gone: the agent's version is shown.
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: /source/ }).click();
    await page.getByRole("button", { name: /rendered/ }).click();
    await expect(page.frameLocator('[data-testid="poster-frame"]').frameLocator("iframe.gjs-frame").locator(".rule.c1 h2")).toHaveText("The agent's title", { timeout: 20_000 });
  } finally {
    await fs.writeFile(file, original);
  }
});

// openlore: scenario=OwnSaveDoesNotReopen spec=poster-files
test("OwnSaveDoesNotReopen: after a save the editor keeps its page, never the version from before it", async ({ page }) => {
  const file = path.join(process.env.PI_E2E_PRIMARY_PROJECT!, POSTER);
  const original = await fs.readFile(file, "utf8");
  try {
    const editor = await openPoster(page);
    const canvas = editor.frameLocator("iframe.gjs-frame");
    const title = canvas.locator(".rule.c1 h2");
    await expect(title).toHaveText("I raise my hand", { timeout: 20_000 });
    await title.click();
    await title.dblclick();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("Saved by me");
    await canvas.locator(".motto").click();
    await markCanvas(editor);
    await editor.locator('button[data-action="save"]').click();
    await expect(editor.locator(".poster-status")).toHaveText(/Saved/);
    await expect.poll(async () => readPage(await fs.readFile(file, "utf8")).html).toContain("Saved by me");
    // The viewer reads the file back after the save; the editor is not reopened over it.
    await page.waitForTimeout(3000);
    await expect(editor.locator("iframe.gjs-frame")).toHaveAttribute("data-e2e-mark", "kept");
    await expect(title).toHaveText("Saved by me");
  } finally {
    await fs.writeFile(file, original);
  }
});

/** Writes a poster beside the guide's example and returns its path in the project; removed by the caller. */
async function writePoster(name: string, html: string, css: string): Promise<string> {
  const file = path.join(process.env.PI_E2E_PRIMARY_PROJECT!, "posters", name);
  await fs.writeFile(file, pageOf(name.replace(/\.poster\.html$/, ""), { html, css, format: "A4-portrait" }));
  return file;
}

/** The SVG a picture in the canvas holds, decoded, or null for an empty frame. */
async function svgOf(editor: FrameLocator, selector: string): Promise<string | null> {
  return editor.frameLocator("iframe.gjs-frame").locator(selector).evaluate((image: HTMLImageElement) => {
    const source = image.getAttribute("src") ?? "";
    if (!source.startsWith("data:image/svg+xml;base64,")) return null;
    return new TextDecoder().decode(Uint8Array.from(atob(source.split(",")[1]!), (c) => c.charCodeAt(0)));
  });
}

const DIAGRAM_CSS = ".sheet { position: relative; width: 100%; height: 100%; background: #fff; } img { position: absolute; display: block; } .d1 { left: 40px; top: 200px; width: 500px; height: 150px; } .d2 { left: 40px; top: 420px; width: 500px; height: 150px; } .d3 { left: 40px; top: 640px; width: 200px; height: 100px; }";

// openlore: scenario=AnAgentsFrameIsFilledOnOpen spec=poster-files
// openlore: scenario=TheNamedPageIsDrawn spec=poster-files
// openlore: scenario=ADiagramSurvivesTheExport spec=poster-files
test("AnAgentsFrameIsFilledOnOpen, TheNamedPageIsDrawn and ADiagramSurvivesTheExport: the frames are drawn on open, saved, and printed", async ({ page }) => {
  const file = await writePoster(
    "Diagrams.poster.html",
    '<div class="sheet"><h1>Diagrams</h1>' +
      '<img class="d1" data-poster-picture="context" data-drawio="../diagrams/two-pages.drawio" data-drawio-page="Context" alt="">' +
      '<img class="d2" data-poster-picture="remote" data-drawio="../diagrams/two-pages.drawio" data-drawio-page="2" alt=""></div>',
    DIAGRAM_CSS,
  );
  try {
    const editor = await openPoster(page, "Diagrams.poster.html");
    await expect.poll(() => svgOf(editor, ".d1"), { timeout: 40_000 }).toContain("API gateway");
    const context = (await svgOf(editor, ".d1"))!;
    expect(context).toContain("Client");
    expect(context).not.toContain("Remote image");
    await expect.poll(() => svgOf(editor, ".d2"), { timeout: 40_000 }).toContain("Remote image");
    expect(await svgOf(editor, ".d2")).not.toContain("API gateway");
    // The picture decodes and draws in the canvas.
    expect(await editor.frameLocator("iframe.gjs-frame").locator(".d1").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await expect(editor.locator(".poster-status")).toContainText("draw.io diagrams are in their frames");
    const save = editor.locator('button[data-action="save"]');
    await expect(save).toBeEnabled();

    // The page picture the Word export carries shows the diagram where its frame is.
    const download = page.waitForEvent("download", { timeout: 30_000 });
    await editor.locator('button[data-action="word"]').click();
    const docx = await fs.readFile((await (await download).path())!);
    const png = readAllZipEntries(docx, { maxEntries: 50, maxInflatedBytes: 60_000_000, maxTotalBytes: 100_000_000 }).get("word/media/poster.png")!;
    const inked = await page.evaluate(async (base64) => {
      const image = new Image();
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = `data:image/png;base64,${base64}`; });
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const scale = image.naturalWidth / 794;
      const dark = (left: number, top: number, width: number, height: number) => {
        const data = context.getImageData(Math.round(left * scale), Math.round(top * scale), Math.round(width * scale), Math.round(height * scale)).data;
        let count = 0;
        for (let index = 0; index < data.length; index += 4) if (data[index]! < 100 && data[index + 1]! < 100 && data[index + 2]! < 100) count += 1;
        return count;
      };
      // The first frame, and the same area below every frame, which is blank.
      return { frame: dark(40, 200, 500, 150), blank: dark(40, 900, 500, 150) };
    }, png.toString("base64"));
    expect(inked.frame).toBeGreaterThan(500);
    expect(inked.blank).toBe(0);

    await save.click();
    await expect(editor.locator(".poster-status")).toHaveText(/Saved/);
    const saved = readPage(await fs.readFile(file, "utf8")).html;
    expect(saved).toMatch(/data-drawio="\.\.\/diagrams\/two-pages\.drawio"/);
    expect(saved.match(/src="data:image\/svg\+xml;base64,/g)).toHaveLength(2);
  } finally {
    await fs.rm(file, { force: true });
  }
});

// openlore: scenario=AFilledFrameIsLeftAlone spec=poster-files
test("AFilledFrameIsLeftAlone: a frame naming a diagram but holding a picture is not redrawn", async ({ page }) => {
  const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const file = await writePoster("Filled.poster.html", `<div class="sheet"><img class="d1" data-poster-picture="mine" data-drawio="../diagrams/two-pages.drawio" src="${PIXEL}" alt=""></div>`, DIAGRAM_CSS);
  try {
    const editor = await openPoster(page, "Filled.poster.html");
    const frame = editor.frameLocator("iframe.gjs-frame").locator(".d1");
    await expect(frame).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(4000);
    expect(await frame.getAttribute("src")).toBe(PIXEL);
    await expect(editor.locator('button[data-action="save"]')).toBeDisabled();
    await expect(page.getByTestId("drawio-painter")).toHaveCount(0);
  } finally {
    await fs.rm(file, { force: true });
  }
});

// openlore: scenario=AMissingDiagramLeavesTheFrameEmpty spec=poster-files
test("AMissingDiagramLeavesTheFrameEmpty: frames naming a missing or broken diagram stay empty and are named", async ({ page }) => {
  const file = await writePoster(
    "Missing.poster.html",
    '<div class="sheet"><img class="d1" data-poster-picture="gone" data-drawio="../diagrams/missing.drawio" alt="">' +
      '<img class="d2" data-poster-picture="broken" data-drawio="../diagrams/broken.drawio" alt="">' +
      '<img class="d3" data-poster-picture="ok" data-drawio="/diagrams/two-pages.drawio" alt=""></div>',
    DIAGRAM_CSS,
  );
  try {
    const editor = await openPoster(page, "Missing.poster.html");
    const status = editor.locator(".poster-status");
    await expect(status).toContainText("1 diagram drawn", { timeout: 40_000 });
    await expect(status).toContainText("../diagrams/missing.drawio: \"../diagrams/missing.drawio\" could not be read");
    await expect(status).toContainText("../diagrams/broken.drawio: it is not a draw.io diagram");
    // Empty: GrapesJS's placeholder (itself an SVG, the same in both), no diagram in it.
    const [gone, broken] = [await svgOf(editor, ".d1"), await svgOf(editor, ".d2")];
    expect(gone).toBe(broken);
    expect(gone ?? "").not.toMatch(/foreignObject|<text/);
    // A reference from the project root is drawn.
    expect(await svgOf(editor, ".d3")).toContain("Client");
    // Saved, the frames that failed are still empty in the file.
    await editor.locator('button[data-action="save"]').click();
    await expect(editor.locator(".poster-status")).toHaveText(/Saved/);
    const saved = readPage(await fs.readFile(file, "utf8")).html;
    const frame = (name: string) => new RegExp(`<img [^>]*data-poster-picture="${name}"[^>]*>`).exec(saved)?.[0] ?? "";
    expect(frame("gone")).not.toContain("src=");
    expect(frame("broken")).not.toContain("src=");
    expect(frame("ok")).toContain('src="data:image/svg+xml;base64,');
  } finally {
    await fs.rm(file, { force: true });
  }
});

// openlore: scenario=TheProjectsDiagramsAreOffered spec=poster-files
// openlore: scenario=ADiagramGoesOntoThePage spec=poster-files
// openlore: scenario=ADiagramGoesIntoTheSelectedFrame spec=poster-files
// openlore: scenario=AnUnreadableDiagramSaysWhy spec=poster-files
test("Insert → draw.io diagram: offered with their pages, onto the page, into the selected frame, and a broken one said", async ({ page }) => {
  const file = path.join(process.env.PI_E2E_PRIMARY_PROJECT!, POSTER);
  const original = await fs.readFile(file, "utf8");
  try {
    const editor = await openPoster(page);
    const canvas = editor.frameLocator("iframe.gjs-frame");
    await expect(canvas.locator(".rule.c1 h2")).toHaveText("I raise my hand", { timeout: 20_000 });
    const diagrams = editor.locator(".poster-diagrams");
    const choose = async () => {
      await editor.locator('button[data-action="insert"]').click();
      await editor.locator('[data-insert="diagram"]').click();
      await expect(diagrams.locator("[data-diagram]").first()).toBeVisible({ timeout: 15_000 });
    };

    await choose();
    const offered = await diagrams.locator("[data-diagram]").allInnerTexts();
    expect(offered).toEqual(expect.arrayContaining(["../diagrams/flow.drawio", "../diagrams/two-pages.drawio — Context", "../diagrams/two-pages.drawio — Remote things", "../diagrams/broken.drawio"]));

    // Nothing selected: onto the page, in the diagram's proportions.
    await canvas.locator(".motto").click();
    await page.keyboard.press("Escape");
    await choose();
    await diagrams.getByText("../diagrams/two-pages.drawio — Context", { exact: true }).click();
    const placed = canvas.locator('img[data-drawio="../diagrams/two-pages.drawio"]');
    await expect(placed).toHaveCount(1, { timeout: 40_000 });
    await expect(placed).toHaveAttribute("data-drawio-page", "Context");
    const ratio = await placed.evaluate((image: HTMLImageElement) => image.getBoundingClientRect().width / image.getBoundingClientRect().height);
    const natural = await placed.evaluate((image: HTMLImageElement) => image.naturalWidth / image.naturalHeight);
    expect(Math.abs(ratio - natural)).toBeLessThan(0.05);

    // The example's empty photo frame, selected: the diagram goes into it.
    await canvas.locator("img.photo").click();
    await choose();
    await diagrams.getByText("../diagrams/flow.drawio", { exact: true }).click();
    await expect(canvas.locator("img.photo")).toHaveAttribute("data-drawio", "../diagrams/flow.drawio", { timeout: 40_000 });
    expect(await svgOf(editor, "img.photo")).toMatch(/^<\?xml|^<svg/);
    await expect(editor.locator(".poster-status")).toContainText("Diagram placed");

    // A file that is no diagram: said, and nothing more on the page.
    const before = await canvas.locator("img").count();
    await choose();
    await diagrams.getByText("../diagrams/broken.drawio", { exact: true }).click();
    await expect(editor.locator(".poster-status")).toContainText("../diagrams/broken.drawio could not be drawn: it is not a draw.io diagram");
    expect(await canvas.locator("img").count()).toBe(before);

    // With two diagrams inserted, both exports still draw the page.
    const limits = { maxEntries: 50, maxInflatedBytes: 60_000_000, maxTotalBytes: 100_000_000 };
    for (const [action, extension, entry] of [["word", "docx", "word/media/poster.png"], ["powerpoint", "pptx", "ppt/media/poster.png"]] as const) {
      const download = page.waitForEvent("download", { timeout: 30_000 });
      await editor.locator(`button[data-action="${action}"]`).click();
      const file = await download;
      expect(file.suggestedFilename()).toBe(`Our class rules.${extension}`);
      const entries = readAllZipEntries(await fs.readFile((await file.path())!), limits);
      const picture = entries.get(entry) ?? [...entries].find(([name]) => name.endsWith(".png"))?.[1];
      expect(picture, `${action}: a page picture`).toBeDefined();
      expect(picture!.readUInt32BE(0)).toBe(0x89504e47);
      await expect(editor.locator(".poster-status")).not.toContainText("could not draw");
    }
  } finally {
    await fs.writeFile(file, original);
  }
});

const FIGURE = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200" viewBox="0 0 600 200"><rect x="10" y="10" width="200" height="80" fill="#ff00aa" stroke="#6c8ebf"/><text x="30" y="60" font-size="24">Client — é</text></svg>';

/** Writes `content` at `relative` in the project, creating its directory; returns its path. */
async function writeProjectFile(relative: string, content: string | Buffer): Promise<string> {
  const file = path.join(process.env.PI_E2E_PRIMARY_PROJECT!, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
  return file;
}

// openlore: scenario=AFigureTheAgentWroteFillsItsFrame spec=poster-files
test("AFigureTheAgentWroteFillsItsFrame: an SVG figure the frame names is put in it as its own SVG, and saved", async ({ page }) => {
  const figure = await writeProjectFile("figures/architecture.svg", FIGURE);
  const file = await writePoster("Figure.poster.html", '<div class="sheet"><img class="d1" data-poster-picture="architecture" data-picture-file="../figures/architecture.svg" alt=""></div>', DIAGRAM_CSS);
  try {
    const editor = await openPoster(page, "Figure.poster.html");
    await expect.poll(() => svgOf(editor, ".d1"), { timeout: 30_000 }).toBe(FIGURE);
    await expect(editor.locator(".poster-status")).toContainText("The picture is in its frame");
    await expect(editor.locator('button[data-action="save"]')).toBeEnabled();
    await editor.locator('button[data-action="save"]').click();
    await expect(editor.locator(".poster-status")).toHaveText(/Saved/);
    const saved = readPage(await fs.readFile(file, "utf8")).html;
    expect(saved).toContain('data-picture-file="../figures/architecture.svg"');
    expect(saved).toContain(`src="data:image/svg+xml;base64,${Buffer.from(FIGURE).toString("base64")}"`);
  } finally {
    await fs.rm(file, { force: true });
    await fs.rm(path.dirname(figure), { recursive: true, force: true });
  }
});

// openlore: scenario=AMissingPictureLeavesTheFrameEmpty spec=poster-files
test("AMissingPictureLeavesTheFrameEmpty: frames naming a missing file or no picture stay empty and are named", async ({ page }) => {
  const file = await writePoster(
    "NoPicture.poster.html",
    '<div class="sheet"><img class="d1" data-poster-picture="gone" data-picture-file="../figures/gone.svg" alt="">' +
      '<img class="d2" data-poster-picture="notes" data-picture-file="../site/notes.md" alt=""></div>',
    DIAGRAM_CSS,
  );
  try {
    const editor = await openPoster(page, "NoPicture.poster.html");
    const status = editor.locator(".poster-status");
    await expect(status).toContainText("not placed, its frame left empty", { timeout: 30_000 });
    await expect(status).toContainText('../figures/gone.svg: "../figures/gone.svg" could not be read');
    await expect(status).toContainText('../site/notes.md: "../site/notes.md" is not a picture file');
    const [gone, notes] = [await svgOf(editor, ".d1"), await svgOf(editor, ".d2")];
    expect(gone).toBe(notes);
    expect(gone ?? "").not.toContain("Client");
    await expect(editor.locator('button[data-action="save"]')).toBeDisabled();
  } finally {
    await fs.rm(file, { force: true });
  }
});

// openlore: scenario=TheProjectsPicturesAreOffered spec=poster-files
// openlore: scenario=AnSvgStaysVector spec=poster-files
// openlore: scenario=ARasterIsScaled spec=poster-files
test("Insert → Picture from the project: offered, an SVG kept as it is, a large PNG scaled", async ({ page }) => {
  const poster = path.join(process.env.PI_E2E_PRIMARY_PROJECT!, POSTER);
  const original = await fs.readFile(poster, "utf8");
  const figure = await writeProjectFile("figures/architecture.svg", FIGURE);
  try {
    const editor = await openPoster(page);
    const canvas = editor.frameLocator("iframe.gjs-frame");
    await expect(canvas.locator(".rule.c1 h2")).toHaveText("I raise my hand", { timeout: 20_000 });
    // A PNG 2400 pixels wide, made here and put in the project.
    const wide = await page.evaluate(() => {
      const made = document.createElement("canvas");
      made.width = 2400;
      made.height = 800;
      const context = made.getContext("2d")!;
      context.fillStyle = "#13ff7a";
      context.fillRect(0, 0, 2400, 800);
      return made.toDataURL("image/png").split(",")[1]!;
    });
    await writeProjectFile("figures/wide.png", Buffer.from(wide, "base64"));
    const list = editor.locator(".poster-diagrams");
    const choose = async () => {
      await editor.locator('button[data-action="insert"]').click();
      await editor.locator('[data-insert="project-picture"]').click();
      await expect(list.locator("[data-picture-file]").first()).toBeVisible({ timeout: 15_000 });
    };

    await choose();
    expect(await list.locator("[data-picture-file]").allInnerTexts()).toEqual(expect.arrayContaining(["../figures/architecture.svg", "../figures/wide.png", "../site/img/logo.svg"]));

    await list.getByText("../figures/architecture.svg", { exact: true }).click();
    const svg = canvas.locator('img[data-picture-file="../figures/architecture.svg"]');
    await expect(svg).toHaveCount(1, { timeout: 30_000 });
    expect(await svgOf(editor, 'img[data-picture-file="../figures/architecture.svg"]')).toBe(FIGURE);
    const ratio = await svg.evaluate((image: HTMLImageElement) => image.getBoundingClientRect().width / image.getBoundingClientRect().height);
    expect(Math.abs(ratio - 3)).toBeLessThan(0.05);

    await canvas.locator(".motto").click();
    await page.keyboard.press("Escape");
    await choose();
    await list.getByText("../figures/wide.png", { exact: true }).click();
    const png = canvas.locator('img[data-picture-file="../figures/wide.png"]');
    await expect(png).toHaveCount(1, { timeout: 30_000 });
    expect(await png.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    expect(await png.evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight])).toEqual([1200, 400]);
    await expect(editor.locator(".poster-status")).toContainText("Picture placed");

    // Both exports carry the page with both pictures in it: the SVG's magenta, the PNG's green.
    const limits = { maxEntries: 50, maxInflatedBytes: 60_000_000, maxTotalBytes: 100_000_000 };
    for (const [action, entry] of [["word", "word/media/poster.png"], ["powerpoint", "ppt/media/poster.png"]] as const) {
      const download = page.waitForEvent("download", { timeout: 30_000 });
      await editor.locator(`button[data-action="${action}"]`).click();
      const file = await download;
      const entries = readAllZipEntries(await fs.readFile((await file.path())!), limits);
      const picture = entries.get(entry) ?? [...entries].find(([name]) => name.endsWith(".png"))?.[1];
      expect(picture, `${action}: a page picture in ${[...entries.keys()].join(", ")}`).toBeDefined();
      const colours = await page.evaluate(async (base64) => {
        const image = new Image();
        await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = `data:image/png;base64,${base64}`; });
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let magenta = 0;
        let green = 0;
        for (let index = 0; index < data.length; index += 4) {
          const [red, greenness, blue] = [data[index]!, data[index + 1]!, data[index + 2]!];
          if (red > 230 && greenness < 30 && blue > 140 && blue < 200) magenta += 1;
          if (red < 40 && greenness > 230 && blue > 100 && blue < 150) green += 1;
        }
        return { magenta, green };
      }, picture!.toString("base64"));
      expect(colours.magenta, `${action}: the SVG figure is in the page`).toBeGreaterThan(1000);
      expect(colours.green, `${action}: the PNG is in the page`).toBeGreaterThan(1000);
    }
  } finally {
    await fs.writeFile(poster, original);
    await fs.rm(path.dirname(figure), { recursive: true, force: true });
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

test("ATextPastedFromWordIsExported: Word's markup and control characters do not stop the Word and PowerPoint exports", async ({ page }) => {
  // What a paste from Word leaves: its <o:p> elements, a namespaced attribute, a line break as a vertical tab.
  const file = await writePoster(
    "Pasted.poster.html",
    '<div class="sheet"><h1 class="title">Pasted \u000Bfrom Word<o:p></o:p></h1><p class="MsoNormal" o:spid="1" @click="x">Bonjour\u000Cà tous<o:p></o:p></p><!-- a -- comment --></div>',
    ".sheet { padding: 40px; } .title { color: #ff00aa; font-size: 80px; }",
  );
  try {
    const editor = await openPoster(page, "Pasted.poster.html");
    await expect(editor.frameLocator("iframe.gjs-frame").locator(".title")).toBeVisible({ timeout: 20_000 });
    for (const [action, entry] of [["word", "word/media/poster.png"], ["powerpoint", "ppt/media/poster.png"]] as const) {
      const download = page.waitForEvent("download", { timeout: 30_000 });
      await editor.locator(`button[data-action="${action}"]`).click();
      const bytes = await fs.readFile((await (await download).path())!);
      await expect(editor.locator(".poster-status")).not.toHaveAttribute("data-kind", "error");
      const png = readAllZipEntries(bytes, { maxEntries: 50, maxInflatedBytes: 60_000_000, maxTotalBytes: 100_000_000 }).get(entry)!;
      // The title is drawn: magenta pixels, not a blank page.
      const magenta = await page.evaluate(async (base64) => {
        const image = new Image();
        await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = `data:image/png;base64,${base64}`; });
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let count = 0;
        for (let index = 0; index < data.length; index += 4) if (data[index]! > 200 && data[index + 1]! < 60 && data[index + 2]! > 120) count += 1;
        return count;
      }, png.toString("base64"));
      expect(magenta).toBeGreaterThan(1000);
    }
  } finally {
    await fs.rm(file, { force: true });
  }
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

// openlore: scenario=ThePersonFillsASlot spec=poster-elements
// openlore: scenario=AShapeIsAdded spec=poster-elements
test("Pictures and shapes in the file viewer: a frame filled and a shape inserted are saved into the poster file", async ({ page }) => {
  const file = path.join(process.env.PI_E2E_PRIMARY_PROJECT!, POSTER);
  const original = await fs.readFile(file, "utf8");
  try {
    const editor = await openPoster(page);
    const canvas = editor.frameLocator("iframe.gjs-frame");
    const photo = canvas.locator('[data-poster-picture="class photo"]');
    await expect(photo).toBeVisible({ timeout: 20_000 });
    const chooser = page.waitForEvent("filechooser");
    await photo.dblclick();
    // A 2 x 2 PNG is enough: what is checked is that the picture lands in the file, as data.
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP8z8DAwMDAxMAAAA0rAQOuNQ4oAAAAAElFTkSuQmCC", "base64");
    await (await chooser).setFiles({ name: "class.png", mimeType: "image/png", buffer: png });
    await expect(canvas.locator('[data-poster-picture="class photo"][src^="data:image/png"]')).toHaveCount(1);
    await editor.locator('button[data-action="insert"]').click();
    await editor.locator('[data-insert="shape:speech-bubble"]').click();
    await expect(canvas.locator(".poster-shape.speech-bubble")).toHaveCount(1);
    await editor.locator('button[data-action="save"]').click();
    await expect(editor.locator(".poster-status")).toHaveText(/Saved/);
    const saved = readPage(await fs.readFile(file, "utf8"));
    expect(saved.html).toMatch(/data-poster-picture="class photo"[^>]*src="data:image\/png;base64,|src="data:image\/png;base64,[^"]*"[^>]*data-poster-picture="class photo"/);
    expect(saved.html).toContain('class="poster-shape speech-bubble"');
    expect(saved.css).toContain(".poster-shape svg > *");
  } finally {
    await fs.writeFile(file, original);
  }
});

// openlore: scenario=LeavingAFilledPosterAsksNothing spec=poster-files
// openlore: scenario=AFilledPosterTouchedUpIsAskedAbout spec=poster-files
test("LeavingAFilledPosterAsksNothing and AFilledPosterTouchedUpIsAskedAbout: filled frames offer Save without asking; a touch-up is asked about", async ({ page }) => {
  const figure = await writeProjectFile("figures/architecture.svg", FIGURE);
  const file = await writePoster(
    "Filled.poster.html",
    '<div class="sheet"><h1>Filled</h1>' +
      '<img class="d1" data-poster-picture="context" data-drawio="../diagrams/two-pages.drawio" data-drawio-page="Context" alt="">' +
      '<img class="d2" data-poster-picture="architecture" data-picture-file="../figures/architecture.svg" alt=""></div>',
    DIAGRAM_CSS,
  );
  const written = await fs.readFile(file, "utf8");
  const asked: string[] = [];
  page.on("dialog", (dialog) => {
    asked.push(dialog.message());
    void dialog.dismiss();
  });
  try {
    let editor = await openPoster(page, "Filled.poster.html");
    await expect.poll(() => svgOf(editor, ".d1"), { timeout: 40_000 }).toContain("API gateway");
    await expect.poll(() => svgOf(editor, ".d2"), { timeout: 30_000 }).toBe(FIGURE);
    await expect(editor.locator(".poster-status")).toContainText("in their frames, drawn from the project: save to keep them in the file");
    await expect(editor.locator('button[data-action="save"]')).toBeEnabled();
    // Leaving untouched asks nothing, and the file is as the agent wrote it.
    await page.getByRole("button", { name: /source/ }).click();
    await expect(page.getByRole("button", { name: /rendered/ })).toBeVisible();
    expect(asked).toEqual([]);
    expect(await fs.readFile(file, "utf8")).toBe(written);

    // Back, filled again, and a text corrected: leaving is asked about, and refusing stays.
    await page.getByRole("button", { name: /rendered/ }).click();
    editor = page.frameLocator('[data-testid="poster-frame"]');
    await expect.poll(() => svgOf(editor, ".d2"), { timeout: 30_000 }).toBe(FIGURE);
    const heading = editor.frameLocator("iframe.gjs-frame").locator("h1");
    await heading.click();
    await heading.dblclick();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("Touched");
    await expect(heading).toHaveText("Touched");
    // Left while the text is still being corrected: the typing alone counts.
    await page.getByRole("button", { name: /source/ }).click();
    await expect.poll(() => asked).toEqual(["Discard unsaved changes?"]);
    await expect(heading).toHaveText("Touched");
  } finally {
    await fs.rm(file, { force: true });
    await fs.rm(path.dirname(figure), { recursive: true, force: true });
  }
});

// A diagram of the poster touched up from it (poster-diagram-touch-up). Each test writes its own
// diagram: the shared ones are read by other tests.
const TOUCH_DIAGRAM = [
  '<mxfile host="e2e">',
  '<diagram id="p1" name="Overview"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>',
  '<mxCell id="a" value="Alpha" style="rounded=1;html=1;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="140" height="60" as="geometry"/></mxCell>',
  '<mxCell id="b" value="Bravo" style="rounded=1;html=1;" vertex="1" parent="1"><mxGeometry x="260" y="40" width="140" height="60" as="geometry"/></mxCell>',
  "</root></mxGraphModel></diagram>",
  '<diagram id="p2" name="Detail"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>',
  '<mxCell id="c" value="Charlie" style="rounded=1;html=1;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="140" height="60" as="geometry"/></mxCell>',
  "</root></mxGraphModel></diagram></mxfile>",
].join("");

/** Writes the test's diagram and a poster of three frames: d1 its Detail page, d2 and d3 its Overview. */
async function touchUpPoster(name: string): Promise<{ poster: string; diagram: string }> {
  const diagram = path.join(process.env.PI_E2E_PRIMARY_PROJECT!, "diagrams", `${name}.drawio`);
  await fs.writeFile(diagram, TOUCH_DIAGRAM);
  const reference = `../diagrams/${name}.drawio`;
  const poster = await writePoster(
    `${name}.poster.html`,
    '<div class="sheet"><h1>Touch-up</h1>' +
      `<img class="d1" data-drawio="${reference}" data-drawio-page="Detail" alt="">` +
      `<img class="d2" data-drawio="${reference}" data-drawio-page="Overview" alt="">` +
      `<img class="d3" data-drawio="${reference}" data-drawio-page="1" alt=""></div>`,
    DIAGRAM_CSS,
  );
  return { poster, diagram };
}

/** The touch-up over the poster, its diagram's frame, and the labels it draws. */
function touchUpOf(page: Page) {
  const dialog = page.getByTestId("poster-diagram-touch-up");
  const frame = dialog.getByTestId("drawio-frame");
  const inner = async () => (await (await frame.elementHandle())!.contentFrame())!;
  const labels = async () => (await inner()).evaluate(() => [...new Set([...document.querySelectorAll("svg foreignObject div")].filter((d) => d.querySelector("div") === null).map((d) => d.textContent?.trim() ?? "").filter(Boolean))]);
  /** Touch-up on: the graph's container takes tabindex -1 once the editor is on (drawioPage.ts). */
  const editing = async () => (await inner()).evaluate(() => document.querySelector("[tabindex='-1']") !== null);
  return { dialog, frame, inner, labels, editing };
}

/** Double-clicks a picture of the poster, as a person does. */
async function doubleClick(editor: FrameLocator, selector: string) {
  await editor.frameLocator("iframe.gjs-frame").locator(selector).dblclick();
}

/** A filled poster, saved, so that what follows is the only unsaved change. */
async function filledAndSaved(page: Page, name: string): Promise<FrameLocator> {
  const editor = await openPoster(page, `${name}.poster.html`);
  for (const frame of [".d1", ".d2", ".d3"]) await expect.poll(() => svgOf(editor, frame), { timeout: 40_000 }).not.toBeNull();
  // The fill says so once it is done; saved before that, its last word covers "Saved"
  await expect(editor.locator(".poster-status")).toContainText("draw.io diagrams are in their frames");
  await editor.locator('button[data-action="save"]').click();
  await expect(editor.locator(".poster-status")).toHaveText(/Saved/);
  return editor;
}

// openlore: scenario=DoubleClickOpensTheDiagramsPage spec=poster-files
// openlore: scenario=NothingSavedNothingChanged spec=poster-files
// openlore: scenario=TheSavedPageReplacesThePicture spec=poster-files
// openlore: scenario=EveryPictureOfThePageIsReplaced spec=poster-files
// openlore: scenario=ATallerPageKeepsTheWidth spec=poster-files
test("DoubleClickOpensTheDiagramsPage, TheSavedPageReplacesThePicture and EveryPictureOfThePageIsReplaced: the page opens over the poster, and comes back touched up", async ({ page }) => {
  // Two draw.io viewers to load, the poster's painter and the touch-up's
  test.setTimeout(180_000);
  const { poster, diagram } = await touchUpPoster("Touch");
  const chooser: string[] = [];
  page.on("filechooser", () => chooser.push("asked for a file"));
  try {
    const editor = await filledAndSaved(page, "Touch");
    const touchUp = touchUpOf(page);
    const save = editor.locator('button[data-action="save"]');

    // The second page, named by its frame: not the first, not a file chooser
    await doubleClick(editor, ".d1");
    await expect(touchUp.dialog).toBeVisible();
    await expect.poll(touchUp.labels, { timeout: 40_000 }).toEqual(["Charlie"]);
    await expect.poll(touchUp.editing).toBe(true);
    // Left without a save: the poster as it was
    await touchUp.dialog.getByRole("button", { name: /back to the poster/ }).click();
    await expect(touchUp.dialog).toHaveCount(0);
    await expect(editor.locator(".poster-status")).toContainText("is unchanged");
    await expect(save).toBeDisabled();

    // The first page, from d2: Bravo moved down, so the page grows taller
    const before = { d1: await svgOf(editor, ".d1"), d2: await svgOf(editor, ".d2"), d3: await svgOf(editor, ".d3") };
    const box = async () => editor.frameLocator("iframe.gjs-frame").locator(".d2").evaluate((image: HTMLElement) => ({ width: image.offsetWidth, height: image.offsetHeight }));
    const sized = await box();
    await doubleClick(editor, ".d2");
    await expect.poll(touchUp.labels, { timeout: 40_000 }).toEqual(["Alpha", "Bravo"]);
    await expect.poll(touchUp.editing).toBe(true);
    const inner = await touchUp.inner();
    const frameBox = (await touchUp.frame.boundingBox())!;
    const bravo = await inner.evaluate(() => {
      const label = [...document.querySelectorAll("svg foreignObject div")].find((d) => d.querySelector("div") === null && d.textContent?.trim() === "Bravo")!;
      const r = label.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    const from = { x: frameBox.x + bravo.x, y: frameBox.y + bravo.y };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x, from.y + 220, { steps: 12 });
    await page.mouse.up();
    await touchUp.dialog.getByRole("button", { name: "✓ save" }).click();
    await expect.poll(async () => (await fs.readFile(diagram, "utf8")) !== TOUCH_DIAGRAM).toBe(true);
    await touchUp.dialog.getByRole("button", { name: /back to the poster/ }).click();
    await expect(touchUp.dialog).toHaveCount(0);

    // Both pictures of the page drawn again, the other page's untouched
    await expect.poll(() => svgOf(editor, ".d2"), { timeout: 40_000 }).not.toBe(before.d2);
    expect(await svgOf(editor, ".d3")).toBe(await svgOf(editor, ".d2"));
    expect(await svgOf(editor, ".d1")).toBe(before.d1);
    await expect(editor.locator(".poster-status")).toContainText("drawn again in the poster, in its 2 pictures");
    // Same place and width; the height follows the taller page
    const resized = await box();
    expect(resized.width).toBe(sized.width);
    const ratio = await editor.frameLocator("iframe.gjs-frame").locator(".d2").evaluate((image: HTMLImageElement) => image.naturalHeight / image.naturalWidth);
    expect(Math.abs(resized.height - Math.round(resized.width * ratio))).toBeLessThanOrEqual(1);
    expect(resized.height).toBeGreaterThan(sized.height);
    await expect(save).toBeEnabled();
    expect(chooser).toEqual([]);

    // One undo puts both pictures back
    await editor.locator('button[data-action="undo"]').click();
    await expect.poll(() => svgOf(editor, ".d2")).toBe(before.d2);
    expect(await svgOf(editor, ".d3")).toBe(before.d3);

    await editor.locator('button[data-action="redo"]').click();
    await expect.poll(() => svgOf(editor, ".d2")).not.toBe(before.d2);
    await save.click();
    await expect(editor.locator(".poster-status")).toHaveText(/Saved/);
    const saved = readPage(await fs.readFile(poster, "utf8")).html;
    expect(saved.match(/src="data:image\/svg\+xml;base64,/g)).toHaveLength(3);
  } finally {
    await fs.rm(poster, { force: true });
    await fs.rm(diagram, { force: true });
  }
});

// openlore: scenario=AMissingDiagramSaysWhy spec=poster-files
test("AMissingDiagramSaysWhy: a picture naming a diagram that is gone says so, opens nothing and asks for no file", async ({ page }) => {
  const { poster, diagram } = await touchUpPoster("Gone");
  const chooser: string[] = [];
  page.on("filechooser", () => chooser.push("asked for a file"));
  try {
    const editor = await filledAndSaved(page, "Gone");
    await fs.rm(diagram);
    await doubleClick(editor, ".d2");
    await expect(editor.locator(".poster-status")).toContainText("../diagrams/Gone.drawio (Overview) could not be opened");
    await expect(page.getByTestId("poster-diagram-touch-up")).toHaveCount(0);
    await expect(editor.locator('button[data-action="save"]')).toBeDisabled();
    expect(chooser).toEqual([]);
  } finally {
    await fs.rm(poster, { force: true });
    await fs.rm(diagram, { force: true });
  }
});

// openlore: scenario=ASaveFromDrawioDesktopReachesThePoster spec=poster-files
// openlore: scenario=TheDiagramCanGoToDrawioDesktop spec=poster-files
test("ASaveFromDrawioDesktopReachesThePoster and TheDiagramCanGoToDrawioDesktop: the diagram goes to draw.io desktop, and its save comes back", async ({ page }) => {
  // Two draw.io viewers to load, the poster's painter and the touch-up's
  test.setTimeout(180_000);
  // draw.io desktop is not launched here: its request is caught on its way to the server
  const native: string[] = [];
  await page.routeWebSocket(/.*/, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const parsed = typeof message === "string" ? (JSON.parse(message) as { type?: string; path?: string }) : {};
      if (parsed.type === "open_native") native.push(parsed.path ?? "");
      else server.send(message);
    });
    server.onMessage((message) => socket.send(message));
  });
  const { poster, diagram } = await touchUpPoster("Desktop");
  try {
    const editor = await filledAndSaved(page, "Desktop");
    const touchUp = touchUpOf(page);
    await doubleClick(editor, ".d2");
    await expect.poll(touchUp.labels, { timeout: 40_000 }).toEqual(["Alpha", "Bravo"]);
    await touchUp.dialog.getByRole("button", { name: /draw\.io desktop/ }).click();
    await expect.poll(() => native).toEqual(["diagrams/Desktop.drawio"]);

    // What draw.io desktop saves, written beside the touch-up: shown in it, then in the poster
    await fs.writeFile(diagram, TOUCH_DIAGRAM.replace('value="Bravo"', 'value="Delta"'));
    await expect.poll(touchUp.labels, { timeout: 40_000 }).toEqual(["Alpha", "Delta"]);
    await touchUp.dialog.getByRole("button", { name: /back to the poster/ }).click();
    await expect.poll(() => svgOf(editor, ".d2"), { timeout: 40_000 }).toContain("Delta");
    expect(await svgOf(editor, ".d3")).toContain("Delta");
    expect(await svgOf(editor, ".d1")).toContain("Charlie");
  } finally {
    await fs.rm(poster, { force: true });
    await fs.rm(diagram, { force: true });
  }
});
