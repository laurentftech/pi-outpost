/**
 * A graph opened as a file keeps its arrangement beside it, in the running app
 * (structured-exchange-arrangement): drawn in straight runs, a box dragged is kept in
 * `<document>.arrangement.json`, the document's bytes are untouched, and reopening draws the
 * box where it was left.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Frame, type Locator, type Page } from "@playwright/test";

const DOCUMENT = `${JSON.stringify(
  {
    schema: "urn:structured-exchange:1",
    kind: "graph",
    data: {
      nodes: [
        { id: "battery", label: "Battery" },
        { id: "inverter", label: "Inverter" },
        { id: "motor", label: "Motor" },
        { id: "ecu", label: "ECU" },
      ],
      edges: [
        { from: "battery", to: "inverter", kind: "power", label: "400 V" },
        { from: "inverter", to: "motor", kind: "power", label: "three-phase" },
        { from: "ecu", to: "inverter", kind: "control", label: "torque" },
      ],
    },
  },
  null,
  2,
)}\n`;

async function openGraph(page: Page, name: string): Promise<{ file: string; arrangement: string }> {
  const directory = path.join(process.env.PI_E2E_PRIMARY_PROJECT!, "arranged");
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, name);
  await writeFile(file, DOCUMENT);
  await page.goto(process.env.PI_E2E_SERVER_URL!);
  await expect(page.getByTitle("connected")).toBeVisible();
  await page.getByTitle("Show files").click();
  await page.getByText("arranged", { exact: true }).click();
  await page.getByText(name, { exact: true }).click();
  await expect(page.getByTestId("file-structured-exchange").locator('[data-draggable="node"]')).toHaveCount(4);
  return { file, arrangement: file.replace(/\.json$/, ".arrangement.json") };
}

/** Where a box is drawn, in figure units, by its label. */
const boxAt = (page: Page, label: string) =>
  page.getByTestId("file-structured-exchange").locator('[data-draggable="node"]', { hasText: label }).first().locator("rect").first().evaluate((rect) => ({ x: Number(rect.getAttribute("x")), y: Number(rect.getAttribute("y")) }));

// openlore: scenario=AMovedBoxIsKeptInTheArrangement spec=structured-exchange-arrangement
test("AMovedBoxIsKeptInTheArrangement: dragged in the running app, kept beside the document, drawn there on reopening", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const { file, arrangement } = await openGraph(page, "car.json");

  // Every relationship drawn in straight runs
  for (const d of await page.getByTestId("file-structured-exchange").locator('path[data-edge="line"]').evaluateAll((paths) => paths.map((p) => p.getAttribute("d")!))) {
    expect(d).toMatch(/^M [\d.-]+ [\d.-]+( L [\d.-]+ [\d.-]+)+$/);
  }

  const before = await boxAt(page, "ECU");
  const box = (await page.getByTestId("file-structured-exchange").locator('[data-draggable="node"]', { hasText: "ECU" }).first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 60, { steps: 6 });
  await page.mouse.up();

  // Kept beside the document; the document's bytes untouched
  await expect.poll(() => readFile(arrangement, "utf8").catch(() => ""), { timeout: 10_000 }).toContain('"id:ecu"');
  expect(await readFile(file, "utf8")).toBe(DOCUMENT);
  const kept = JSON.parse(await readFile(arrangement, "utf8"));
  expect(kept.format).toBe("pi-outpost/structured-exchange-arrangement-1");
  const moved = kept.views[""].elements["id:ecu"];
  expect(moved.y).toBeGreaterThan(before.y);
  expect(await boxAt(page, "ECU")).toEqual(moved);

  // Reopened from scratch: drawn where it was left
  await page.reload();
  await expect(page.getByTitle("connected")).toBeVisible();
  // The files panel stays open across a reload; the folder does not stay expanded
  if (!(await page.getByText("arranged", { exact: true }).isVisible())) await page.getByTitle("Show files").click();
  await page.getByText("arranged", { exact: true }).click();
  await page.getByText("car.json", { exact: true }).click();
  await expect.poll(() => boxAt(page, "ECU")).toEqual(moved);
  expect(errors).toEqual([]);
});

/** The labels the touch-up frame draws, once each. */
const frameLabels = (frame: Frame) =>
  frame.evaluate(() => [...new Set([...document.querySelectorAll("svg foreignObject div")].filter((d) => d.querySelector("div") === null).map((d) => d.textContent?.trim() ?? "").filter(Boolean))]);

/** Where the touch-up frame draws a box's label, in page coordinates. */
async function labelCentre(frame: Frame, element: Locator, label: string) {
  const box = (await element.boundingBox())!;
  const point = await frame.evaluate((name) => {
    const el = [...document.querySelectorAll("svg foreignObject div")].find((d) => d.querySelector("div") === null && d.textContent?.trim() === name)!;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, label);
  return { x: box.x + point.x, y: box.y + point.y };
}

// openlore: scenario=ATouchUpIsReadBackByIdentity spec=structured-exchange-arrangement
// openlore: scenario=AContentEditInDrawioIsNotAModelChange spec=structured-exchange-arrangement
test("ATouchUpIsReadBackByIdentity: arranged in the vendored draw.io touch-up, a box moved is kept and a label retyped is not", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const { file, arrangement } = await openGraph(page, "touched.json");
  await page.getByRole("button", { name: "✎ arrange in draw.io" }).click();
  const element = page.getByTitle("Arrange in draw.io");
  await expect(element).toBeVisible();
  const frame = (await (await element.elementHandle())!.contentFrame())!;
  await expect.poll(() => frameLabels(frame)).toContain("Motor");
  // The editor is on once its container takes the keyboard
  await expect.poll(() => frame.evaluate(() => document.querySelector("[tabindex='-1']") !== null)).toBe(true);

  // Drag the motor down
  const motor = await labelCentre(frame, element, "Motor");
  await page.mouse.move(motor.x, motor.y);
  await page.mouse.down();
  await page.mouse.move(motor.x, motor.y + 120, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByTestId("structured-touchup-status")).toHaveText("● not kept yet");

  // Retype the inverter's label in place: content, which is not kept
  const inverter = await labelCentre(frame, element, "Inverter");
  await page.mouse.dblclick(inverter.x, inverter.y);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Onduleur");
  const box = (await element.boundingBox())!;
  await page.mouse.click(box.x + box.width - 20, box.y + box.height - 20);

  await page.getByRole("button", { name: "✓ keep" }).click();
  await expect.poll(() => readFile(arrangement, "utf8").catch(() => ""), { timeout: 10_000 }).toContain('"id:motor"');
  expect(await readFile(file, "utf8")).toBe(DOCUMENT);
  await expect(page.getByTestId("structured-arrangement-note")).toHaveText(/^Kept the arrangement\. Not kept: the text of "Inverter" was changed to "Onduleur"/);
  const kept = JSON.parse(await readFile(arrangement, "utf8")).views[""].elements;

  await expect(page.getByTestId("structured-touchup-status")).not.toHaveText("● not kept yet");
  await page.getByRole("button", { name: "done" }).click();
  await expect(page.getByTestId("structured-touchup")).toHaveCount(0);
  // Drawn with what was kept: the motor where it was put, the inverter still called Inverter
  await expect.poll(() => boxAt(page, "Motor")).toEqual(kept["id:motor"]);
  await expect(page.getByTestId("file-structured-exchange").locator('[data-draggable="node"]', { hasText: "Inverter" })).toHaveCount(1);
  expect(errors).toEqual([]);
});
