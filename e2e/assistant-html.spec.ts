/**
 * Raw HTML in a reply, in a real browser.
 *
 * jsdom cannot answer the two questions that matter here. It does not execute a
 * script or an event handler, so "the handler was stripped" and "the handler was
 * kept but inert" look identical in the unit suite; and it has no cascade, so a
 * `<style>` rule that escaped into the page would leave every assertion passing
 * while the transcript was invisible. Chromium answers both.
 *
 * The seeded transcript ends with the message this is about: an extension's
 * sources block, followed by the constructs a reply must never be able to use.
 */
import { expect, test, type Page } from "@playwright/test";

/** The host page, pointed at the backend whose session already holds that message. */
async function openHost(page: Page): Promise<void> {
  const url = new URL(process.env.PI_E2E_HOST_URL!);
  url.searchParams.set("server", process.env.PI_E2E_DIAGRAMS_URL!);
  url.searchParams.set("theme", "light");
  await page.goto(url.toString());
}

/** Inside the widget's shadow tree, which is where the transcript lives. */
function shadow(page: Page) {
  return page.locator("#widget");
}

test.beforeEach(async ({ page }) => {
  await openHost(page);
  await expect(page.getByTitle("connected")).toBeVisible();
});

test("an extension's sources section renders as a real disclosure element", async ({ page }) => {
  const details = shadow(page).locator("details.source-list");
  await expect(details).toBeVisible();

  // Not markup shown as text: the summary is an element, and the body it hides
  // is not on screen until it is opened.
  await expect(details.locator("summary")).toHaveText("Sources (2)");
  await expect(details.locator("pre.source-content")).toBeHidden();

  await details.locator("summary").click();
  await expect(details.locator("pre.source-content")).toHaveText(
    "the alternator feeds the dash through the ecu",
  );
  await expect(details.locator("a.source-link").first()).toHaveAttribute(
    "href",
    "https://example.com/doc-42",
  );
  // The class hook on tags the default allow-list narrows — the list, its items
  // and the links inside them — is what a host page styles the section through.
  await expect(details.locator("ul.source-items li.source-item")).toHaveCount(2);

  await details.locator("summary").click();
  await expect(details.locator("pre.source-content")).toBeHidden();
});

test("nothing in the same reply executes", async ({ page }) => {
  // The message carries a <script>, an onerror on an image whose src really does
  // 404, and a javascript: href. Give the image time to fail before reading back.
  const probe = shadow(page).locator('img[alt="probe"]');
  await expect(probe).toBeVisible();
  await expect
    .poll(async () => probe.evaluate((image: HTMLImageElement) => image.complete))
    .toBe(true);

  // Located by text, not by role: the filter took the href off, so it is no
  // longer a link at all — which is the first thing to assert about it.
  const defused = shadow(page).getByText("do not follow");
  await expect(defused).toBeVisible();
  expect(await defused.getAttribute("href")).toBeNull();
  await defused.click();

  const damage = await page.evaluate(() => {
    const root = document.querySelector("#widget")!.shadowRoot!;
    return {
      pwned: (window as unknown as { __outpostPwned?: string }).__outpostPwned ?? null,
      scripts: root.querySelectorAll("script").length,
      iframes: root.querySelectorAll("iframe").length,
      // Counted by content, not by tag: mermaid puts a legitimate <style> inside
      // every diagram's SVG, so the question is whether the reply's rule landed.
      injectedStyleRules: [...root.querySelectorAll("style")].filter((style) =>
        (style.textContent ?? "").includes("prose-chat"),
      ).length,
      forms: root.querySelectorAll("form").length,
      tokenInputs: root.querySelectorAll('input[name="token"]').length,
      handlers: root.querySelectorAll("[onerror], [onclick], [onload]").length,
      // The reply asked for this id; a namespaced one is what may reach the page
      askedForId: root.querySelectorAll("#clobber-probe").length,
      namespacedId: root.querySelectorAll("#user-content-clobber-probe").length,
    };
  });

  expect(damage).toEqual({
    pwned: null,
    scripts: 0,
    iframes: 0,
    injectedStyleRules: 0,
    forms: 0,
    tokenInputs: 0,
    handlers: 0,
    askedForId: 0,
    namespacedId: 1,
  });

  // The page did not navigate away on the javascript: link either
  expect(new URL(page.url()).pathname).toBe("/");
});

test("the reply cannot restyle the conversation around it", async ({ page }) => {
  // `<style>.prose-chat { display: none }</style>` in the message. If it landed,
  // every message in the transcript would be gone while the DOM still held them.
  const section = shadow(page).locator("details.source-list");
  await expect(section).toBeVisible();

  const covered = await page.evaluate(() => {
    const root = document.querySelector("#widget")!.shadowRoot!;
    const blocks = [...root.querySelectorAll(".prose-chat")];
    const shadowed = root.querySelector("#user-content-clobber-probe");
    return {
      blocks: blocks.length,
      hidden: blocks.filter((block) => getComputedStyle(block).display === "none").length,
      // The style *attribute* is filtered too, so nothing covers the viewport
      probePosition: shadowed ? getComputedStyle(shadowed).position : "absent",
    };
  });

  expect(covered.blocks).toBeGreaterThan(0);
  expect(covered.hidden).toBe(0);
  expect(covered.probePosition).toBe("static");
});

test("the diagrams and maths already in the transcript still render", async ({ page }) => {
  // The filter sees the whole tree, markdown-generated nodes included, so the
  // rest of the transcript is the regression surface.
  await expect(shadow(page).locator("svg[id^='mermaid-']").first()).toBeVisible();
  await expect(shadow(page).getByRole("button", { name: /Show graph view at full size/ }).first()).toBeVisible();
});
