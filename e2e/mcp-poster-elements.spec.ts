/**
 * What the person adds to a poster in the posters extension's editor (poster-elements): pictures
 * into the frames the model laid out or onto the page, text boxes and shapes from the Insert
 * menu, and drawings the model wrote, all moved and resized as wholes. Driven in the MCP host
 * frame Claude Desktop uses (mcp-poster-host.ts), with assertions on positions, sizes, colours
 * and the saved markup rather than on screenshots.
 *
 * Electron (Claude Desktop) dragged an <img> natively off its card, which Playwright cannot show
 * since it intercepts native drags; what can be observed here is that the editor default-prevents
 * the press on a picture, so no native drag can start.
 *
 * Needs the view built (`npm run build:viewer-poster --workspace @pi-outpost/mcp`).
 */
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { readAllZipEntries } from "@pi-outpost/office/zip.ts";
import { canvasFrame, hostLog, json, usePosterHost } from "./mcp-poster-host.ts";

const { callTool, createPoster, show } = usePosterHost();

/** A menu poster: two empty frames styled as empty on their class, a drawing in a card. */
const MENU = {
  html: `<div class="poster">
  <h1 class="title">Our menu</h1>
  <div class="grid">
    <div class="cell c1"><h2>Bread</h2><img class="slot" data-poster-picture="bread" alt="bread"></div>
    <div class="cell c2"><h2>Soup</h2><img class="slot" data-poster-picture="soup" alt="soup"></div>
    <div class="cell c3"><h2>Door</h2><div class="drawing"><svg viewBox="0 0 200 260"><rect x="30" y="20" width="140" height="230" rx="10" fill="#8d5524"/><rect x="45" y="35" width="110" height="95" rx="6" fill="#a86b32"/><circle cx="140" cy="140" r="9" fill="#ffd54f"/></svg></div></div>
    <div class="cell c4"><h2>Dessert</h2></div>
  </div>
</div>`,
  css: `.poster { width: 100%; height: 100%; padding: 40px; font-family: Verdana, sans-serif; background: #fffdf7; display: flex; flex-direction: column; gap: 24px; }
.title { margin: 0; text-align: center; font-size: 48px; color: #2b4c7e; }
.grid { flex: 1; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 24px; }
.cell { border: 4px solid #2b4c7e; border-radius: 18px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; }
.cell h2 { margin: 0; font-size: 28px; }
.slot { width: 260px; height: 260px; object-fit: contain; border: 3px dashed #9fb3cf; background: #eef3fa; border-radius: 10px; }
.drawing { width: 160px; height: 208px; }
.drawing svg { width: 100%; height: 100%; display: block; }`,
};

type Box = { x: number; y: number; width: number; height: number };

/** A picture file made here: a gradient with a disc, of the size asked, opaque or with a transparent border. */
async function pictureFile(name: string, width: number, height: number, kind: "png" | "jpeg", transparentBorder = false) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!transparentBorder) {
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#fbc02d");
    gradient.addColorStop(1, "#ffffff");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  }
  context.fillStyle = "#e65100";
  context.beginPath();
  context.arc(width / 2, height / 2, Math.min(width, height) / 3, 0, Math.PI * 2);
  context.fill();
  const buffer = kind === "png" ? await canvas.encode("png") : await canvas.encode("jpeg", 90);
  return { name, mimeType: kind === "png" ? "image/png" : "image/jpeg", buffer };
}

/** The current zoom: the canvas frame's drawn width over the page's 794 px. */
async function zoomOf(view: FrameLocator) {
  return (await view.locator("iframe.gjs-frame").boundingBox())!.width / 794;
}

/** Boxes of `selector`'s elements in page pixels, read in the canvas. */
async function boxes(page: Page, selector: string): Promise<Box[]> {
  return (await canvasFrame(page)).evaluate((wanted) => [...document.querySelectorAll(wanted)].map((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  }), selector);
}

/** Opens a file chooser by `open`, and gives it `file`. */
async function choose(page: Page, open: () => Promise<void>, file: { name: string; mimeType: string; buffer: Buffer }) {
  const chooser = page.waitForEvent("filechooser", { timeout: 5000 });
  await open();
  await (await chooser).setFiles(file);
}

async function insert(view: FrameLocator, what: string) {
  await view.locator('button[data-action="insert"]').click();
  await view.locator(`[data-insert="${what}"]`).click();
}

/** Drags from the middle of `target`, or from `from` within it, by (dx, dy) screen pixels, the button held all the way. */
async function drag(page: Page, target: { boundingBox(): Promise<Box | null> }, dx: number, dy: number, from?: { x: number; y: number }) {
  const box = (await target.boundingBox())!;
  const start = from ? { x: box.x + from.x, y: box.y + from.y } : { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 10 });
  await page.mouse.up();
}

/** Drags the resize handle `handle` of the selected element by (dx, dy) screen pixels. */
async function pullHandle(page: Page, view: FrameLocator, handle: string, dx: number, dy: number) {
  await drag(page, view.locator(`.gjs-resizer-h-${handle}`), dx, dy);
}

/** Drops `file` on the element at `selector` in the canvas, at its middle, as the desktop would. */
async function drop(page: Page, selector: string, file: { name: string; mimeType: string; buffer: Buffer }) {
  await (await canvasFrame(page)).evaluate(({ wanted, name, mimeType, base64 }) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], name, { type: mimeType }));
    const target = document.querySelector(wanted)!;
    const { x, y, width, height } = target.getBoundingClientRect();
    const at = { clientX: x + width / 2, clientY: y + height / 2 };
    target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer, ...at }));
    target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer, ...at }));
  }, { wanted: selector, name: file.name, mimeType: file.mimeType, base64: file.buffer.toString("base64") });
}

async function save(view: FrameLocator) {
  await view.locator('button[data-action="save"]').click();
  await expect(view.locator(".poster-status")).toHaveText(/Saved/);
}

// openlore: scenario=AnEmptySlotIsShown spec=poster-elements
test("AnEmptySlotIsShown: an empty frame keeps the model's dashed look, fetches nothing, and is saved still empty", async ({ page }) => {
  const id = await createPoster("Empty frame", MENU);
  const requests: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("data:") && !request.url().startsWith("about:")) requests.push(request.url());
  });
  const { view, canvas } = await show(page, id);
  const look = await (await canvasFrame(page)).evaluate(() => {
    const slot = document.querySelector('[data-poster-picture="bread"]')!;
    const style = getComputedStyle(slot);
    return { border: style.borderTopStyle, width: slot.getBoundingClientRect().width };
  });
  expect(look).toEqual({ border: "dashed", width: 260 });
  expect(requests).toEqual([]);
  // A change elsewhere, saved: the frames are written back without GrapesJS's placeholder.
  await canvas.locator(".cell.c4").click({ position: { x: 8, y: 8 } });
  await view.locator('button[data-action="style"]').click();
  const background = view.locator(".gjs-sm-property__background-color input").first();
  await background.fill("#ffeeee");
  await background.press("Enter");
  await save(view);
  const html = json(await callTool("get_poster", { id })).html as string;
  expect(html).toMatch(/<img[^>]*data-poster-picture="bread"[^>]*>/);
  expect(/<img[^>]*data-poster-picture="bread"[^>]*>/.exec(html)![0]).not.toContain("src=");
});

// openlore: scenario=ThePersonFillsASlot spec=poster-elements
// openlore: scenario=TheDashedFrameGoes spec=poster-elements
// openlore: scenario=ALargePictureIsScaledDown spec=poster-elements
test("ThePersonFillsASlot, TheDashedFrameGoes and ALargePictureIsScaledDown: a double-clicked frame takes the picture, at its size, without its dashes", async ({ page }) => {
  const id = await createPoster("Fill a frame", MENU);
  const { view, canvas } = await show(page, id);
  const [before] = await boxes(page, '[data-poster-picture="bread"]');
  await choose(page, () => canvas.locator('[data-poster-picture="bread"]').dblclick(), await pictureFile("bread.png", 2400, 1800, "png"));
  await expect(canvas.locator('[data-poster-picture="bread"][src^="data:image/png;base64,"]')).toHaveCount(1);
  const filled = await (await canvasFrame(page)).evaluate(() => {
    const read = (name: string) => {
      const slot = document.querySelector(`[data-poster-picture="${name}"]`) as HTMLImageElement;
      const style = getComputedStyle(slot);
      return { natural: [slot.naturalWidth, slot.naturalHeight], border: style.borderTopStyle, background: style.backgroundColor };
    };
    return { bread: read("bread"), soup: read("soup") };
  });
  expect(filled.bread).toEqual({ natural: [1200, 900], border: "none", background: "rgba(0, 0, 0, 0)" });
  expect(filled.soup).toEqual({ natural: expect.any(Array), border: "dashed", background: "rgb(238, 243, 250)" });
  const [after] = await boxes(page, '[data-poster-picture="bread"]');
  expect(after).toEqual(before);
  await save(view);
  const html = json(await callTool("get_poster", { id })).html as string;
  expect(html).toMatch(/data-poster-picture="bread"[^>]*src="poster-picture:1"|src="poster-picture:1"[^>]*data-poster-picture="bread"/);
});

// openlore: scenario=TheMenuListsWhatCanBeInserted spec=poster-elements
test("TheMenuListsWhatCanBeInserted: Insert offers a picture, text and eight shapes, and closes on a choice, Escape or a press elsewhere", async ({ page }) => {
  const id = await createPoster("Menu");
  const { view, canvas } = await show(page, id);
  const menu = view.locator(".poster-menu");
  await view.locator('button[data-action="insert"]').click();
  await expect(menu).toBeVisible();
  await expect(menu.locator("[role=menuitem]")).toHaveText(["Picture…", "Text", "Rectangle", "Rounded rectangle", "Ellipse", "Triangle", "Arrow", "Line", "Star", "Speech bubble"]);
  await view.locator('[data-insert="shape:star"]').click();
  await expect(menu).toBeHidden();
  await view.locator('button[data-action="insert"]').click();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await view.locator('button[data-action="insert"]').click();
  await canvas.locator(".motto").click();
  await expect(menu).toBeHidden();
});

// openlore: scenario=AReadOnlyPosterOffersNoInsert spec=poster-elements
test("AReadOnlyPosterOffersNoInsert: shown read-only, there is no Insert control", async ({ page }) => {
  const id = await createPoster("Read-only");
  const { view } = await show(page, id, "light", "allow-scripts");
  await expect(view.locator('button[data-action="insert"]')).toBeHidden();
});

// openlore: scenario=APictureIsInsertedOnThePage spec=poster-elements
// openlore: scenario=InsertPictureFillsTheSelectedSlot spec=poster-elements
test("APictureIsInsertedOnThePage and InsertPictureFillsTheSelectedSlot: centred on the page when nothing is selected, into the frame when one is", async ({ page }) => {
  const id = await createPoster("Insert pictures", MENU);
  const { view, canvas } = await show(page, id);
  const others = await boxes(page, ".cell, .title");
  await choose(page, () => insert(view, "picture"), await pictureFile("sun.jpg", 900, 900, "jpeg"));
  await expect(canvas.locator('img[src^="data:image/jpeg"]:not(.slot)')).toHaveCount(1);
  const [placed] = await boxes(page, 'img[src^="data:image/jpeg"]:not(.slot)');
  // A third of the page wide, centred on it.
  expect(placed!.width).toBeCloseTo(794 / 3, 0);
  expect(placed!.x + placed!.width / 2).toBeCloseTo(397, -1);
  expect(placed!.y + placed!.height / 2).toBeCloseTo(1123 / 2, -1);
  await expect.poll(async () => (await canvasFrame(page)).evaluate(() => document.querySelector('img[src^="data:image/jpeg"]:not(.slot)')!.classList.contains("gjs-selected"))).toBe(true);
  expect(await boxes(page, ".cell, .title")).toEqual(others);
  // With the soup frame selected, the picture goes into it.
  await canvas.locator('[data-poster-picture="soup"]').click();
  await choose(page, () => insert(view, "picture"), await pictureFile("soup.png", 600, 400, "png"));
  await expect(canvas.locator('[data-poster-picture="soup"][src^="data:image/png"]')).toHaveCount(1);
});

// openlore: scenario=ATextBoxIsAdded spec=poster-elements
// openlore: scenario=ATextBoxIsMovedAndResized spec=poster-elements
test("ATextBoxIsAdded and ATextBoxIsMovedAndResized: typed over at the centre in the poster's font, moved, narrowed so it rewraps, and saved", async ({ page }) => {
  const id = await createPoster("Text box", MENU);
  const { view, canvas } = await show(page, id);
  await insert(view, "text");
  await page.keyboard.type("Bon appétit à toutes et à tous !");
  const box = canvas.locator(".poster-text");
  await expect(box).toHaveText("Bon appétit à toutes et à tous !");
  const font = await (await canvasFrame(page)).evaluate(() => {
    const text = document.querySelector(".poster-text")!;
    const { x, width } = text.getBoundingClientRect();
    return { family: getComputedStyle(text).fontFamily, size: getComputedStyle(text).fontSize, centre: x + width / 2 };
  });
  expect(font).toEqual({ family: "Verdana, sans-serif", size: "32px", centre: expect.closeTo(397, -1) });
  await canvas.locator(".title").click();
  await box.click();
  const zoom = await zoomOf(view);
  const [before] = await boxes(page, ".poster-text");
  await drag(page, box, 40, 60);
  const [moved] = await boxes(page, ".poster-text");
  expect(moved!.x - before!.x).toBeCloseTo(40 / zoom, -1);
  expect(moved!.y - before!.y).toBeCloseTo(60 / zoom, -1);
  await pullHandle(page, view, "cr", -80, 0);
  const [narrowed] = await boxes(page, ".poster-text");
  expect(narrowed!.width).toBeLessThan(moved!.width - 60);
  // Narrower, the text takes more lines.
  expect(narrowed!.height).toBeGreaterThan(moved!.height);
  await save(view);
  expect(json(await callTool("get_poster", { id })).html).toContain("Bon appétit à toutes et à tous !");
});

// openlore: scenario=AShapeIsAdded spec=poster-elements
// openlore: scenario=AShapeIsStretched spec=poster-elements
test("AShapeIsAdded and AShapeIsStretched: an ellipse centred and selected with handles, a rectangle widened keeping its height", async ({ page }) => {
  const id = await createPoster("Shapes", MENU);
  const { view } = await show(page, id);
  await insert(view, "shape:ellipse");
  const [ellipse] = await boxes(page, ".poster-shape.ellipse");
  expect(ellipse!.x + ellipse!.width / 2).toBeCloseTo(397, -1);
  expect(ellipse!.y + ellipse!.height / 2).toBeCloseTo(1123 / 2, -1);
  await expect.poll(async () => (await canvasFrame(page)).evaluate(() => document.querySelector(".poster-shape.ellipse")!.classList.contains("gjs-selected"))).toBe(true);
  await expect(view.locator(".gjs-resizer-h-cr")).toBeVisible();
  // A second shape steps aside rather than hiding the first.
  await insert(view, "shape:rectangle");
  const [rectangle] = await boxes(page, ".poster-shape.rectangle");
  expect(rectangle!.x).toBeGreaterThan(ellipse!.x);
  await pullHandle(page, view, "cr", 60, 0);
  const [stretched] = await boxes(page, ".poster-shape.rectangle");
  expect(stretched!.width - rectangle!.width).toBeCloseTo(60 / (await zoomOf(view)), -1);
  expect(stretched!.height).toBeCloseTo(rectangle!.height, 0);
  // The drawn shape stretches with its holder.
  const drawn = await (await canvasFrame(page)).evaluate(() => document.querySelector(".poster-shape.rectangle svg")!.getBoundingClientRect().width);
  expect(drawn).toBeCloseTo(stretched!.width, 0);
});

// openlore: scenario=AShapeIsRecoloured spec=poster-elements
// openlore: scenario=AShapeKeepsItsColoursInTheExport spec=poster-elements
test("AShapeIsRecoloured and AShapeKeepsItsColoursInTheExport: one rectangle turned green in Format, green in the Word export, the other unchanged", async ({ page }) => {
  const id = await createPoster("Recolour", MENU);
  const { view, canvas } = await show(page, id);
  await insert(view, "shape:rectangle");
  await insert(view, "shape:rectangle");
  await view.locator('button[data-action="style"]').click();
  const fill = view.locator(".gjs-sm-property").filter({ hasText: "Fill" }).locator("input").first();
  await expect(fill).toBeVisible();
  await fill.fill("#2e7d32");
  await fill.press("Enter");
  const fills = async () => (await canvasFrame(page)).evaluate(() => [...document.querySelectorAll(".poster-shape.rectangle svg > *")].map((shape) => getComputedStyle(shape).fill));
  await expect.poll(fills).toEqual(["rgb(79, 195, 247)", "rgb(46, 125, 50)"]);
  // Another element selected: the Shape fields are not offered for it.
  await canvas.locator(".title").click();
  await expect(view.locator(".gjs-sm-property").filter({ hasText: "Fill" })).toBeHidden();
  const [, green] = await boxes(page, ".poster-shape.rectangle");
  await view.locator('button[data-action="word"]').click();
  await expect(view.locator(".poster-status")).toHaveText(/Downloaded/, { timeout: 30_000 });
  const download = (await hostLog(page)).find((entry) => entry.method === "ui/download-file")!;
  const docx = Buffer.from((download.params.contents as Array<{ resource: { blob: string } }>)[0]!.resource.blob, "base64");
  const png = readAllZipEntries(docx, { maxEntries: 50, maxInflatedBytes: 60_000_000, maxTotalBytes: 100_000_000 }).get("word/media/poster.png")!;
  const picture = await loadImage(png);
  const scale = picture.width / 794;
  const canvas2d = createCanvas(picture.width, picture.height);
  const context = canvas2d.getContext("2d");
  context.drawImage(picture, 0, 0);
  // The middle of the right half: the green rectangle shows no other element there.
  const [r, g, b] = context.getImageData(Math.round((green!.x + green!.width * 0.75) * scale), Math.round((green!.y + green!.height / 2) * scale), 1, 1).data;
  expect([r, g, b]).toEqual([46, 125, 50]);
});

// openlore: scenario=APictureIsDroppedOnACard spec=poster-elements
// openlore: scenario=APictureIsDroppedOnASlot spec=poster-elements
test("APictureIsDroppedOnACard and APictureIsDroppedOnASlot: centred where dropped, or into the frame; a file that is not a picture is ignored", async ({ page }) => {
  const id = await createPoster("Drop", MENU);
  const { view, canvas } = await show(page, id);
  await drop(page, ".cell.c4", await pictureFile("cake.png", 500, 500, "png"));
  await expect(canvas.locator('img[src^="data:image/png"]:not(.slot)')).toHaveCount(1);
  const [card] = await boxes(page, ".cell.c4");
  const [cake] = await boxes(page, 'img[src^="data:image/png"]:not(.slot)');
  expect(cake!.x + cake!.width / 2).toBeCloseTo(card!.x + card!.width / 2, -1);
  expect(cake!.y + cake!.height / 2).toBeCloseTo(card!.y + card!.height / 2, -1);
  await drop(page, '[data-poster-picture="bread"]', await pictureFile("bread.jpg", 800, 600, "jpeg"));
  await expect(canvas.locator('[data-poster-picture="bread"][src^="data:image/jpeg"]')).toHaveCount(1);
  await drop(page, ".cell.c3", { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not a picture") });
  await expect(canvas.locator("img:not(.slot)")).toHaveCount(1);
  // Dropped beside the page, on the editor's own document: refused, so the browser does not open
  // the file in place of the editor, and the editor says where to drop.
  const viewFrame = page.frames().find((frame) => frame.parentFrame() === page.mainFrame())!;
  const prevented = await viewFrame.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["x"], "beside.png", { type: "image/png" }));
    const drop = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer });
    document.querySelector(".poster-canvas")!.dispatchEvent(drop);
    return drop.defaultPrevented;
  });
  expect(prevented).toBe(true);
  await expect(view.locator(".poster-status")).toHaveText("Drop a picture on the page itself, or on a picture frame.");
  await expect(canvas.locator("img:not(.slot)")).toHaveCount(1);
});

// openlore: scenario=ATransparentPictureStaysTransparent spec=poster-elements
// openlore: scenario=AFileThatIsNotAPictureIsRefused spec=poster-elements
test("ATransparentPictureStaysTransparent and AFileThatIsNotAPictureIsRefused: a PNG keeps its clear corners; an unreadable file is refused and changes nothing", async ({ page }) => {
  const id = await createPoster("Transparency", MENU);
  const { view, canvas } = await show(page, id);
  await choose(page, () => canvas.locator('[data-poster-picture="bread"]').dblclick(), await pictureFile("disc.png", 400, 400, "png", true));
  await expect(canvas.locator('[data-poster-picture="bread"][src^="data:image/png"]')).toHaveCount(1);
  const alpha = await (await canvasFrame(page)).evaluate(async () => {
    const slot = document.querySelector('[data-poster-picture="bread"]') as HTMLImageElement;
    await slot.decode();
    const canvas = document.createElement("canvas");
    canvas.width = slot.naturalWidth;
    canvas.height = slot.naturalHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(slot, 0, 0);
    return { corner: context.getImageData(2, 2, 1, 1).data[3], middle: context.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data[3] };
  });
  expect(alpha).toEqual({ corner: 0, middle: 255 });
  // An SVG file, which the browser's bitmap decoder refuses, is taken through an image, still transparent.
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><circle cx="150" cy="100" r="80" fill="#43a047"/></svg>';
  await choose(page, () => canvas.locator('[data-poster-picture="soup"]').dblclick(), { name: "soup.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg) });
  await expect(canvas.locator('[data-poster-picture="soup"][src^="data:image/png"]')).toHaveCount(1);
  await canvas.locator('[data-poster-picture="soup"]').click();
  await view.locator('button[data-action="undo"]').click();
  await view.locator('button[data-action="undo"]').click();
  const pictures = () => canvasFrame(page).then((frame) => frame.evaluate(() => [...document.querySelectorAll("img")].map((image) => `${image.dataset.posterPicture}:${image.getAttribute("src")?.slice(0, 40)}:${getComputedStyle(image).borderTopStyle}`)));
  const before = await pictures();
  await choose(page, () => canvas.locator('[data-poster-picture="soup"]').dblclick(), { name: "broken.png", mimeType: "image/png", buffer: Buffer.from("this is not a png") });
  await expect(view.locator(".poster-status")).toHaveText("This file could not be read as a picture.");
  expect(await pictures()).toEqual(before);
});

// openlore: scenario=APictureInASlotIsMoved spec=poster-elements
// openlore: scenario=APictureIsResized spec=poster-elements
test("APictureInASlotIsMoved and APictureIsResized: the press starts no native drag, the picture follows the mouse and keeps its proportions", async ({ page }) => {
  const id = await createPoster("Move a picture", MENU);
  const { view, canvas } = await show(page, id);
  await choose(page, () => canvas.locator('[data-poster-picture="bread"]').dblclick(), await pictureFile("bread.png", 800, 600, "png"));
  const slot = canvas.locator('[data-poster-picture="bread"][src^="data:"]');
  await expect(slot).toHaveCount(1);
  const prevented = await (await canvasFrame(page)).evaluate(() => {
    const picture = document.querySelector('[data-poster-picture="bread"]')!;
    const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
    picture.dispatchEvent(press);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    return press.defaultPrevented;
  });
  expect(prevented).toBe(true);
  // A short press stays a click: the picture is selected, not moved.
  const [start] = await boxes(page, '[data-poster-picture="bread"]');
  await slot.click();
  expect((await boxes(page, '[data-poster-picture="bread"]'))[0]).toEqual(start);
  const zoom = await zoomOf(view);
  await drag(page, slot, 40, 30);
  const [moved] = await boxes(page, '[data-poster-picture="bread"]');
  expect(moved!.x - start!.x).toBeCloseTo(40 / zoom, -1);
  expect(moved!.y - start!.y).toBeCloseTo(30 / zoom, -1);
  expect(await (await canvasFrame(page)).evaluate(() => document.querySelector('[data-poster-picture="bread"]')!.closest(".cell.c1") !== null)).toBe(true);
  await pullHandle(page, view, "br", -60, -60);
  const [resized] = await boxes(page, '[data-poster-picture="bread"]');
  expect(resized!.width).toBeLessThan(moved!.width - 40);
  expect(resized!.width / resized!.height).toBeCloseTo(moved!.width / moved!.height, 1);
});

// openlore: scenario=APlacedPictureStillMovesAfterReopening spec=poster-elements
test("APlacedPictureStillMovesAfterReopening: a picture, a shape and a text box placed, saved, reopened, still follow the mouse", async ({ page, browser }) => {
  const id = await createPoster("Reopen", MENU);
  const { view } = await show(page, id);
  await choose(page, () => insert(view, "picture"), await pictureFile("sun.png", 600, 600, "png"));
  await insert(view, "shape:star");
  await insert(view, "text");
  await page.keyboard.type("Hello");
  await save(view);
  const again = await browser.newPage();
  const reopened = await show(again, id);
  // Each was inserted a step down and right of the one before: their top-left corners are clear.
  for (const selector of ['img[src^="data:"]:not(.slot)', ".poster-shape.star", ".poster-text"]) {
    const target = reopened.canvas.locator(selector);
    await target.click({ position: { x: 6, y: 6 } });
    const [before] = await boxes(again, selector);
    await drag(again, target, -30, -45, { x: 6, y: 6 });
    const [after] = await boxes(again, selector);
    const zoom = await zoomOf(reopened.view);
    // Within 10 page pixels: placed elements move by left and top, snapping to the guides of their neighbours.
    expect(Math.abs(after!.x - before!.x + 30 / zoom), selector).toBeLessThan(10);
    expect(Math.abs(after!.y - before!.y + 45 / zoom), selector).toBeLessThan(10);
  }
  await again.close();
});

// openlore: scenario=AClickOnAShapeSelectsTheDrawing spec=poster-elements
// openlore: scenario=DraggingADrawingLeavesItsCard spec=poster-elements
test("AClickOnAShapeSelectsTheDrawing and DraggingADrawingLeavesItsCard: a panel of the door selects the whole drawing, which moves alone", async ({ page }) => {
  const id = await createPoster("Drawing", MENU);
  const { view, canvas } = await show(page, id);
  const drawing = canvas.locator(".drawing");
  // The upper panel of the door, a shape inside the SVG.
  await drawing.click({ position: { x: 80, y: 60 } });
  // GrapesJS marks the selection on its next frame: waited for, not read at once.
  await expect.poll(async () => (await canvasFrame(page)).evaluate(() => document.querySelector(".gjs-selected")?.className ?? "")).toMatch(/^drawing\b/);
  await expect(view.locator(".gjs-resizer-h-br")).toBeVisible();
  const [card] = await boxes(page, ".cell.c3");
  const [before] = await boxes(page, ".drawing");
  const zoom = await zoomOf(view);
  await drag(page, drawing, 50, 20);
  const [after] = await boxes(page, ".drawing");
  expect(after!.x - before!.x).toBeCloseTo(50 / zoom, -1);
  expect((await boxes(page, ".cell.c3"))[0]).toEqual(card);
  // Its corner resizes it as one, keeping the drawing's proportions.
  await pullHandle(page, view, "br", 30, 0);
  const [resized] = await boxes(page, ".drawing");
  expect(resized!.width / resized!.height).toBeCloseTo(before!.width / before!.height, 1);
});

test("Monkey: a frame double-clicked again while scaling, two files dropped at once, Insert with Format open, a drag during a save, undo after a fill", async ({ page }) => {
  const id = await createPoster("Monkey", MENU);
  const { view, canvas } = await show(page, id);
  // Two pictures chosen for the same frame in quick succession: the frame ends with one, the last chosen.
  const big = await pictureFile("big.png", 3000, 2000, "png");
  await choose(page, () => canvas.locator('[data-poster-picture="bread"]').dblclick(), big);
  await choose(page, () => canvas.locator('[data-poster-picture="bread"]').dblclick(), await pictureFile("small.jpg", 300, 200, "jpeg"));
  await expect.poll(() => canvasFrame(page).then((frame) => frame.evaluate(() => (document.querySelector('[data-poster-picture="bread"]') as HTMLImageElement).src.slice(0, 15)))).toBe("data:image/jpeg");
  await page.waitForTimeout(1500);
  expect(await (await canvasFrame(page)).evaluate(() => (document.querySelector('[data-poster-picture="bread"]') as HTMLImageElement).naturalWidth)).toBe(300);
  // Two files dropped at once: one picture placed, the other ignored, nothing broken.
  await (await canvasFrame(page)).evaluate(async () => {
    const make = async (colour: string) => {
      const canvas = document.createElement("canvas");
      canvas.width = 50;
      canvas.height = 50;
      canvas.getContext("2d")!.fillStyle = colour;
      canvas.getContext("2d")!.fillRect(0, 0, 50, 50);
      return new File([await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), "image/png"))], `${colour}.png`, { type: "image/png" });
    };
    const transfer = new DataTransfer();
    transfer.items.add(await make("red"));
    transfer.items.add(await make("blue"));
    const target = document.querySelector(".cell.c4")!;
    const { x, y } = target.getBoundingClientRect();
    target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: x + 20, clientY: y + 20 }));
  });
  await expect(canvas.locator("img:not(.slot)")).toHaveCount(1);
  // Insert with the Format panel open: the shape is added and the panel shows its fields.
  await view.locator('button[data-action="style"]').click();
  await insert(view, "shape:triangle");
  await expect(view.locator(".gjs-sm-property").filter({ hasText: "Fill" })).toBeVisible();
  // A drag while a save is on its way: the save lands, the move is kept as an unsaved change.
  await view.locator('button[data-action="save"]').click();
  await drag(page, canvas.locator(".poster-shape.triangle"), 30, 0);
  await expect.poll(async () => json(await callTool("get_poster", { id })).revision).toBe(2);
  await expect(view.locator('button[data-action="save"]')).toBeEnabled();
  await view.locator('button[data-action="save"]').click();
  await expect(view.locator(".poster-status")).toHaveText(/Saved \(revision 3\)/);
  expect(json(await callTool("get_poster", { id })).css).toMatch(/\.triangle|#\w+\{[^}]*left/);
  // Undo right after a fill gives the empty frame back, with its dashes.
  await choose(page, () => canvas.locator('[data-poster-picture="soup"]').dblclick(), await pictureFile("soup.png", 400, 300, "png"));
  await expect(canvas.locator('[data-poster-picture="soup"][src^="data:image/png"]')).toHaveCount(1);
  await view.locator('button[data-action="undo"]').click();
  await view.locator('button[data-action="undo"]').click();
  const soup = await (await canvasFrame(page)).evaluate(() => {
    const slot = document.querySelector('[data-poster-picture="soup"]') as HTMLImageElement;
    return { picture: slot.src.startsWith("data:image/png"), border: getComputedStyle(slot).borderTopStyle };
  });
  expect(soup).toEqual({ picture: false, border: "dashed" });
});

// openlore: scenario=TextIsTypedInAShape spec=poster-elements
// openlore: scenario=TheTextFollowsItsShape spec=poster-elements
test("TextIsTypedInAShape and TheTextFollowsItsShape: a double-clicked rectangle takes centred text, which moves and takes its colour with it", async ({ page }) => {
  const id = await createPoster("Text in a shape", MENU);
  const { view, canvas } = await show(page, id);
  await insert(view, "shape:rectangle");
  const rectangle = canvas.locator(".poster-shape.rectangle");
  await rectangle.dblclick();
  await page.keyboard.type("Entrée");
  await canvas.locator(".title").click();
  const text = rectangle.locator(".poster-shape-text");
  await expect(text).toHaveText("Entrée");
  const centred = async () => (await canvasFrame(page)).evaluate(() => {
    const shape = document.querySelector(".poster-shape.rectangle")!.getBoundingClientRect();
    const words = document.createRange();
    words.selectNodeContents(document.querySelector(".poster-shape.rectangle .poster-shape-text")!);
    const box = words.getBoundingClientRect();
    return { dx: Math.round(box.x + box.width / 2 - (shape.x + shape.width / 2)), dy: Math.round(box.y + box.height / 2 - (shape.y + shape.height / 2)) };
  });
  const offset = await centred();
  expect(Math.abs(offset.dx)).toBeLessThanOrEqual(2);
  expect(Math.abs(offset.dy)).toBeLessThanOrEqual(2);
  // The shape is still what a click selects and a drag moves; its text goes with it.
  await rectangle.click({ position: { x: 6, y: 6 } });
  await expect.poll(async () => (await canvasFrame(page)).evaluate(() => document.querySelector(".gjs-selected")?.className ?? "")).toMatch(/poster-shape rectangle/);
  await drag(page, rectangle, 40, 0, { x: 6, y: 6 });
  expect(await centred()).toEqual(offset);
  await view.locator('button[data-action="style"]').click();
  const colour = view.locator(".gjs-sm-property__color input").first();
  await colour.fill("#d32f2f");
  await colour.press("Enter");
  await expect.poll(async () => (await canvasFrame(page)).evaluate(() => getComputedStyle(document.querySelector(".poster-shape.rectangle .poster-shape-text")!).color)).toBe("rgb(211, 47, 47)");
  await save(view);
  expect(json(await callTool("get_poster", { id })).html).toMatch(/<div class="poster-shape-text"[^>]*>Entrée<\/div>/);
});

// openlore: scenario=TheTailPointsElsewhere spec=poster-elements
// openlore: scenario=TheTailIsKept spec=poster-elements
test("TheTailPointsElsewhere and TheTailIsKept: the yellow handle moves the bubble's tail above and to the right, and it stays there", async ({ page, browser }) => {
  const id = await createPoster("Bubble", MENU);
  const { view, canvas } = await show(page, id);
  await insert(view, "shape:speech-bubble");
  const handle = canvas.locator(".poster-tail-handle");
  await expect(handle).toBeVisible();
  const [bubble] = await boxes(page, ".poster-shape.speech-bubble");
  // At the default tip: 18 % across, 140 % down.
  const at = async () => (await canvasFrame(page)).evaluate(() => {
    const element = document.querySelector(".poster-tail-handle") as HTMLElement;
    return { x: parseFloat(element.style.left), y: parseFloat(element.style.top) };
  });
  const start = await at();
  expect(start.x).toBeCloseTo(bubble!.x + bubble!.width * 0.18, -1);
  expect(start.y).toBeCloseTo(bubble!.y + bubble!.height * 1.4, -1);
  // Dragged to above the bubble, to the right.
  const zoom = await zoomOf(view);
  const target = { x: bubble!.x + bubble!.width * 0.8, y: bubble!.y - 50 };
  await drag(page, handle, (target.x - start.x) * zoom, (target.y - start.y) * zoom);
  const tail = await (await canvasFrame(page)).evaluate(() => {
    const holder = document.querySelector(".poster-shape.speech-bubble")!;
    return { tail: holder.getAttribute("data-tail"), d: holder.querySelector("path")!.getAttribute("d") };
  });
  const [x, y] = tail.tail!.split(",").map(Number);
  expect(x).toBeCloseTo(80, -1);
  expect(y).toBeLessThan(0);
  // The tail now leaves the top side: the path reaches the tip right after its start on y = 0.
  expect(tail.d).toMatch(new RegExp(`^M 12 0 L \\d+ 0 L ${x} ${y} L \\d+ 0 L 88 0`));
  await expect.poll(at).toEqual({ x: expect.closeTo(target.x, -1), y: expect.closeTo(target.y, -1) });
  // Moving the bubble carries the handle with it.
  await canvas.locator(".poster-shape.speech-bubble").click({ position: { x: 30, y: 30 } });
  await drag(page, canvas.locator(".poster-shape.speech-bubble"), 0, 60, { x: 30, y: 30 });
  const [moved] = await boxes(page, ".poster-shape.speech-bubble");
  await expect.poll(async () => (await at()).y).toBeCloseTo(moved!.y + (moved!.height * y!) / 100, -1);
  await save(view);
  // Reopened, the tail is where it was left, and so is the handle.
  const again = await browser.newPage();
  const reopened = await show(again, id);
  const bubbleAgain = reopened.canvas.locator(".poster-shape.speech-bubble");
  expect(await bubbleAgain.getAttribute("data-tail")).toBe(`${x},${y}`);
  await bubbleAgain.click({ position: { x: 30, y: 30 } });
  await expect(reopened.canvas.locator(".poster-tail-handle")).toBeVisible();
  await again.close();
});

/** Where the page's edges are against the visible area, in screen pixels: positive inside, negative beyond. */
async function pageEdges(view: FrameLocator) {
  const area = (await view.locator(".poster-canvas").boundingBox())!;
  const frame = (await view.locator("iframe.gjs-frame").boundingBox())!;
  const height = frame.width * (1123 / 794);
  return { left: frame.x - area.x, right: area.x + area.width - (frame.x + frame.width), top: frame.y - area.y, bottom: area.y + area.height - (frame.y + height) };
}

async function scrollFar(page: Page, view: FrameLocator, dx: number, dy: number) {
  const area = (await view.locator(".poster-canvas").boundingBox())!;
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
  for (let i = 0; i < 15; i++) await page.mouse.wheel(dx / 15, dy / 15);
  await page.waitForTimeout(300);
}

// openlore: scenario=AFittedPageCannotBeScrolledAway spec=poster-editor
// openlore: scenario=AZoomedPageKeepsTheViewFilled spec=poster-editor
test("AFittedPageCannotBeScrolledAway and AZoomedPageKeepsTheViewFilled: scrolling far either way never leaves an empty desk", async ({ page }) => {
  const id = await createPoster("Pan");
  const { view } = await show(page, id);
  const directions: Array<[number, number]> = [[3000, 0], [-3000, 0], [0, 3000], [0, -3000]];
  for (const [dx, dy] of directions) {
    await scrollFar(page, view, dx, dy);
    const edges = await pageEdges(view);
    // Fitted: the whole page stays inside.
    for (const [side, value] of Object.entries(edges)) expect(value, `fitted, ${dx},${dy}, ${side}`).toBeGreaterThanOrEqual(-1);
  }
  for (let i = 0; i < 4; i++) await view.locator('button[data-action="zoom-in"]').click();
  const area = (await view.locator(".poster-canvas").boundingBox())!;
  const frame = (await view.locator("iframe.gjs-frame").boundingBox())!;
  const larger = { x: frame.width > area.width, y: frame.width * (1123 / 794) > area.height };
  expect(larger.y, "zoomed in, the page is taller than the view").toBe(true);
  for (const [dx, dy] of directions) {
    await scrollFar(page, view, dx, dy);
    const edges = await pageEdges(view);
    // On an axis where the page is larger than the view, no edge comes more than the 16 px
    // margin inside; where it is still smaller, it stays wholly inside.
    for (const [side, value] of Object.entries(edges)) {
      const axisLarger = side === "left" || side === "right" ? larger.x : larger.y;
      if (axisLarger) expect(value, `zoomed, ${dx},${dy}, ${side}`).toBeLessThanOrEqual(17);
      else expect(value, `zoomed, ${dx},${dy}, ${side}`).toBeGreaterThanOrEqual(-1);
    }
  }
});

test("the Format panel's number arrows step by one per click, whatever the pointer does between press and release", async ({ page }) => {
  const id = await createPoster("Font size", MENU);
  const { view, canvas } = await show(page, id);
  await canvas.locator("h1.title").click();
  await view.locator('button[data-action="style"]').click();
  const field = view.locator(".gjs-sm-property__font-size");
  const size = field.locator("input").first();
  await expect(size).toHaveValue("48");
  const drawn = async () => (await canvasFrame(page)).evaluate(() => getComputedStyle(document.querySelector("h1.title")!).fontSize);
  // A click whose pointer wanders down two pixels, as on a trackpad: up still means one more.
  const press = async (arrow: "u" | "d", dy: number, dx = 0) => {
    const box = (await field.locator(".gjs-field-arrows").boundingBox())!;
    const x = box.x + box.width / 2 + dx;
    const y = box.y + (arrow === "u" ? 3 : box.height - 3);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + dy);
    await page.mouse.up();
  };
  await press("u", 2);
  await expect(size).toHaveValue("49");
  await press("u", -2);
  await expect(size).toHaveValue("50");
  await press("d", -2);
  await expect(size).toHaveValue("49");
  // Each arrow takes its half of the field's height, its width beyond the 7-pixel triangle.
  await press("u", 0, 6);
  await expect(size).toHaveValue("50");
  await press("d", 0, -6);
  await expect(size).toHaveValue("49");
  expect(await drawn()).toBe("49px");
});

test("the Format panel shows what a rule on a parent draws, and its arrows step from there", async ({ page }) => {
  const id = await createPoster("Drawn style", MENU);
  const { view, canvas } = await show(page, id);
  // `.cell h2` names no class of the heading: GrapesJS alone showed medium, Arial, black.
  await canvas.locator(".cell.c1 h2").click();
  await view.locator('button[data-action="style"]').click();
  const field = (name: string) => view.locator(`.gjs-sm-property__${name}`);
  await expect(field("font-size").locator("input").first()).toHaveValue("28");
  await expect(field("font-family").locator("select")).toHaveValue("Verdana, Geneva, sans-serif");
  // Shown, not written: nothing changed until the person changes it.
  await expect(view.locator('button[data-action="save"]')).toBeDisabled();
  const drawn = async () => (await canvasFrame(page)).evaluate(() => getComputedStyle(document.querySelector(".cell.c1 h2")!).fontSize);
  await field("font-size").locator(".gjs-field-arrow-u").click();
  await expect.poll(drawn).toBe("29px");
  // Typed below nothing, a text keeps a size.
  const size = field("font-size").locator("input").first();
  await size.fill("-5");
  await size.press("Enter");
  await expect.poll(drawn).toBe("1px");
  await save(view);
  const css = json(await callTool("get_poster", { id })).css as string;
  expect(css).toMatch(/font-size:\s*1px/);
  expect(css).not.toMatch(/font-family:\s*Verdana, Geneva/);
});

test("the Format panel follows the editor's theme, its fields readable in both", async ({ page }) => {
  const id = await createPoster("Panel theme", MENU);
  const { view, canvas } = await show(page, id, "light");
  await canvas.locator(".cell.c1 h2").click();
  await view.locator('button[data-action="style"]').click();
  const paint = async () => view.locator(".gjs-sm-property__border-radius input").first().evaluate((input) => {
    // The panel's ground, under sectors that paint none of their own
    let ground: Element | null = input;
    while (ground && getComputedStyle(ground).backgroundColor === "rgba(0, 0, 0, 0)") ground = ground.parentElement;
    return { text: getComputedStyle(input).color, panel: ground ? getComputedStyle(ground).backgroundColor : "none" };
  });
  // GrapesJS's own: light grey text on #444, whatever the editor's theme
  expect(await paint()).toEqual({ text: "rgb(31, 35, 40)", panel: "rgb(246, 248, 250)" });
  await page.evaluate(() => window.setHostTheme("dark"));
  await expect.poll(paint).toEqual({ text: "rgb(230, 237, 243)", panel: "rgb(43, 43, 41)" });
});

test("a colour typed that is no colour is refused with the reason, the last one kept", async ({ page }) => {
  const id = await createPoster("Bad colour", MENU);
  const { view, canvas } = await show(page, id);
  await canvas.locator(".cell.c1 h2").click();
  await view.locator('button[data-action="style"]').click();
  const colour = view.locator(".gjs-sm-property__color input").first();
  const drawn = async () => (await canvasFrame(page)).evaluate(() => getComputedStyle(document.querySelector(".cell.c1 h2")!).color);
  await colour.fill("red");
  await colour.press("Enter");
  await expect.poll(drawn).toBe("rgb(255, 0, 0)");
  await colour.fill("#12");
  await colour.press("Enter");
  await expect(view.locator(".poster-status")).toHaveText(/“#12” is not a colour/);
  await expect(colour).toHaveValue("red");
  expect(await drawn()).toBe("rgb(255, 0, 0)");
});

test("line spacing reads and steps as a multiple of the text's size", async ({ page }) => {
  const id = await createPoster("Line spacing", MENU);
  const { view, canvas } = await show(page, id);
  await canvas.locator(".cell.c1 h2").click();
  await view.locator('button[data-action="style"]').click();
  const spacing = view.locator(".gjs-sm-property__line-height input").first();
  // normal, shown as the 1.2 it is close to
  await expect(spacing).toHaveValue("1.2");
  const drawn = async () => (await canvasFrame(page)).evaluate(() => getComputedStyle(document.querySelector(".cell.c1 h2")!).lineHeight);
  await spacing.fill("1.5");
  await spacing.press("Enter");
  await expect.poll(drawn).toBe("42px");
  await view.locator(".gjs-sm-property__line-height .gjs-field-arrow-u").click();
  await expect(spacing).toHaveValue("1.6");
  await expect.poll(drawn).toBe("44.8px");
});

test("the colour picker of a swatch low in the panel opens against it, inside the window", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 640 });
  const id = await createPoster("Picker", MENU);
  const { view, canvas } = await show(page, id);
  await canvas.locator(".cell.c1 h2").click();
  await view.locator('button[data-action="style"]').click();
  const swatch = view.locator(".gjs-sm-property__border .gjs-field-colorp").first();
  await swatch.scrollIntoViewIfNeeded();
  await swatch.click();
  const picker = view.locator(".sp-container:not(.sp-hidden)");
  await expect(picker).toBeVisible();
  // In the view's own frame: its window is what the picker must stay inside
  const fits = await picker.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const at = document.querySelector(".gjs-sm-property__border .gjs-field-colorp")!.getBoundingClientRect();
    return { inside: box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth, against: Math.abs(box.top - at.bottom) < 12 || Math.abs(box.bottom - at.top) < 12 };
  });
  expect(fits).toEqual({ inside: true, against: true });
// openlore: scenario=ADiagramPictureElsewhereStillAsksForAFile spec=poster-elements
test("ADiagramPictureElsewhereStillAsksForAFile: in a host that draws no diagrams, a diagram's picture is filled like any other", async ({ page }) => {
  const DIAGRAM = {
    html: MENU.html.replace('<img class="slot" data-poster-picture="bread" alt="bread">', '<img class="slot" data-poster-picture="bread" data-drawio="../diagrams/flow.drawio" alt="bread">'),
    css: MENU.css,
  };
  const id = await createPoster("Diagram elsewhere", DIAGRAM);
  const { canvas } = await show(page, id);
  await choose(page, () => canvas.locator('[data-poster-picture="bread"]').dblclick(), await pictureFile("bread.png", 400, 300, "png"));
  await expect(canvas.locator('[data-poster-picture="bread"][src^="data:image/png;base64,"]')).toHaveCount(1);
});
