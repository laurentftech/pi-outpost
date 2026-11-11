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

test("keeps composer drafts with their project across a real workspace switch", async ({ page }) => {
  const composer = page.getByRole("textbox", { name: /message pi/i });
  await composer.fill("primary draft");

  await page.getByTitle(/^Project:/).click();
  await page.getByRole("menuitem").filter({ hasText: process.env.PI_E2E_SECOND_PROJECT! }).click();
  await expect(composer).toHaveValue("");
  await composer.fill("second draft");

  await page.getByTitle(/^Project:/).click();
  await page.getByRole("menuitem").filter({ hasText: process.env.PI_E2E_PRIMARY_PROJECT! }).click();
  await expect(composer).toHaveValue("primary draft");
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

/**
 * The return-to-latest control, in a conversation with something to scroll.
 *
 * On the seeded server rather than the default one: the offline workspace has an
 * empty transcript, and a viewport with nothing above it can never leave the
 * near-bottom region. Placement and stickiness are the two claims jsdom cannot
 * make — it computes no layout, so a control that travelled with the transcript
 * or resolved its position against the wrong box would look identical there.
 */
test.describe("the return-to-latest control", () => {
  const CONTROL = "Scroll to the latest message";

  test.beforeEach(async ({ page }) => {
    await page.goto(process.env.PI_E2E_DIAGRAMS_URL!);
    await expect(page.getByTitle("connected")).toBeVisible();
    // The seeded transcript arrives over the socket; wait for it before scrolling.
    await expect(page.locator("[data-item-index]").first()).toBeVisible();
  });

  const scroller = (page: import("@playwright/test").Page) => page.locator("main");

  async function scrollTo(page: import("@playwright/test").Page, top: number) {
    await scroller(page).evaluate((main, value) => {
      main.scrollTop = value;
    }, top);
  }

  // openlore: scenario=FixedAboveComposer spec=conversation-scroll-navigation
  test("stays put above the composer while the transcript scrolls under it", async ({ page }) => {
    await scrollTo(page, 0);
    const control = page.getByRole("button", { name: CONTROL });
    await expect(control).toBeVisible();

    const before = (await control.boundingBox())!;
    const composer = (await page.locator("footer").boundingBox())!;
    expect(before.y + before.height).toBeLessThanOrEqual(composer.y);

    await scrollTo(page, 600);
    // A child of the scroller would have travelled 600px by now.
    const after = (await control.boundingBox())!;
    expect(after.y).toBeCloseTo(before.y, 0);
    expect(after.x).toBeCloseTo(before.x, 0);
  });

  test("returns to the end of the transcript and takes itself away", async ({ page }) => {
    await scrollTo(page, 0);
    await page.getByRole("button", { name: CONTROL }).click();

    await expect(page.getByRole("button", { name: CONTROL })).toHaveCount(0);
    await expect
      .poll(() =>
        scroller(page).evaluate((main) => main.scrollHeight - main.scrollTop - main.clientHeight),
      )
      .toBeLessThan(120);
  });

  test("does not flicker back on through the frames of its own scroll", async ({ page }) => {
    // The browser animates `behavior: "smooth"` over many frames, each emitting a
    // scroll event that still reports a viewport far from the end. jsdom fires
    // none of them, so this is the only place the flicker was ever visible.
    await scrollTo(page, 0);
    await page.getByRole("button", { name: CONTROL }).click();

    const samples = await page.evaluate(async () => {
      const seen: boolean[] = [];
      for (let i = 0; i < 60; i++) {
        seen.push(!!document.querySelector('button[aria-label="Scroll to the latest message"]'));
        await new Promise((r) => requestAnimationFrame(r));
      }
      return seen;
    });

    // The first sample can still catch the frame the click landed on.
    expect(samples.slice(1).some(Boolean)).toBe(false);
  });

  test("gives the scroll back to a reader who changes their mind mid-return", async ({ page }) => {
    await scrollTo(page, 0);
    await page.getByRole("button", { name: CONTROL }).click();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    await page.locator("main").evaluate((main) => {
      main.dispatchEvent(new WheelEvent("wheel", { deltaY: -400, bubbles: true }));
      main.scrollTop = 100;
    });

    await expect(page.getByRole("button", { name: CONTROL })).toBeVisible();
  });

  // openlore: scenario=KeyboardActivation spec=conversation-scroll-navigation
  test("answers the keyboard, not only the pointer", async ({ page }) => {
    // jsdom dispatches no click from a keydown, so this is the only place the
    // claim that the control is keyboard-operable is actually tested.
    // Establish the starting position before moving into scrollback.
    const distanceFromEnd = () =>
      scroller(page).evaluate((main) => main.scrollHeight - main.scrollTop - main.clientHeight);
    await scroller(page).evaluate((main) => { main.scrollTop = main.scrollHeight; });
    await expect.poll(distanceFromEnd).toBeLessThan(120);
    await scrollTo(page, 0);
    const control = page.getByRole("button", { name: CONTROL });
    await expect(control).toBeVisible();
    await control.focus();
    await expect(control).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(control).toHaveCount(0);
    await expect.poll(distanceFromEnd).toBeLessThan(120);
  });

  // openlore: scenario=ComposerStaysUsable spec=conversation-scroll-navigation
  test("leaves the composer usable underneath it", async ({ page }) => {
    await scrollTo(page, 0);
    await expect(page.getByRole("button", { name: CONTROL })).toBeVisible();

    const box = page.getByRole("textbox", { name: /message/i });
    await box.click();
    await box.fill("typed past the control");

    await expect(box).toHaveValue("typed past the control");
    // Clicking into the composer is not a scroll: the control is still there.
    await expect(page.getByRole("button", { name: CONTROL })).toBeVisible();
  });
});
