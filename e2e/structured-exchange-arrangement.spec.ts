/**
 * A graph opened as a file keeps its arrangement beside it, in the running app
 * (structured-exchange-arrangement): drawn in straight runs, a box dragged is kept in
 * `<document>.arrangement.json`, the document's bytes are untouched, and reopening draws the
 * box where it was left.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

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
