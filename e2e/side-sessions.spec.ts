/**
 * A side session, driven through the standalone app: started from the project's row,
 * answered on its own, named in the tab, and closed back to the project.
 */
import { expect, test } from "@playwright/test";

// openlore: scenario=TheProjectRowStartsASideSession spec=side-sessions
test("a side session starts from the project's row, runs apart, and closes back to the project", async ({ page }) => {
  await page.goto(process.env.PI_E2E_SIDE_SESSIONS_URL!);
  await expect(page.getByTitle("connected")).toBeVisible();
  const project = page.getByTitle(/^Project:/);
  const projectName = ((await project.getAttribute("title")) ?? "").replace(/^Project: (.*) \(.*\)$/, "$1");
  await expect(page).toHaveTitle(`${projectName} — pi`);

  await page.getByRole("combobox").selectOption({ label: "side-sessions-test/side-sessions-test" });
  const composer = page.getByRole("textbox", { name: /message pi/i });
  await composer.fill("main question");
  await composer.press("Enter");
  await expect(page.getByText("ok: main question")).toBeVisible();

  await project.click();
  await page.getByRole("button", { name: `New side session on ${projectName}` }).click();
  await expect(page).toHaveTitle(`${projectName} · side session 1 — pi`);
  await expect(page.getByText("ok: main question")).toHaveCount(0);

  await page.getByRole("combobox").selectOption({ label: "side-sessions-test/side-sessions-test" });
  await composer.fill("side question");
  await composer.press("Enter");
  await expect(page.getByText("ok: side question")).toBeVisible();

  // Back to the project: its own conversation, untouched by the side one.
  await project.click();
  await page.getByTestId("project-row").getByRole("menuitem").click();
  await expect(page).toHaveTitle(`${projectName} — pi`);
  await expect(page.getByText("ok: main question")).toBeVisible();
  await expect(page.getByText("ok: side question")).toHaveCount(0);

  // Close the side session from the list; the project stays.
  await project.click();
  const sideRow = page.getByTestId("side-session-row");
  await expect(sideRow).toHaveCount(1);
  await sideRow.hover();
  await sideRow.getByRole("button", { name: /^Close / }).click();
  await expect(page.getByTestId("side-session-row")).toHaveCount(0);
  await expect(page).toHaveTitle(`${projectName} — pi`);
});
