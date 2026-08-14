/**
 * The standalone app, served by a real server, loaded in a real browser.
 *
 * 847 UI tests render these components in jsdom, where a stylesheet that was
 * never emitted is invisible, an effect that throws during cleanup is caught by
 * the test renderer, and a WebSocket is a fake that is kinder than the real one.
 * This spec asserts the three things only a browser can see: the bundle loads,
 * the socket connects, and the interface is styled.
 *
 * It does not talk to a model — the server runs with PI_OFFLINE, so there is no
 * turn to have. What is under test is the wiring, which is what breaks silently.
 */
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto(process.env.PI_E2E_SERVER_URL!);
});

test("loads and connects to the server that served it", async ({ page }) => {
  // The connection badge only reaches this state through an open WebSocket
  await expect(page.getByTitle("connected")).toBeVisible();
  await expect(page.getByRole("textbox", { name: /message pi/i })).toBeVisible();
});

test("renders with its stylesheet applied", async ({ page }) => {
  // #38 shipped an interface that built cleanly and styled nothing. The composer
  // is laid out by Tailwind utilities, so an unstyled build leaves it at the
  // browser's default `display: block` with no padding.
  const composer = page.getByRole("textbox", { name: /message pi/i });
  await expect(composer).toBeVisible();

  const padding = await composer.evaluate((element) => getComputedStyle(element).paddingLeft);
  expect(padding).not.toBe("0px");
});

test("reaches the workspace the server was given", async ({ page }) => {
  await page.getByTitle("Show files").click();
  await expect(page.getByText("readme.md")).toBeVisible();
});

test("reports no console error while loading", async ({ page }) => {
  // A blank page with a clean network tab is the shape the PdfViewer regression
  // took: the app unmounted itself and only the console said so.
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.reload();
  await expect(page.getByTitle("connected")).toBeVisible();

  expect(errors).toEqual([]);
});
