import { expect, test } from "@playwright/test";
import { makeWorkspace, startServer } from "../server/test/harness.mjs";

/**
 * A server with no token configured generates one and prints its address with it; a browser that
 * has never seen the server, opening that address, connects without the token screen and is left
 * with an address bar that no longer holds the token (`auth` › StartupUrlCarriesTheToken).
 */
// A browser with nothing stored: the shared token global-setup gives every origin is not wanted here.
test.use({ storageState: { cookies: [], origins: [] } });

// openlore: scenario=OpenedBrowserIsAuthenticated spec=auth
test("OpenedBrowserIsAuthenticated: the printed startup address connects a fresh browser and leaves no token in the address bar", async ({ page }) => {
  // No PI_OUTPOST_TOKEN: the server makes its own, in its agent directory.
  const server = await startServer(await makeWorkspace({ "README.md": "# startup token\n" }), {}, { env: { PI_OUTPOST_TOKEN: undefined, ANTHROPIC_API_KEY: "e2e-not-a-real-key" } });
  try {
    const printed = server.log().match(/\[server\] (http:\/\/\S+)/)?.[1];
    expect(printed, server.log()).toBeTruthy();
    const url = new URL(printed!);
    expect(url.searchParams.get("token")).toBe(server.token);
    expect(server.token).toMatch(/^[0-9a-f]{64}$/);

    await page.goto(url.href);
    await expect(page.getByTitle("connected")).toBeVisible();
    await expect(page.getByPlaceholder("paste the token…")).toHaveCount(0);
    expect(new URL(page.url()).searchParams.has("token")).toBe(false);

    // The browser kept it: a later visit to the bare address connects too.
    await page.goto(server.base);
    await expect(page.getByTitle("connected")).toBeVisible();
  } finally {
    await server.stop();
  }
});

// openlore: scenario=NoTokenConfigured spec=auth
test("a fresh browser at the bare address meets the token screen, and the token from the agent directory lets it in", async ({ page }) => {
  const server = await startServer(await makeWorkspace({ "README.md": "# startup token\n" }), {}, { env: { PI_OUTPOST_TOKEN: undefined, ANTHROPIC_API_KEY: "e2e-not-a-real-key" } });
  try {
    await page.goto(server.base);
    const input = page.getByPlaceholder("paste the token…");
    await expect(input).toBeVisible();
    await input.fill(server.token);
    await input.press("Enter");
    await expect(page.getByTitle("connected")).toBeVisible();
  } finally {
    await server.stop();
  }
});
