import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

async function prompt(page: import("@playwright/test").Page, text: string) {
  const composer = page.getByRole("textbox", { name: /message pi/i });
  await expect(composer).toBeEnabled();
  await composer.fill(text);
  await composer.press("Enter");
}

test("agent-owned Work Plan survives reload, switches with sessions, and isolates a fork", async ({ page }) => {
  await page.goto(process.env.PI_E2E_PLANS_URL!);
  await expect(page.getByTitle("connected")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Work Plan" })).toHaveCount(0);

  // The scripted offline agent executes the real work_plan wire contract and
  // persists the same sidecar the extension writes in production.
  await prompt(page, "Create a plan for this release");
  const panel = page.getByRole("complementary", { name: "Work Plan" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Release plan" })).toBeVisible();
  await expect(panel.getByLabel("In progress")).toBeVisible();

  await panel.getByRole("button", { name: "Close Work Plan" }).click();
  const collapsedPlan = page.getByRole("button", { name: "Open Work Plan" });
  await collapsedPlan.hover();
  const preview = page.getByRole("tooltip");
  await expect(preview).toBeVisible();
  await expect(preview.getByText("Publish release")).toBeVisible();
  await preview.hover();
  await expect(preview).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(preview).toBeHidden();
  await collapsedPlan.hover();
  await expect(preview).toBeVisible();
  await collapsedPlan.click();
  await expect(panel).toBeVisible();

  await panel.getByRole("treeitem", { name: /Publish release/ }).click();
  await panel.getByRole("button", { name: "Release notes" }).click();
  await expect(page.getByRole("button", { name: "Close file viewer" })).toBeVisible();
  await page.getByRole("button", { name: "Close file viewer" }).click();

  await prompt(page, "Mark the release task done");
  await expect(panel.getByLabel("Done")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("complementary", { name: "Work Plan" }).getByLabel("Done")).toBeVisible();

  await page.getByRole("button", { name: "sessions" }).click();
  await page.getByRole("button", { name: /Other work/ }).click();
  await expect(page.getByRole("heading", { name: "Other plan" })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "Wait" })).toBeVisible();

  await page.getByRole("button", { name: "sessions" }).click();
  await page.getByRole("button", { name: /Release source/ }).click();
  await expect(page.getByRole("heading", { name: "Release plan" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Work Plan" }).getByLabel("Done")).toBeVisible();

  await page.getByRole("button", { name: "tree" }).click();
  await page.getByRole("button", { name: /fork/i }).last().click();
  // The fork has landed once its message is back in the composer. The plan's heading says
  // nothing: the source session shows the same one, so a prompt sent on it alone can reach
  // the agent before the fork, whose copy of the source plan then overwrites the reopening.
  await expect(page.getByRole("textbox", { name: /message pi/i })).toHaveValue("Ship the release");
  await expect(page.getByRole("heading", { name: "Release plan" })).toBeVisible();

  await prompt(page, "Reopen the task only in this fork");
  await expect(page.getByRole("complementary", { name: "Work Plan" }).getByLabel("In progress")).toBeVisible();

  const source = JSON.parse(await readFile(`${process.env.PI_E2E_PLAN_SOURCE}.work-plan.json`, "utf8"));
  const fork = JSON.parse(await readFile(`${process.env.PI_E2E_PLAN_FORK}.work-plan.json`, "utf8"));
  expect(source.tasks[0].status).toBe("done");
  expect(fork.tasks[0].status).toBe("in_progress");
});

test("narrow viewport automatically compacts the Work Plan and keeps the conversation visible", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 640, height: 800 });
  await page.goto(process.env.PI_E2E_PLANS_URL!);
  await expect(page.getByTitle("connected")).toBeVisible();
  await prompt(page, "Create a plan for this release");

  await expect(page.getByRole("button", { name: "Open Work Plan" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Work Plan" })).toHaveCount(0);
  await expect(page.getByText("Create a plan for this release", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Open Work Plan" }).click();
  const narrowPanel = page.getByRole("complementary", { name: "Work Plan" });
  await expect(narrowPanel).toBeVisible();
  await narrowPanel.getByRole("button", { name: "Close Work Plan" }).click();
  await expect(narrowPanel).toHaveCount(0);

  await page.getByRole("button", { name: "Open Work Plan" }).click();
  await expect(narrowPanel).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(narrowPanel).toBeVisible();
  await page.setViewportSize({ width: 640, height: 800 });
  await expect(page.getByRole("button", { name: "Open Work Plan" })).toBeVisible();
  await expect(narrowPanel).toHaveCount(0);

  if (testInfo.project.name === "chromium") {
    await page.mouse.move(10, 180);
    await expect(page.getByRole("tooltip")).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath("workplan-narrow-compact.png"), fullPage: true });
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByRole("complementary", { name: "Work Plan" })).toBeVisible();
});

test("TheFoldedPlanCoversNoBarControl: the bar over a look at the conversation is dismissed with its files, and the Work Plan lies below the bars", async ({ page }) => {
  await page.goto(process.env.PI_E2E_PLANS_URL!);
  await expect(page.getByTitle("connected")).toBeVisible();
  await prompt(page, "Create a plan for this release");
  const panel = page.getByRole("complementary", { name: "Work Plan" });
  await expect(panel).toBeVisible();
  await panel.getByRole("treeitem", { name: /Publish release/ }).click();
  await panel.getByRole("button", { name: "Release notes" }).click();
  await expect(page.getByRole("button", { name: "Close file viewer" })).toBeVisible();

  // Folded while the file covers the conversation: the chip sits below the file's toolbar,
  // never over its edit or close, at any width.
  const above = async (bar: import("@playwright/test").Locator, chip: import("@playwright/test").Locator) => {
    const [b, c] = [(await bar.boundingBox())!, (await chip.boundingBox())!];
    return c.y >= b.y + b.height || c.x >= b.x + b.width || c.x + c.width <= b.x;
  };
  // Folded from a look at the conversation (the file covers the open panel), then back.
  await page.getByRole("button", { name: "conversation ↗" }).click();
  await panel.getByRole("button", { name: "Close Work Plan" }).click();
  await page.getByRole("button", { name: /^← back to / }).click();
  const chipOverFile = page.getByRole("button", { name: "Open Work Plan" });
  await expect(chipOverFile).toBeVisible();
  for (const width of [1280, 700, 400]) {
    await page.setViewportSize({ width, height: 800 });
    for (const control of [page.getByRole("button", { name: "✎ edit" }), page.getByRole("button", { name: "Close file viewer" })]) {
      await expect(control).toBeVisible();
      expect(await above(control, chipOverFile), `chip over a file control at ${width}px`).toBe(true);
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("button", { name: "conversation ↗" }).click();
  await chipOverFile.click();

  const back = page.getByRole("button", { name: /^← back to / });
  const forget = page.getByRole("button", { name: "Close the file and stay in the conversation" });
  await expect(back).toBeVisible();
  await expect(forget).toBeVisible();

  // The plan's panel, and its chip once folded, lie over the conversation — below the
  // strip, at every width, whichever way the strip's controls wrap.
  const strip = forget.locator("xpath=..");
  const below = async (over: import("@playwright/test").Locator) => {
    const [top, bottom] = [(await over.boundingBox())!, (await strip.boundingBox())!];
    return top.y >= bottom.y + bottom.height - 1;
  };
  await expect(panel).toBeVisible();
  expect(await below(panel)).toBe(true);
  await panel.getByRole("button", { name: "Close Work Plan" }).click();
  const chip = page.getByRole("button", { name: "Open Work Plan" });
  await expect(chip).toBeVisible();
  for (const width of [1280, 700, 400]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(forget).toBeVisible();
    await expect(chip).toBeVisible();
    expect(await below(chip), `chip over the strip at ${width}px`).toBe(true);
  }

  // A real double click, which lands on whatever is on top at that point: the second
  // click must not open the plan whose chip may now stand where the ✕ was.
  await forget.dblclick();
  await expect(back).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Close file viewer" })).toHaveCount(0);
  await expect(chip).toBeVisible();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: /message pi/i })).toBeVisible();
});
