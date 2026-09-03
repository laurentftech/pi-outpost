/**
 * Playwright E2E test for the integrated interactive web terminal.
 */
import { expect, test } from "@playwright/test";

test.describe("Integrated Terminal (when disabled by default)", () => {
  test("hides terminal button and disarms shortcut on default server", async ({ page }) => {
    await page.goto(process.env.PI_E2E_SERVER_URL!);
    await expect(page.getByTitle("connected")).toBeVisible();

    // The header button should not exist
    await expect(page.getByRole("button", { name: />_ terminal/i })).toHaveCount(0);

    // Pressing Ctrl+` should not open terminal panel
    await page.keyboard.press("Control+`");
    await expect(page.getByText("terminal 1")).toHaveCount(0);
  });
});

test.describe("Integrated Terminal (when enabled via config/flag)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(process.env.PI_E2E_TERMINAL_URL!);
    await expect(page.getByTitle("connected")).toBeVisible();
  });

  test("shows header button and toggles terminal panel", async ({ page }) => {
    const terminalButton = page.getByRole("button", { name: />_ terminal/i });
    await expect(terminalButton).toBeVisible();

    // Open terminal via header button
    await terminalButton.click();
    await expect(page.getByText("terminal 1")).toBeVisible();
    await expect(page.getByTitle("New Terminal Tab")).toBeVisible();

    // Close / minimize terminal via header button
    await terminalButton.click();
    await expect(page.getByText("terminal 1")).not.toBeVisible();
  });

  test("toggles terminal via Ctrl+` keyboard shortcut", async ({ page }) => {
    // Open via shortcut
    await page.keyboard.press("Control+`");
    await expect(page.getByText("terminal 1")).toBeVisible();

    // Close via shortcut
    await page.keyboard.press("Control+`");
    await expect(page.getByText("terminal 1")).not.toBeVisible();
  });

  test("supports adding and renaming terminal tabs", async ({ page }) => {
    await page.getByRole("button", { name: />_ terminal/i }).click();
    await expect(page.getByText("terminal 1")).toBeVisible();

    // Add second tab
    await page.getByTitle("New Terminal Tab").click();
    await expect(page.getByText("terminal 2")).toBeVisible();

    // Rename first tab on double click
    await page.getByText("terminal 1").dblclick();
    const renameInput = page.getByTestId("terminal-tab-rename-input");
    await expect(renameInput).toBeVisible();
    await renameInput.fill("Build Server");
    await renameInput.press("Enter");

    await expect(page.getByText("Build Server")).toBeVisible();
  });
});
