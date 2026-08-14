/**
 * The widget, mounted into a page that is not ours.
 *
 * Everything here is invisible to the unit suites by construction: jsdom has no
 * Shadow DOM worth the name, no cascade to isolate, and no separate origin. The
 * host page fights the widget on purpose — `* { color: red }`, `all: unset` on
 * every control, a `box-sizing` the reset disagrees with — because that is what
 * a design system does to anything it embeds.
 */
import { expect, test, type Page } from "@playwright/test";

/** The host page with the backend it should talk to. */
async function openHost(page: Page): Promise<void> {
  const url = new URL(process.env.PI_E2E_HOST_URL!);
  url.searchParams.set("server", process.env.PI_E2E_SERVER_URL!);
  await page.goto(url.toString());
}

test.beforeEach(async ({ page }) => {
  await openHost(page);
});

test("mounts inside a shadow root and connects across origins", async ({ page }) => {
  // Playwright pierces shadow roots, so the widget's own controls are reachable
  await expect(page.getByRole("textbox", { name: /message pi/i })).toBeVisible();
  await expect(page.getByTitle("connected")).toBeVisible();

  const shape = await page.evaluate(() => {
    const shadow = document.querySelector("#widget")!.shadowRoot;
    return {
      open: shadow !== null,
      // The app is mounted under #root inside the shadow tree, not in the document
      rootInside: shadow?.querySelector("#root") !== null,
      rootInDocument: document.querySelector("#widget > #root") !== null,
    };
  });
  expect(shape).toEqual({ open: true, rootInside: true, rootInDocument: false });
});

test("carries its stylesheet as an adopted sheet, not a <style> element", async ({ page }) => {
  // Chrome drops <style> over ~512 KB inside a shadow root and Tailwind v4 is
  // ~1.5 MB, so the widget uses constructable sheets. Falling back silently
  // would leave it unstyled in exactly the browsers it targets.
  const sheets = await page.evaluate(() => {
    const shadow = document.querySelector("#widget")!.shadowRoot!;
    return {
      adopted: shadow.adoptedStyleSheets.length,
      rules: shadow.adoptedStyleSheets[0]?.cssRules.length ?? 0,
    };
  });
  expect(sheets.adopted).toBe(1);
  expect(sheets.rules).toBeGreaterThan(100);
});

test("the host page's styles do not reach into the widget", async ({ page }) => {
  const composer = page.getByRole("textbox", { name: /message pi/i });
  await expect(composer).toBeVisible();

  const colour = await composer.evaluate((element) => getComputedStyle(element).color);
  // The host paints every element red; the widget's text must not be
  expect(colour).not.toBe("rgb(255, 0, 0)");

  // `all: unset` on the host's controls would flatten the widget's buttons too
  const button = page.getByTitle("Show files");
  const background = await button.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(background).not.toBe("rgb(255, 0, 255)");
});

test("the widget's reset does not reach out into the host page", async ({ page }) => {
  // Tailwind's preflight sets margin: 0 on every element. Leaking out of the
  // shadow tree would silently restyle the page that embedded us.
  const host = await page.locator("#host-text").evaluate((element) => ({
    margin: getComputedStyle(element).marginTop,
    family: getComputedStyle(element).fontFamily,
  }));
  expect(host.margin).not.toBe("0px");
  expect(host.family).toContain("Comic Sans MS");
});

test("setTheme switches the widget without touching the host", async ({ page }) => {
  // The theme lands as data-theme on the container the host handed us — the
  // widget needs a cascade root, and it takes the one it was given rather than
  // document.documentElement, which would be the host page's.
  const readTheme = () =>
    page.evaluate(() => ({
      widget: (document.querySelector("#widget") as HTMLElement).dataset.theme ?? "",
      hostBackground: getComputedStyle(document.body).backgroundColor,
    }));

  const light = await readTheme();
  expect(light.widget).toBe("light");

  await page.evaluate(() => window.__embed.setTheme("dark"));
  await expect.poll(async () => (await readTheme()).widget).toBe("dark");

  // The host's own background is the host's business
  expect((await readTheme()).hostBackground).toBe(light.hostBackground);
});

test("unmount empties the shadow root and leaves the container", async ({ page }) => {
  await expect(page.getByRole("textbox", { name: /message pi/i })).toBeVisible();

  const after = await page.evaluate(() => {
    window.__embed.unmount();
    const container = document.querySelector("#widget");
    return {
      containerStillThere: container !== null,
      shadowChildren: container?.shadowRoot?.querySelector("#root")?.childElementCount ?? -1,
    };
  });
  expect(after.containerStillThere).toBe(true);
  expect(after.shadowChildren).toBe(0);
});

test("mounting reports no console error", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    // The known /branding CORS failure has a test of its own below; counting it
    // here too would make one defect fail two tests and hide the next one.
    if (message.type() === "error" && !/branding|ERR_FAILED/.test(message.text())) {
      errors.push(message.text());
    }
  });
  await openHost(page);
  await expect(page.getByTitle("connected")).toBeVisible();

  expect(errors).toEqual([]);
});

test.fail(
  "the branding request survives the origin the widget was mounted from",
  async ({ page }) => {
    /*
     * KNOWN GAP — this test is expected to fail, and says why.
     *
     * The server never emits an Access-Control-Allow-Origin header. `allowedOrigins`
     * gates the WebSocket handshake and the Host check, and nothing else, so
     * GET /branding answers 200 to a cross-origin fetch and the browser then
     * discards the response.
     *
     * The widget still works: useAgent swallows the failure, and the branding
     * arrives moments later on the WebSocket's "hello". What is lost is the
     * reason the route exists — server/src/index.ts starts the HTTP server before
     * the agent runtime specifically so branding does not wait behind a setup
     * that "can take a few seconds", because that wait showed up as a flash of
     * default branding. Cross-origin, that flash is back, and only for embedded
     * hosts.
     *
     * Fixing it means answering with the CORS headers for origins that are
     * already allowed — a change to what the server exposes, so it belongs in its
     * own change rather than in the commit that added this harness. When it is
     * fixed, this test starts passing and Playwright reports it as an unexpected
     * pass: remove the .fail() then.
     */
    const response = await page.request.get(`${process.env.PI_E2E_SERVER_URL}/branding`, {
      headers: { Origin: process.env.PI_E2E_HOST_URL! },
    });
    expect(response.headers()["access-control-allow-origin"]).toBe(process.env.PI_E2E_HOST_URL);
  },
);
