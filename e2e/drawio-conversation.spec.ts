/**
 * A .drawio file in a reply, as somebody reads and touches it up: drawn in place by
 * draw.io's own viewer, its controls like every other diagram's, and touch-ups saved back
 * into the file — read back from disk, since only the file says what was really saved.
 *
 * Every gesture is a real mouse or keyboard event on the drawn shapes: the viewer, its
 * sandbox and mxGraph's handlers only meet in a browser.
 */
import { expect, test, type Frame, type Locator, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { SERVICES_DIAGRAM, SERVICES_DIAGRAM_PATH, SERVICES_SECOND_PAGE } from "./fixtures/drawio-conversation";

const FILE = () => path.join(process.env.PI_E2E_DRAWIO_CHAT_ROOT!, SERVICES_DIAGRAM_PATH);

// The specs write the file; each starts from the fixture
test.describe.configure({ mode: "serial" });
test.beforeEach(async () => {
  await writeFile(FILE(), SERVICES_DIAGRAM);
});

async function openReply(page: Page): Promise<Locator> {
  await page.goto(process.env.PI_E2E_DRAWIO_CHAT_URL!);
  // The services diagram's block, by its frame: the gone one is a block too until its read fails
  const block = page.getByTestId("drawio-block-reply").filter({ has: page.getByTitle(SERVICES_DIAGRAM_PATH, { exact: true }) });
  await expect(block).toBeVisible();
  return block;
}

async function frameOf(frame: Locator): Promise<Frame> {
  await expect(frame).toBeVisible();
  return (await (await frame.elementHandle())!.contentFrame())!;
}

/**
 * Starts a touch-up and waits until the frame has it. The click only tells the frame,
 * by a message, to turn the editor on; until that lands, a gesture or a measurement
 * meets the viewer, which edits nothing. The graph's container taking `tabindex="-1"`
 * (`startTouchUp` in ui/src/util/drawioPage.ts) is the editor being on.
 */
async function touchUp(scope: Locator, frame: Locator): Promise<Frame> {
  await scope.getByRole("button", { name: "✎ touch up" }).click();
  const inner = await frameOf(frame);
  await expect.poll(() => inner.evaluate(() => document.querySelector("[tabindex='-1']") !== null)).toBe(true);
  return inner;
}

/** The labels drawn, once each. */
function labels(frame: Frame): Promise<string[]> {
  return frame.evaluate(() => [...new Set([...document.querySelectorAll("svg foreignObject div")].filter((d) => d.querySelector("div") === null).map((d) => d.textContent?.trim() ?? "").filter(Boolean))]);
}

/** Where a shape's label is drawn, in page coordinates. */
async function centreOf(page: Page, frame: Locator, label: string): Promise<{ x: number; y: number }> {
  const inner = await frameOf(frame);
  const box = (await frame.boundingBox())!;
  const point = await inner.evaluate((name) => {
    const el = [...document.querySelectorAll("svg foreignObject div")].find((d) => d.querySelector("div") === null && d.textContent?.trim() === name);
    const r = el!.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, label);
  return { x: box.x + point.x, y: box.y + point.y };
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

/** A cell of the file's first page, as saved on disk. */
async function savedCell(id: string): Promise<string> {
  const text = await readFile(FILE(), "utf8");
  const match = new RegExp(`<mxCell id="${id}"[^>]*?(?:/>|>[\\s\\S]*?</mxCell>)`).exec(text);
  return match?.[0] ?? "";
}

// openlore: scenario=AReferencedDiagramIsDrawnInTheReply spec=drawio-diagrams
test("AReferencedDiagramIsDrawnInTheReply: the reply draws the file, isolated, with the controls of every diagram", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const block = await openReply(page);
  const frame = block.getByTestId("drawio-frame");
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  await expect.poll(async () => labels(await frameOf(frame))).toEqual(["Alpha", "Bravo", "Charlie"]);
  await expect(block.getByRole("button")).toHaveText(["⤢ enlarge", "⤓ download SVG", "⤓ download .drawio", "↗ open"]);
  // Drawn as a diagram, not fetched as a picture, and not inside a paragraph
  await expect(page.locator("img")).toHaveCount(0);
  expect(await block.evaluate((element) => element.closest("p"))).toBeNull();
  expect(errors).toEqual([]);
});

// openlore: scenario=AMissingDiagramSaysSo spec=drawio-diagrams
test("AMissingDiagramSaysSo: a referenced file that is gone is named, with no empty frame", async ({ page }) => {
  await openReply(page);
  await expect(page.getByTestId("drawio-block-missing")).toContainText("The diagram diagrams/gone.drawio could not be shown");
  await expect(page.getByTestId("drawio-frame")).toHaveCount(1);
});

// openlore: scenario=DownloadSvgSavesThePageShown spec=drawio-diagrams
// openlore: scenario=DownloadDrawioSavesTheFile spec=drawio-diagrams
test("DownloadSvgSavesThePageShown: the page shown as SVG with its labels as text, and the file as it is", async ({ page }) => {
  const block = await openReply(page);
  await expect.poll(async () => labels(await frameOf(block.getByTestId("drawio-frame")))).toContain("Alpha");

  const svgDownload = page.waitForEvent("download");
  await block.getByRole("button", { name: "⤓ download SVG" }).click();
  const svg = await svgDownload;
  expect(svg.suggestedFilename()).toBe("services-Services.svg");
  const markup = await readFile((await svg.path())!, "utf8");
  expect(markup).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>\n<svg /);
  // Each label also as plain SVG text, for readers that ignore foreignObject (Word)
  for (const label of ["Alpha", "Bravo", "Charlie"]) expect(markup).toMatch(new RegExp(`<text[^>]*>${label}</text>`));

  const fileDownload = page.waitForEvent("download");
  await block.getByRole("button", { name: "⤓ download .drawio" }).click();
  const file = await fileDownload;
  expect(file.suggestedFilename()).toBe("services.drawio");
  expect(await readFile((await file.path())!, "utf8")).toBe(SERVICES_DIAGRAM);
});

// openlore: scenario=EnlargeShowsTheDiagramAtFullSize spec=drawio-diagrams
test("EnlargeShowsTheDiagramAtFullSize: over the application, with its downloads, and back where it was", async ({ page }) => {
  const block = await openReply(page);
  await block.getByRole("button", { name: "Show diagram at full size" }).click();
  const overlay = page.getByTestId("drawio-enlarged");
  await expect(overlay).toBeVisible();
  const full = overlay.getByTitle(`${SERVICES_DIAGRAM_PATH}, full size`);
  await expect.poll(async () => labels(await frameOf(full))).toEqual(["Alpha", "Bravo", "Charlie"]);
  const size = (await full.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(size.width).toBeGreaterThan(viewport.width * 0.8);
  await expect(overlay.getByRole("button", { name: "⤓ download SVG" })).toBeVisible();
  await expect(overlay.getByRole("button", { name: "⤓ download .drawio" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(overlay).toHaveCount(0);
  await expect(block).toBeVisible();
});

// openlore: scenario=OpenTheFileFromTheReply spec=drawio-diagrams
test("OpenTheFileFromTheReply: the file opens in the file viewer, drawn there too", async ({ page }) => {
  const block = await openReply(page);
  await block.getByRole("button", { name: "↗ open" }).click();
  const viewer = page.getByTestId("drawio-block-viewer");
  await expect(viewer).toBeVisible();
  await expect(page.getByText(SERVICES_DIAGRAM_PATH, { exact: true }).first()).toBeVisible();
  await expect.poll(async () => labels(await frameOf(viewer.getByTestId("drawio-frame")))).toEqual(["Alpha", "Bravo", "Charlie"]);
});

// openlore: scenario=ReadingIsReadOnly spec=drawio-diagrams
test("ReadingIsReadOnly: dragging a shape outside touch-up moves nothing", async ({ page }) => {
  const block = await openReply(page);
  await block.getByRole("button", { name: "↗ open" }).click();
  const frame = page.getByTestId("drawio-block-viewer").getByTestId("drawio-frame");
  await expect.poll(async () => labels(await frameOf(frame))).toContain("Alpha");
  const before = await centreOf(page, frame, "Alpha");
  await drag(page, before, { x: before.x + 100, y: before.y + 60 });
  expect(await centreOf(page, frame, "Alpha")).toEqual(before);
  expect(await readFile(FILE(), "utf8")).toBe(SERVICES_DIAGRAM);
});

// openlore: scenario=ShapesMoveAndConnectorsFollow spec=drawio-diagrams
// openlore: scenario=UndoRestoresTheDiagram spec=drawio-diagrams
// openlore: scenario=SavingKeepsTheRestOfTheFile spec=drawio-diagrams
test("ShapesMoveAndConnectorsFollow: a shape moved in the file viewer is saved on the grid, its wire still on it, the rest untouched", async ({ page }) => {
  const block = await openReply(page);
  await block.getByRole("button", { name: "↗ open" }).click();
  const viewer = page.getByTestId("drawio-block-viewer");
  const frame = viewer.getByTestId("drawio-frame");
  await expect.poll(async () => labels(await frameOf(frame))).toContain("Alpha");
  await touchUp(viewer, frame);
  await expect(viewer.getByRole("button", { name: "✓ save" })).toBeDisabled();

  const alpha = await centreOf(page, frame, "Alpha");
  await drag(page, alpha, { x: alpha.x + 3, y: alpha.y + 97 });
  await expect(page.getByTestId("drawio-touchup-status")).toHaveText("● unsaved");
  // Undo by keyboard puts it back, redo brings the move again
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => centreOf(page, frame, "Alpha")).toEqual(alpha);
  await viewer.getByRole("button", { name: "↷ redo" }).click();
  await expect.poll(async () => (await centreOf(page, frame, "Alpha")).y).toBeGreaterThan(alpha.y + 50);

  await viewer.getByRole("button", { name: "✓ save" }).click();
  await expect(page.getByTestId("drawio-touchup-status")).not.toHaveText("● unsaved");
  // On the grid, though the drop was not; the wire still from A to B; the other page byte for byte
  await expect.poll(() => savedCell("a")).toMatch(/<mxGeometry[^>]*x="40"[^>]*y="1[34]0"/);
  expect(await savedCell("a-b")).toMatch(/source="a"[^>]*target="b"|target="b"[^>]*source="a"/);
  const text = await readFile(FILE(), "utf8");
  expect(text).toContain(SERVICES_SECOND_PAGE);
  expect(text).toMatch(/<mxGraphModel[^>]*pageWidth="1169"/);
  expect(await savedCell("c")).toMatch(/x="320"[^>]*y="220"|y="220"[^>]*x="320"/);
});

// openlore: scenario=AConnectorIsReattached spec=drawio-diagrams
// openlore: scenario=ALabelIsEditedInPlace spec=drawio-diagrams
test("AConnectorIsReattached: at full size, a wire's end moved to another shape and a label retyped are saved", async ({ page }) => {
  const block = await openReply(page);
  await block.getByRole("button", { name: "Show diagram at full size" }).click();
  const overlay = page.getByTestId("drawio-enlarged");
  const frame = overlay.getByTitle(`${SERVICES_DIAGRAM_PATH}, full size`);
  await expect.poll(async () => labels(await frameOf(frame))).toContain("Bravo");
  await touchUp(overlay, frame);
  await expect(overlay.getByRole("button", { name: "✓ save" })).toBeVisible();

  // Select the wire on its path, then drag its end handle from Bravo onto Charlie
  const inner = await frameOf(frame);
  const box = (await frame.boundingBox())!;
  const onWire = await inner.evaluate(() => {
    // The page's only connector, A→B: boxes are <rect>s, a wire is the visible unfilled path
    const wire = [...document.querySelectorAll<SVGPathElement>("svg path[fill='none']")].find((p) => p.getAttribute("visibility") !== "hidden" && p.getTotalLength() > 50)!;
    const at = wire.getPointAtLength(wire.getTotalLength() / 2);
    const m = wire.getScreenCTM()!;
    const end = wire.getPointAtLength(wire.getTotalLength());
    return { mid: { x: at.x * m.a + m.e, y: at.y * m.d + m.f }, end: { x: end.x * m.a + m.e, y: end.y * m.d + m.f } };
  });
  await page.mouse.click(box.x + onWire.mid.x, box.y + onWire.mid.y);
  const charlie = await centreOf(page, frame, "Charlie");
  await drag(page, { x: box.x + onWire.end.x + 2, y: box.y + onWire.end.y }, charlie);

  // Retype Bravo's label in place — off its centre: the re-attached wire now runs through
  // the middle of Bravo, and a double-click on a wire gives the wire a label instead
  const bravo = await centreOf(page, frame, "Bravo");
  await page.mouse.dblclick(bravo.x - 45, bravo.y + 18);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Bravo v2");
  await page.mouse.click(box.x + box.width - 20, box.y + box.height - 20);

  await overlay.getByRole("button", { name: "✓ save" }).click();
  await expect.poll(() => savedCell("a-b")).toMatch(/target="c"/);
  expect(await savedCell("b")).toContain('value="Bravo v2"');
});

// openlore: scenario=AFileChangedOnDiskIsNotOverwritten spec=drawio-diagrams
// openlore: scenario=UnsavedTouchUpIsNotLostSilently spec=drawio-diagrams
test("AFileChangedOnDiskIsNotOverwritten: a file changed meanwhile is refused, and leaving asks first", async ({ page }) => {
  const block = await openReply(page);
  await block.getByRole("button", { name: "↗ open" }).click();
  const viewer = page.getByTestId("drawio-block-viewer");
  const frame = viewer.getByTestId("drawio-frame");
  await expect.poll(async () => labels(await frameOf(frame))).toContain("Alpha");
  await touchUp(viewer, frame);
  const alpha = await centreOf(page, frame, "Alpha");
  await drag(page, alpha, { x: alpha.x, y: alpha.y + 100 });
  await expect(page.getByTestId("drawio-touchup-status")).toHaveText("● unsaved");

  const outside = SERVICES_DIAGRAM.replace('value="Charlie"', 'value="Charlie, by someone else"');
  await writeFile(FILE(), outside);
  await viewer.getByRole("button", { name: "✓ save" }).click();
  await expect(page.getByTestId("drawio-touchup-problem")).toContainText("changed on disk, or was removed, since this touch-up began");
  expect(await readFile(FILE(), "utf8")).toBe(outside);

  // Leaving asks; refusing keeps the touch-up, agreeing drops it and shows the file as it is
  page.once("dialog", (dialog) => void dialog.dismiss());
  await viewer.getByRole("button", { name: "done" }).click();
  await expect(viewer.getByRole("button", { name: "✓ save" })).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  await viewer.getByRole("button", { name: "done" }).click();
  await expect(viewer.getByRole("button", { name: "✎ touch up" })).toBeVisible();
  await expect.poll(async () => labels(await frameOf(frame))).toContain("Charlie, by someone else");
});

// openlore: scenario=TheReplyFollowsTheFile spec=drawio-diagrams
test("TheReplyFollowsTheFile: the reply redraws the file when it is saved", async ({ page }) => {
  const block = await openReply(page);
  const frame = block.getByTestId("drawio-frame");
  await expect.poll(async () => labels(await frameOf(frame))).toContain("Alpha");
  await writeFile(FILE(), SERVICES_DIAGRAM.replace('value="Alpha"', 'value="Alpha, renamed"'));
  await expect.poll(async () => labels(await frameOf(frame))).toContain("Alpha, renamed");
});

test("a box dragged past the drawing's edge stays in reach: the page grows, as draw.io's does", async ({ page }) => {
  const block = await openReply(page);
  await block.getByRole("button", { name: "↗ open" }).click();
  const viewer = page.getByTestId("drawio-block-viewer");
  const frame = viewer.getByTestId("drawio-frame");
  await expect.poll(async () => labels(await frameOf(frame))).toContain("Charlie");
  const inner = await touchUp(viewer, frame);
  const areaBefore = await inner.evaluate(() => (document.querySelector("[tabindex='-1']") as HTMLElement).offsetHeight);
  const box = (await frame.boundingBox())!;
  const charlie = await centreOf(page, frame, "Charlie");
  // Down to the frame's bottom edge, past the drawing area the viewer sized at load
  await drag(page, charlie, { x: charlie.x, y: box.y + box.height - 5 });
  await expect.poll(() => inner.evaluate(() => (document.querySelector("[tabindex='-1']") as HTMLElement).offsetHeight)).toBeGreaterThan(areaBefore);
  // Still drawn inside the area, so it can be grabbed again
  const reach = await inner.evaluate(() => {
    const area = (document.querySelector("[tabindex='-1']") as HTMLElement).getBoundingClientRect();
    const label = [...document.querySelectorAll("svg foreignObject div")].find((d) => d.querySelector("div") === null && d.textContent?.trim() === "Charlie")!.getBoundingClientRect();
    return label.bottom <= area.bottom;
  });
  expect(reach).toBe(true);
});

test("a new wire drawn from a shape's edge, and a shape deleted with the keyboard, are saved", async ({ page }) => {
  const block = await openReply(page);
  await block.getByRole("button", { name: "↗ open" }).click();
  const viewer = page.getByTestId("drawio-block-viewer");
  const frame = viewer.getByTestId("drawio-frame");
  await expect.poll(async () => labels(await frameOf(frame))).toContain("Charlie");
  const inner = await touchUp(viewer, frame);
  const box = (await frame.boundingBox())!;
  // First Bravo, selected and deleted from the keyboard — its wire goes with it, as in draw.io
  const bravo = await centreOf(page, frame, "Bravo");
  await page.mouse.click(bravo.x - 45, bravo.y + 18);
  await page.keyboard.press("Delete");
  await expect.poll(async () => labels(inner)).not.toContain("Bravo");

  // Hovering Charlie shows its connection points, draw.io's small marks on the outline;
  // a wire starts from one — the one in the middle of its right side — and ends on Alpha
  const charlie = await centreOf(page, frame, "Charlie");
  await page.mouse.move(charlie.x + 5, charlie.y + 5, { steps: 3 });
  const marks = await inner.evaluate(() => [...document.querySelectorAll("svg image")].map((i) => i.getBoundingClientRect()).filter((r) => r.width > 0 && r.width < 12).map((r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 })));
  expect(marks.length).toBeGreaterThan(4);
  const right = marks.sort((p, q) => q.x - p.x || Math.abs(p.y - (charlie.y - box.y)) - Math.abs(q.y - (charlie.y - box.y)))[0];
  const alpha = await centreOf(page, frame, "Alpha");
  await page.mouse.move(box.x + right.x, box.y + right.y, { steps: 3 });
  await drag(page, { x: box.x + right.x, y: box.y + right.y }, alpha);
  await expect(page.getByTestId("drawio-touchup-status")).toHaveText("● unsaved");
  await viewer.getByRole("button", { name: "✓ save" }).click();
  await expect.poll(() => readFile(FILE(), "utf8")).not.toContain('value="Bravo"');
  const text = await readFile(FILE(), "utf8");
  expect(text).toMatch(/<mxCell [^>]*edge="1"[^>]*source="c"[^>]*target="a"|<mxCell [^>]*source="c"[^>]*target="a"[^>]*edge="1"/);
});

test("Escape while touching up is \"done\": it leaves the touch-up, asking first, and nothing else", async ({ page }) => {
  const block = await openReply(page);
  await block.getByRole("button", { name: "Show diagram at full size" }).click();
  const overlay = page.getByTestId("drawio-enlarged");
  const frame = overlay.getByTitle(`${SERVICES_DIAGRAM_PATH}, full size`);
  await expect.poll(async () => labels(await frameOf(frame))).toContain("Alpha");
  await touchUp(overlay, frame);
  const alpha = await centreOf(page, frame, "Alpha");
  await drag(page, alpha, { x: alpha.x, y: alpha.y + 80 });
  await expect(page.getByTestId("drawio-touchup-status")).toHaveText("● unsaved");
  // The keyboard is in the frame after the drag: its Escape is "done", which asks — once
  // per Escape, answered in turn: no, then yes
  const answers = [false, true];
  const asked: string[] = [];
  page.on("dialog", (dialog) => {
    asked.push(dialog.message());
    void (answers.shift() ? dialog.accept() : dialog.dismiss());
  });
  await page.keyboard.press("Escape");
  await expect.poll(() => asked.length).toBe(1);
  await expect(overlay.getByRole("button", { name: "✓ save" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect.poll(() => asked.length).toBe(2);
  await expect(overlay.getByRole("button", { name: "✎ touch up" })).toBeVisible();
  expect(asked).toEqual(["Discard the unsaved touch-ups to this diagram?", "Discard the unsaved touch-ups to this diagram?"]);
  // Still at full size, the touch-up dropped and the file untouched
  await expect(overlay).toBeVisible();
  expect(await readFile(FILE(), "utf8")).toBe(SERVICES_DIAGRAM);
  // Out of touch-up, Escape closes the view
  await page.keyboard.press("Escape");
  await expect(overlay).toHaveCount(0);
});

/** The services diagram with its wires drawn as `style` says: Alpha wired to Bravo and to Charlie. */
function wiredDiagram(style: string): string {
  const wire = (id: string, target: string) => `        <mxCell id="${id}" edge="1" parent="1" source="a" target="${target}" style="${style}html=1;endArrow=block;">\n          <mxGeometry relative="1" as="geometry"/>\n        </mxCell>`;
  return SERVICES_DIAGRAM.replace(/ {8}<mxCell id="a-b"[\s\S]*?<\/mxCell>/, `${wire("a-b", "b")}\n${wire("a-c", "c")}`);
}

/** The visible wires' midpoints, in page coordinates. */
async function wireMidpoints(frame: Locator): Promise<Array<{ x: number; y: number }>> {
  const inner = await frameOf(frame);
  const box = (await frame.boundingBox())!;
  const points = await inner.evaluate(() => [...document.querySelectorAll<SVGPathElement>("svg path[fill='none']")]
    .filter((p) => p.getAttribute("visibility") !== "hidden" && p.getTotalLength() > 50)
    .map((wire) => {
      const at = wire.getPointAtLength(wire.getTotalLength() / 2);
      const m = wire.getScreenCTM()!;
      return { x: at.x * m.a + m.e, y: at.y * m.d + m.f };
    }));
  return points.map((point) => ({ x: box.x + point.x, y: box.y + point.y }));
}

/** The services diagram with two orthogonal wires from Alpha, each bent through two waypoints. */
function bentDiagram(): string {
  const wire = (id: string, target: string, bends: string) =>
    `        <mxCell id="${id}" edge="1" parent="1" source="a" target="${target}" style="edgeStyle=orthogonalEdgeStyle;html=1;endArrow=block;">\n          <mxGeometry relative="1" as="geometry"><Array as="points">${bends}</Array></mxGeometry>\n        </mxCell>`;
  return SERVICES_DIAGRAM.replace(
    / {8}<mxCell id="a-b"[\s\S]*?<\/mxCell>/,
    `${wire("a-b", "b", '<mxPoint x="300" y="40"/><mxPoint x="300" y="120"/>')}\n${wire("a-c", "c", '<mxPoint x="100" y="260"/><mxPoint x="200" y="260"/>')}`,
  );
}

/**
 * The handle of a wire's first segment, on screen: an orthogonal wire's handles sit in the middle
 * of its segments, between the first two vertices of its path.
 */
async function firstSegmentHandleOnScreen(frame: Locator, wireIndex: number): Promise<{ x: number; y: number }> {
  const inner = await frameOf(frame);
  const box = (await frame.boundingBox())!;
  const at = await inner.evaluate((index) => {
    const wires = [...document.querySelectorAll<SVGPathElement>("svg path[fill='none']")].filter((p) => p.getAttribute("visibility") !== "hidden" && p.getTotalLength() > 50);
    const wire = wires[index]!;
    const numbers = (wire.getAttribute("d") ?? "").match(/-?\d+(\.\d+)?/g)!.map(Number);
    const m = wire.getScreenCTM()!;
    const x = (numbers[0]! + numbers[2]!) / 2;
    const y = (numbers[1]! + numbers[3]!) / 2;
    return { x: x * m.a + m.e, y: y * m.d + m.f };
  }, wireIndex);
  return { x: box.x + at.x, y: box.y + at.y };
}

// openlore: scenario=TheBendsOfWiresAreRemoved spec=drawio-diagrams
test("TheBendsOfWiresAreRemoved: remove bends clears every wire's waypoints, one undo puts them back, and the save writes them gone", async ({ page }) => {
  await writeFile(FILE(), bentDiagram());
  await (await openReply(page)).getByRole("button", { name: "↗ open" }).click();
  const block = page.getByTestId("drawio-block-viewer");
  const frame = block.getByTestId("drawio-frame");
  await expect.poll(async () => labels(await frameOf(frame))).toContain("Charlie");
  await touchUp(block, frame);
  const remove = block.getByRole("button", { name: "remove bends" });
  await expect(remove).toBeEnabled();
  await remove.click();
  await expect(block.getByTestId("drawio-touchup-status")).toHaveText("● unsaved");
  // Nothing left to remove
  await expect(remove).toBeDisabled();
  await block.getByRole("button", { name: "↶ undo" }).click();
  await expect(remove).toBeEnabled();
  await block.getByRole("button", { name: "↷ redo" }).click();
  await expect(remove).toBeDisabled();
  await block.getByRole("button", { name: "✓ save" }).click();
  await expect.poll(() => savedCell("a-b")).not.toContain("mxPoint");
  expect(await savedCell("a-c")).not.toContain("mxPoint");
  // The style stays: only the bends went
  expect(await savedCell("a-b")).toContain("edgeStyle=orthogonalEdgeStyle");
});

// openlore: scenario=ABendIsRemovedByClickAndDelete spec=drawio-diagrams
test("ABendIsRemovedByClickAndDelete: in touch-up, a bend clicked then Delete removes that bend only, and the wire stays", async ({ page }) => {
  await writeFile(FILE(), bentDiagram());
  const block = await openReply(page);
  await block.getByRole("button", { name: "Show diagram at full size" }).click();
  const overlay = page.getByTestId("drawio-enlarged");
  const frame = overlay.getByTitle(`${SERVICES_DIAGRAM_PATH}, full size`);
  await expect.poll(async () => labels(await frameOf(frame))).toContain("Charlie");
  await touchUp(overlay, frame);
  const wires = await wireMidpoints(frame);
  await page.mouse.click(wires[0]!.x, wires[0]!.y);
  // The first segment runs from Alpha to the first waypoint: Delete takes that waypoint out
  const handle = await firstSegmentHandleOnScreen(frame, 0);
  await page.mouse.click(handle.x, handle.y);
  await page.keyboard.press("Delete");
  // A second press does not go on to delete the wire still selected
  await page.keyboard.press("Delete");
  await expect(overlay.getByTestId("drawio-touchup-status")).toHaveText("● unsaved");
  await overlay.getByRole("button", { name: "✓ save" }).click();
  // One wire lost one of its two bends; the other kept both; both wires are still there
  await expect.poll(async () => [await savedCell("a-b"), await savedCell("a-c")].map((cell) => (cell.match(/<mxPoint /g) ?? []).length).sort()).toEqual([1, 2]);
  expect(await savedCell("a-b")).toContain('edge="1"');
  expect(await savedCell("a-c")).toContain('edge="1"');
});

// openlore: scenario=EveryWireIsRestyled spec=drawio-diagrams
test("EveryWireIsRestyled: with nothing selected, every wire of the page changes style, one undo takes it back, and the save writes it", async ({ page }) => {
  await writeFile(FILE(), wiredDiagram("edgeStyle=none;"));
  await (await openReply(page)).getByRole("button", { name: "↗ open" }).click();
  const block = page.getByTestId("drawio-block-viewer");
  const frame = block.getByTestId("drawio-frame");
  await expect.poll(async () => labels(await frameOf(frame))).toContain("Charlie");
  await touchUp(block, frame);
  const control = block.getByRole("combobox", { name: "Wire style" });
  await expect(control).toHaveValue("straight");
  await control.selectOption("orthogonal");
  await expect(control).toHaveValue("orthogonal");
  await expect(block.getByTestId("drawio-touchup-status")).toHaveText("● unsaved");
  await block.getByRole("button", { name: "↶ undo" }).click();
  await expect(control).toHaveValue("straight");
  await expect(block.getByTestId("drawio-touchup-status")).not.toHaveText("● unsaved");
  await block.getByRole("button", { name: "↷ redo" }).click();
  await expect(control).toHaveValue("orthogonal");
  await block.getByRole("button", { name: "✓ save" }).click();
  await expect.poll(() => savedCell("a-b")).toContain("edgeStyle=orthogonalEdgeStyle");
  expect(await savedCell("a-c")).toContain("edgeStyle=orthogonalEdgeStyle");
});

// openlore: scenario=OnlyTheSelectedWiresAreRestyled spec=drawio-diagrams
test("OnlyTheSelectedWiresAreRestyled: a wire clicked, then curved, is the only one curved", async ({ page }) => {
  await writeFile(FILE(), wiredDiagram("edgeStyle=orthogonalEdgeStyle;"));
  const block = await openReply(page);
  await block.getByRole("button", { name: "Show diagram at full size" }).click();
  const overlay = page.getByTestId("drawio-enlarged");
  const frame = overlay.getByTitle(`${SERVICES_DIAGRAM_PATH}, full size`);
  await expect.poll(async () => labels(await frameOf(frame))).toContain("Charlie");
  await touchUp(overlay, frame);
  const wires = await wireMidpoints(frame);
  expect(wires).toHaveLength(2);
  await page.mouse.click(wires[0]!.x, wires[0]!.y);
  const control = overlay.getByRole("combobox", { name: "Wire style" });
  await expect(control).toHaveValue("orthogonal");
  await control.selectOption("curved");
  await expect(control).toHaveValue("curved");
  await overlay.getByRole("button", { name: "✓ save" }).click();
  await expect.poll(async () => [await savedCell("a-b"), await savedCell("a-c")].filter((cell) => cell.includes("curved=1")).length).toBe(1);
  expect([await savedCell("a-b"), await savedCell("a-c")].every((cell) => cell.includes("edgeStyle=orthogonalEdgeStyle"))).toBe(true);
});

// openlore: scenario=NewWiresFollowThePage spec=drawio-diagrams
test("NewWiresFollowThePage: on a page of straight wires, a wire drawn from Charlie to Alpha is straight", async ({ page }) => {
  await writeFile(FILE(), SERVICES_DIAGRAM.replace("edgeStyle=orthogonalEdgeStyle;", "edgeStyle=none;"));
  const block = await openReply(page);
  await block.getByRole("button", { name: "↗ open" }).click();
  const viewer = page.getByTestId("drawio-block-viewer");
  const frame = viewer.getByTestId("drawio-frame");
  await expect.poll(async () => labels(await frameOf(frame))).toContain("Charlie");
  const inner = await touchUp(viewer, frame);
  await expect(viewer.getByRole("combobox", { name: "Wire style" })).toHaveValue("straight");
  const box = (await frame.boundingBox())!;
  const charlie = await centreOf(page, frame, "Charlie");
  await page.mouse.move(charlie.x + 5, charlie.y + 5, { steps: 3 });
  const marks = await inner.evaluate(() => [...document.querySelectorAll("svg image")].map((i) => i.getBoundingClientRect()).filter((r) => r.width > 0 && r.width < 12).map((r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 })));
  const right = marks.sort((p, q) => q.x - p.x || Math.abs(p.y - (charlie.y - box.y)) - Math.abs(q.y - (charlie.y - box.y)))[0]!;
  const alpha = await centreOf(page, frame, "Alpha");
  await page.mouse.move(box.x + right.x, box.y + right.y, { steps: 3 });
  await drag(page, { x: box.x + right.x, y: box.y + right.y }, alpha);
  await expect(page.getByTestId("drawio-touchup-status")).toHaveText("● unsaved");
  await viewer.getByRole("button", { name: "✓ save" }).click();
  await expect.poll(async () => /<mxCell [^>]*source="c"[^>]*target="a"/.test(await readFile(FILE(), "utf8"))).toBe(true);
  const added = /<mxCell [^>]*source="c"[^>]*target="a"[^>]*>|<mxCell [^>]*style="[^"]*"[^>]*source="c"[^>]*>/.exec(await readFile(FILE(), "utf8"))![0];
  expect(added).toContain("edgeStyle=none");
  expect(added).not.toContain("orthogonalEdgeStyle");
});
