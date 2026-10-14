import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("MermaidActionsMatchOtherDiagrams: visible actions and a portable SVG of the turned diagram", async ({ page }) => {
  await page.goto(process.env.PI_E2E_DIAGRAMS_URL!);
  const enlarge = page.getByRole("button", { name: "Show diagram at full size", exact: true });
  await expect(enlarge).toBeVisible();
  const diagram = enlarge.locator("../..");
  const action = diagram.getByRole("button", { name: /download SVG/ });
  await expect(action).toBeVisible();
  const before = await action.evaluate((element) => {
    const style = getComputedStyle(element);
    return { opacity: style.opacity, decoration: style.textDecorationLine, top: element.getBoundingClientRect().top };
  });
  expect(before.opacity).toBe("1");
  expect(before.decoration).toContain("underline");
  const svgBottom = await diagram.locator("svg").evaluate((element) => element.getBoundingClientRect().bottom);
  expect(before.top).toBeGreaterThanOrEqual(svgBottom);

  await diagram.getByTestId("mermaid-orientation").click();
  await expect(diagram.getByTestId("mermaid-orientation")).toHaveAccessibleName("Turn the diagram portrait");
  // Rapid opposite clicks while rendering must settle back to the chosen direction.
  await diagram.getByTestId("mermaid-orientation").click();
  await diagram.getByTestId("mermaid-orientation").click();
  await expect(diagram.getByTestId("mermaid-orientation")).toHaveAccessibleName("Turn the diagram portrait");
  await enlarge.click();
  const overlay = page.getByTestId("mermaid-enlarged");
  const downloadButton = overlay.getByRole("button", { name: /download SVG/ });
  const initialPosition = await downloadButton.boundingBox();
  const viewport = overlay.getByRole("region", { name: "diagram content" });
  await viewport.evaluate((element) => { element.scrollLeft = element.scrollWidth; element.scrollTop = element.scrollHeight; });
  expect(await viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  expect(await downloadButton.boundingBox()).toEqual(initialPosition);
  const viewportBounds = await viewport.boundingBox();
  expect(initialPosition!.y).toBeGreaterThanOrEqual(viewportBounds!.y + viewportBounds!.height);
  expect(Math.abs(initialPosition!.x - viewportBounds!.x)).toBeLessThan(2);
  const saved = page.waitForEvent("download");
  await downloadButton.click();
  const download = await saved;
  expect(download.suggestedFilename()).toBe("diagram.svg");
  const file = await download.path();
  expect(file).not.toBeNull();
  const markup = await readFile(file!, "utf8");
  expect(markup).not.toMatch(/<foreignObject|<style/);
  expect(markup).toMatch(/width="[\d.]+"/);
  expect(markup).toMatch(/height="[\d.]+"/);
  for (const label of ["Browser", "WebSocket", "Workspace", "Sessions"]) expect(markup).toContain(label);
  const viewBox = /viewBox="[\d. -]+ ([\d.]+) ([\d.]+)"/.exec(markup);
  expect(viewBox).not.toBeNull();
  expect(Number(viewBox![1])).toBeGreaterThan(Number(viewBox![2]));
  await page.keyboard.press("Escape");
  await expect(overlay).toHaveCount(0);
  await expect(diagram.locator("svg")).toBeVisible();
});
