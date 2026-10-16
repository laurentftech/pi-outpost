import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

/** What the browser paints each coloured shape with, beside the colour the figure carries. */
async function paints(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((svg) =>
    [...svg.querySelectorAll("rect, path, line, text")]
      .filter((shape) => /^#[0-9a-f]{6}$/i.test(shape.getAttribute("fill") ?? ""))
      .map((shape) => ({ declared: shape.getAttribute("fill")!, painted: getComputedStyle(shape).fill })),
  );
}

const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)).join(", ")})`;

/** Relative luminance of a computed `rgb(…)`. */
function luminance(painted: string): number {
  const [r, g, b] = painted.match(/\d+/g)!.slice(0, 3).map((value) => {
    const channel = Number(value) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The reader's own choice: the diagrams server configures a light default, which a stored preference overrides. */
async function openIn(page: Page, theme: "light" | "dark") {
  await page.addInitScript((chosen) => localStorage.setItem("pi-outpost:theme", chosen), theme);
  await page.goto(process.env.PI_E2E_DIAGRAMS_URL!);
}

const GRAPH = 'svg[aria-label^="Graph of"]';
const SEQUENCE = 'svg[aria-label^="Sequence of"]';
const TIMELINE = '[data-testid="timeline-body"]';

test.describe("structured-exchange figures at night", () => {
  test("AFigureFollowsTheDarkTheme: the ground turns dark and the ink light, in graphs, sequences and timelines", async ({ page }) => {
    await openIn(page, "dark");
    for (const selector of [GRAPH, SEQUENCE, TIMELINE]) {
      await expect(page.locator(selector).first()).toBeVisible();
      const shapes = await paints(page, selector);
      const ground = shapes.find((shape) => shape.declared.toLowerCase() === "#ffffff");
      expect(ground, selector).toBeDefined();
      // The figure still says white; the screen paints the dark ground of a Mermaid card.
      expect(luminance(ground!.painted), selector).toBeLessThan(0.02);
      // Nothing is left in its day colour: every colour the figure carries is turned.
      for (const shape of shapes) {
        if (shape.declared.toLowerCase() === "#ffffff") continue;
        expect(shape.painted, `${selector} ${shape.declared}`).not.toBe(rgb(shape.declared));
      }
    }
    // Labels read on that ground.
    const label = await page.locator(GRAPH).first().locator("text").last().evaluate((text) => getComputedStyle(text).fill);
    expect(luminance(label)).toBeGreaterThan(0.2);
    // The timeline's frame — its labels, legend and controls — is dark with it.
    const frame = await page.getByTestId("timeline").first().evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(frame).not.toBe("rgb(255, 255, 255)");
  });

  test("AFigureOnALightPageIsUnchanged: every shape is painted the colour the figure carries", async ({ page }) => {
    await openIn(page, "light");
    for (const selector of [GRAPH, SEQUENCE, TIMELINE]) {
      await expect(page.locator(selector).first()).toBeVisible();
      const shapes = await paints(page, selector);
      expect(shapes.length, selector).toBeGreaterThan(0);
      for (const shape of shapes) expect(shape.painted, `${selector} ${shape.declared}`).toBe(rgb(shape.declared));
    }
  });

  test("ADownloadedFigureKeepsItsDayColours: a graph saved from a dark page is the light figure", async ({ page }) => {
    await openIn(page, "dark");
    const graph = page.locator(GRAPH).first();
    await expect(graph).toBeVisible();
    const card = graph.locator('xpath=ancestor::*[.//button[contains(., "download SVG")]][1]');
    const saved = page.waitForEvent("download");
    await card.getByRole("button", { name: /download SVG/ }).first().click();
    const markup = await readFile((await (await saved).path())!, "utf8");
    expect(markup).not.toContain("light-dark");
    expect(markup).not.toMatch(/style="[^"]*(fill|stroke)/);
    expect(markup).toContain('fill="#ffffff"');

    const timelineSaved = page.waitForEvent("download");
    await page.getByTestId("timeline-download-svg").first().click();
    const timeline = await readFile((await (await timelineSaved).path())!, "utf8");
    expect(timeline).not.toContain("light-dark");
    expect(timeline).toContain('fill="#ffffff"');
  });

  for (const theme of ["light", "dark"] as const) {
    test(`ATableKeyShowsItsRoleColours (${theme}): every swatch is outlined in its own colour, which stands off the page`, async ({ page }) => {
      await openIn(page, theme);
      const key = page.getByTestId("table-role-key").first();
      await expect(key).toBeVisible();
      const swatches = await key.evaluate((element) => {
        const ground = getComputedStyle(element.closest("[data-theme]") ?? document.body).backgroundColor;
        // Compared as pixels, since Tailwind's colours compute as oklch().
        const canvas = document.createElement("canvas").getContext("2d")!;
        const pixel = (colour: string) => {
          canvas.clearRect(0, 0, 1, 1);
          canvas.fillStyle = colour;
          canvas.fillRect(0, 0, 1, 1);
          return Array.from(canvas.getImageData(0, 0, 1, 1).data.slice(0, 3));
        };
        return {
          ground: pixel(ground === "rgba(0, 0, 0, 0)" ? getComputedStyle(document.body).backgroundColor : ground),
          roles: [...element.querySelectorAll<HTMLElement>("[data-role-swatch]")].map((swatch) => ({
            role: swatch.dataset.roleSwatch!,
            edge: pixel(getComputedStyle(swatch).borderTopColor),
            width: Number.parseFloat(getComputedStyle(swatch).borderTopWidth),
          })),
        };
      });
      const distance = (one: number[], other: number[]) => Math.max(...one.map((value, index) => Math.abs(value - other[index])));
      expect(swatches.roles.map((swatch) => swatch.role)).toEqual(expect.arrayContaining(["added", "changed"]));
      for (const swatch of swatches.roles) {
        expect(swatch.width, swatch.role).toBeGreaterThanOrEqual(2);
        expect(distance(swatch.edge, swatches.ground), swatch.role).toBeGreaterThan(80);
      }
      for (const [index, swatch] of swatches.roles.entries()) {
        for (const other of swatches.roles.slice(index + 1)) {
          expect(distance(swatch.edge, other.edge), `${swatch.role} / ${other.role}`).toBeGreaterThan(40);
        }
      }
    });
  }
});
