import { expect, test } from "@playwright/test";
import { makeWorkspace, startServer } from "../server/test/harness.mjs";

/**
 * A Windows 11 without the August 2026 update (sandbox-defaults › AMachineThatCannotConfineIsSaidOnce):
 * the shell the server chose cannot be confined, and the interface says so once, as a dialog naming
 * the update — then not again in this browser for that cause, while the padlock opens it on demand.
 *
 * MXC's tier and the build are told to the server through PI_OUTPOST_TEST_MXC_TIER and
 * PI_OUTPOST_TEST_WINDOWS_BUILD, which can only make its check fail. Windows only.
 */
test.skip(process.platform !== "win32", "MXC's process container is Windows'");

const OLD_WINDOWS = { PI_OUTPOST_TEST_MXC_TIER: "appcontainer-dacl", PI_OUTPOST_TEST_WINDOWS_BUILD: "26100.6584", ANTHROPIC_API_KEY: "e2e-not-a-real-key" };

// openlore: scenario=AMachineThatCannotConfineIsSaidOnce spec=sandbox-defaults
test("AMachineThatCannotConfineIsSaidOnce: the dialog names the update, closes, stays closed on reload, and the padlock opens it again", async ({ page }) => {
  const root = await makeWorkspace({ "README.md": "# old windows\n" });
  const server = await startServer(root, { sandbox: { root, allowWrite: true, allowBash: true, bashRunner: "auto" } }, { env: OLD_WINDOWS });
  try {
    await page.goto(`${server.base}/?token=${server.token}`);
    const dialog = page.getByRole("alertdialog", { name: "The agent has no shell on this machine" });
    await expect(dialog).toBeVisible({ timeout: 60_000 });
    await expect(dialog).toContainText("This Windows (build 26100.6584) lacks the August 2026 cumulative update (KB5120998)");
    await expect(page.getByTestId("shell-unavailable-update")).toContainText("Update Windows to build 26100.9278 or later, then restart pi-outpost");
    await expect(page.getByTestId("shell-unavailable-unconfine")).toContainText("If you cannot update Windows, run commands unconfined");
    await expect(page.getByTestId("shell-unavailable-unconfine")).toContainText("pi-outpost config --unconfine");
    await expect(page.getByTestId("shell-unavailable-windows-update")).toHaveAttribute("href", "ms-settings:windowsupdate");

    // The padlock under it says the cause too.
    await expect(page.getByTestId("shell-confinement")).toContainText("shell unavailable — Windows update needed");

    await page.getByTestId("shell-unavailable-continue").click();
    await expect(dialog).toHaveCount(0);

    // Seen: a reload does not show it again for the same cause.
    await page.reload();
    await expect(page.getByTestId("shell-confinement")).toContainText("Windows update needed", { timeout: 60_000 });
    await expect(dialog).toHaveCount(0);

    // The padlock opens it on demand; Escape closes it.
    await page.getByRole("button", { name: "Why the agent has no shell" }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  } finally {
    await server.stop();
  }
});

test("monkey: rapid padlock clicks open one dialog, a reload before closing shows it again, another tab follows, a stray Escape does nothing", async ({ page, context }) => {
  const root = await makeWorkspace({ "README.md": "# old windows\n" });
  const server = await startServer(root, { sandbox: { root, allowWrite: true, allowBash: true, bashRunner: "auto" } }, { env: OLD_WINDOWS });
  try {
    await page.goto(`${server.base}/?token=${server.token}`);
    const dialog = page.getByRole("alertdialog", { name: "The agent has no shell on this machine" });
    await expect(dialog).toBeVisible({ timeout: 60_000 });

    // Not closed, then reloaded: not seen, so shown again.
    await page.reload();
    await expect(dialog).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("shell-unavailable-continue").click();
    await expect(dialog).toHaveCount(0);

    // Five clicks as fast as they come: one dialog.
    const lock = page.getByRole("button", { name: "Why the agent has no shell" });
    for (let i = 0; i < 5; i++) await lock.click({ delay: 0, force: true }).catch(() => {});
    await expect(dialog).toHaveCount(1);
    await page.getByTestId("shell-unavailable-continue").click();
    await expect(dialog).toHaveCount(0);

    // A stray Escape with no dialog leaves the page as it was.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shell-confinement")).toContainText("Windows update needed");

    // Another tab of the same browser has seen it already: no dialog there.
    const other = await context.newPage();
    await other.goto(server.base);
    await expect(other.getByTestId("shell-confinement")).toContainText("Windows update needed", { timeout: 60_000 });
    await expect(other.getByRole("alertdialog")).toHaveCount(0);
  } finally {
    await server.stop();
  }
});

// openlore: scenario=AWindowsBefore24H2IsToldBothWays spec=sandbox-defaults
test("AWindowsBefore24H2IsToldBothWays: 23H2 is told to move to 24H2, and beside it the command to run unconfined, which copies", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const root = await makeWorkspace({ "README.md": "# 23H2\n" });
  const server = await startServer(
    root,
    { sandbox: { root, allowWrite: true, allowBash: true, bashRunner: "auto" } },
    { env: { ...OLD_WINDOWS, PI_OUTPOST_TEST_WINDOWS_BUILD: "22631.4890" } },
  );
  try {
    await page.goto(`${server.base}/?token=${server.token}`);
    const dialog = page.getByRole("alertdialog", { name: "The agent has no shell on this machine" });
    await expect(dialog).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("shell-unavailable-cause")).toContainText(
      "This Windows (build 22631.4890) lacks Windows 11 24H2 or later, with the August 2026 cumulative update (KB5120998)",
    );
    await expect(page.getByTestId("shell-unavailable-update")).toContainText("Update Windows to build 26100.9278 or later");
    const unconfine = page.getByTestId("shell-unavailable-unconfine");
    await expect(unconfine).toContainText("If you cannot update Windows, run commands unconfined");
    await expect(unconfine).toContainText("every right of your account");
    await page.getByTestId("shell-unavailable-copy").click();
    await expect(page.getByTestId("shell-unavailable-copy")).toHaveText("copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("pi-outpost config --unconfine");
    // Nothing in the page loosens the sandbox: the copy is all it does.
    await expect(dialog.getByRole("button", { name: /unconfine|none/i })).toHaveCount(0);
    await expect(page.getByTestId("shell-confinement")).toContainText("Windows update needed");
  } finally {
    await server.stop();
  }
});
