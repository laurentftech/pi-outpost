import { expect, test } from "@playwright/test";

test("onboarding account sign-in works without crypto.randomUUID on an HTTP LAN origin", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(crypto, "randomUUID", { configurable: true, value: undefined });
  });
  await page.goto(process.env.PI_E2E_ACCOUNT_ONBOARDING_URL!);
  await expect(page.getByText("Sign in with an account")).toBeVisible();
  expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe("undefined");

  await page.getByRole("button", { name: "Account Test", exact: true }).click();

  await expect(page.getByTestId("login-device-code")).toContainText("WDJB-MJHT");
});

test("onboarding submits a manual login answer without navigating or exposing it in the URL", async ({ page }) => {
  const address = process.env.PI_E2E_ACCOUNT_ONBOARDING_URL!;
  await page.goto(address);
  await page.getByRole("button", { name: "Account Test", exact: true }).click();
  await page.getByTestId("login-prompt").getByRole("textbox").fill("wrong-code");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByTestId("login-done")).toContainText("That code was not accepted");
  expect(page.url()).toBe(new URL(address).href);
});

test("onboarding account buttons toggle the current flow and switch to another provider", async ({ page }) => {
  await page.goto(process.env.PI_E2E_ACCOUNT_ONBOARDING_URL!);
  await expect(page.getByText("Sign in with an account")).toBeVisible();
  const firstProvider = page.getByRole("button", { name: "Account Test", exact: true });
  const secondProvider = page.getByRole("button", { name: "Account Test Secondary", exact: true });

  await firstProvider.click();
  await expect(page.getByTestId("login-device-code")).toContainText("WDJB-MJHT");
  await expect(firstProvider).toHaveAttribute("aria-expanded", "true");
  await firstProvider.click();
  await expect(page.getByTestId("login-flow")).toHaveCount(0);
  await expect(firstProvider).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("Sign-in cancelled.")).toHaveCount(0);

  await firstProvider.click();
  await expect(page.getByTestId("login-device-code")).toBeVisible();
  await secondProvider.click();
  await expect(page.getByText("Signing in to Account Test Secondary")).toBeVisible();
  await expect(page.getByTestId("login-device-code")).toContainText("WDJB-MJHT");
  await expect(firstProvider).toHaveAttribute("aria-expanded", "false");
  await expect(secondProvider).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("Sign-in cancelled.")).toHaveCount(0);

  await secondProvider.click();
  await expect(page.getByTestId("login-flow")).toHaveCount(0);
  await expect(page.getByText("Sign-in cancelled.")).toHaveCount(0);
});

test("Accounts runs a provider sign-in in the browser, rejects a wrong code, then signs out", async ({ page }) => {
  await page.goto(process.env.PI_E2E_ACCOUNTS_URL!);
  await expect(page.getByTitle("connected")).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByText(/^Accounts/).click();
  const account = page.getByTestId("account-account-test");
  await account.locator("summary").click();
  await expect(account).toContainText("Not signed in");

  await account.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("login-device-code")).toContainText("WDJB-MJHT");
  await expect(page.getByRole("link", { name: "https://example.test/device" })).toBeVisible();
  await page.getByTestId("login-prompt").getByRole("textbox").fill("wrong-code");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByTestId("login-done")).toContainText("That code was not accepted");
  await page.getByRole("button", { name: "Close" }).click();

  await account.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("login-device-code")).toBeVisible();
  await page.getByTestId("login-prompt").getByRole("textbox").fill("right-code");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(account).toContainText("oauth · stored");
  await account.getByRole("button", { name: "Sign out" }).click();
  await expect(account).toContainText("Not signed in");
});

test("Accounts can cancel an in-progress sign-in and the row stays signed out", async ({ page }) => {
  await page.goto(process.env.PI_E2E_ACCOUNTS_URL!);
  await expect(page.getByTitle("connected")).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByText(/^Accounts/).click();
  const account = page.getByTestId("account-account-test");
  await account.locator("summary").click();
  await account.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("login-device-code")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("login-done")).toContainText("Sign-in cancelled");
  await expect(account).toContainText("Not signed in");
});

test("double-clicking a sign-in action closes only its provider without leaving a cancellation message", async ({ page }) => {
  await page.goto(process.env.PI_E2E_ACCOUNTS_URL!);
  await expect(page.getByTitle("connected")).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByText(/^Accounts/).click();
  const account = page.getByTestId("account-account-test");
  await account.locator("summary").click();
  await account.getByRole("button", { name: "Sign in" }).dblclick({ delay: 120 });
  await expect(page.getByTestId("accounts-panel")).toHaveAttribute("open");
  await expect(account).not.toHaveAttribute("open");
  await account.locator("summary").click();
  await expect(account).toContainText("Not signed in");
  await expect(account.getByText("Sign-in cancelled.")).toHaveCount(0);
});
