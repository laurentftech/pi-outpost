import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const WCAG_AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectNoA11yViolations(page: import("@playwright/test").Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_AA_TAGS).analyze();
  const violations = results.violations.map(({ id, impact, description, nodes }) => ({
    id,
    impact,
    description,
    elements: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
  }));
  expect(violations, "WCAG 2.2 AA accessibility violations").toEqual([]);
}

test("standalone app meets WCAG 2.2 AA on its initial screen", async ({ page }) => {
  await page.goto(process.env.PI_E2E_SERVER_URL!);
  await expect(page.getByTitle("connected")).toBeVisible();
  await expect(page.getByRole("textbox", { name: /message pi/i })).toBeVisible();

  await expectNoA11yViolations(page);
});

test("settings panel meets WCAG 2.2 AA", async ({ page }) => {
  await page.goto(process.env.PI_E2E_SERVER_URL!);
  await expect(page.getByTitle("connected")).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  await expectNoA11yViolations(page);
});
