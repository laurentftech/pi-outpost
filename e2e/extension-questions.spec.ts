import path from "node:path";
import { rm } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
// @ts-expect-error -- shared real-server integration harness is JavaScript
import { connect, makeWorkspace, startServer } from "../server/test/harness.mjs";

const extension = `export default pi => {
  const context = Array.from({length: 40}, (_, i) => "Evidence " + (i + 1) + ": compare the original figures before choosing.").join("\\n\\n");
  const report = content => pi.sendMessage({customType: "question-test", content, display: true});
  pi.registerCommand("question-select", {handler: async (_args, ctx) => {
    report(context);
    const answer = await ctx.ui.select("Choose using the evidence", Array.from({length: 30}, (_, i) => "Option " + (i + 1)));
    report("Selected: " + (answer ?? "cancelled"));
  }});
  pi.registerCommand("question-flow", {handler: async (_args, ctx) => {
    report(context);
    const first = await ctx.ui.input("First answer", "Your first answer");
    const second = await ctx.ui.input("Second answer", "Your second answer");
    const edited = await ctx.ui.editor("Review the answer", "Original text");
    const multi = await ctx.ui.input("Pick several\\n1. Apples — fresh\\n2. Pears — ripe", "1,3");
    const next = await ctx.ui.input("Pick again\\n1. Apples — fresh\\n2. Pears — ripe", "1,3");
    const confirmed = await ctx.ui.confirm("Finish?", "Confirm the answers");
    report("Answers: " + JSON.stringify({first, second, edited, multi, next, confirmed}));
  }});
  pi.registerCommand("question-long", {handler: async (_args, ctx) => {
    report(context);
    const description = "Review each path and the full explanation before granting access. ".repeat(5);
    const answer = await ctx.ui.select("Long descriptions", ["1. Review access — " + description, "2. Refuse access — Keep the current sandbox"]);
    const multi = await ctx.ui.input("Long checkbox descriptions\\n1. Review access — " + description + "\\n2. Refuse access — Keep the current sandbox", "1,3");
    report("Long choices: " + JSON.stringify({answer, multi}));
  }});
};`;

let root: string;
let server: Awaited<ReturnType<typeof startServer>>;
let client: ReturnType<typeof connect>;

test.beforeEach(async ({ page }) => {
  root = await makeWorkspace({ "questions.mjs": extension });
  server = await startServer(root, { noExtensions: false, extensionPaths: [path.join(root, "questions.mjs")] }, { env: { ANTHROPIC_API_KEY: "e2e-not-a-real-key" } });
  client = connect(server.wsUrl());
  await client.waitFor("hello", 30_000);
  await page.goto(server.base);
  await expect(page.getByRole("textbox", { name: /message pi/i })).toBeEnabled();
});

async function assertChoiceColumns(page: Page, heading: string, columns: 1 | 2) {
  const choices = page.getByRole("region", { name: heading, exact: true }).getByRole("group", { name: "Answer choices" });
  await expect(choices).toBeVisible();
  await expect.poll(async () => {
    const [a, b] = await Promise.all([choices.locator(":scope > *").nth(0).boundingBox(), choices.locator(":scope > *").nth(1).boundingBox()]);
    return !!a && !!b && (columns === 2
      ? Math.abs(a.y - b.y) < 1 && b.x >= a.x + a.width && a.width >= 320 && b.width >= 320
      : b.y >= a.y + a.height && Math.abs(a.x - b.x) < 1);
  }).toBe(true);
  return choices;
}

test.afterEach(async () => {
  client?.close();
  if (server) await server.stop();
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
});

async function assertSeparateScrollAreas(page: Page) {
  const main = page.getByRole("main");
  const panel = page.getByRole("region", { name: "Choose using the evidence" });
  const timeline = await main.boundingBox();
  const question = await panel.boundingBox();
  expect(timeline).not.toBeNull();
  expect(question).not.toBeNull();
  expect(timeline!.height).toBeGreaterThan(150);
  expect(timeline!.y + timeline!.height).toBeLessThanOrEqual(question!.y);
  expect(question!.height).toBeLessThanOrEqual(page.viewportSize()!.height * 0.4 + 1);
  // Wheel events must reach the conversation, with the question still pending.
  await main.hover();
  await page.mouse.wheel(0, -100_000);
  await expect.poll(() => main.evaluate(el => el.scrollTop)).toBe(0);
  await expect(page.getByText("Evidence 1: compare the original figures before choosing.", { exact: true })).toBeInViewport();
  // A real click and text selection, not only visibility through a translucent overlay.
  await page.getByText("Evidence 1: compare the original figures before choosing.", { exact: true }).click({ clickCount: 3 });
  expect(await page.evaluate(() => window.getSelection()?.toString())).toContain("Evidence 1");
  await expect(panel).toBeVisible();
  await expect(page.getByText("Selected:", { exact: false })).toHaveCount(0);
  return panel;
}

// openlore: scenario=ReadConversationWhileAnswering spec=extension-question-context
test("read and scroll the conversation while a question is pending, then answer by keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  client.send({ type: "prompt", text: "/question-select" });
  await expect(page.getByRole("region", { name: "Choose using the evidence" })).toBeVisible();
  const panel = await assertSeparateScrollAreas(page);
  await assertChoiceColumns(page, "Choose using the evidence", 2);
  await panel.getByRole("button", { name: "Option 2", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Selected: Option 2", { exact: true })).toBeVisible();
  await expect(panel).toHaveCount(0);
});

// openlore: scenario=LongQuestionsLeaveMobileContextReadable spec=extension-question-context
test("a long mobile question scrolls independently and survives resizing and context clicks", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 740 });
  client.send({ type: "prompt", text: "/question-select" });
  await expect(page.getByRole("region", { name: "Choose using the evidence" })).toBeVisible();
  const panel = await assertSeparateScrollAreas(page);
  await assertChoiceColumns(page, "Choose using the evidence", 1);
  await page.setViewportSize({ width: 820, height: 620 });
  await assertSeparateScrollAreas(page);
  await page.setViewportSize({ width: 390, height: 740 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await panel.getByRole("button", { name: "Option 30", exact: true }).scrollIntoViewIfNeeded();
  expect(await panel.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath("question-with-readable-context.png") });
  await panel.getByRole("button", { name: "Option 30", exact: true }).click();
  await expect(page.getByText("Selected: Option 30", { exact: true })).toBeVisible();
});

// openlore: scenario=ShortChoicesFollowAvailablePanelWidth spec=responsive-question-choices
test("brief choices use two columns only when the panel has room, including after resize", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 900 });
  client.send({ type: "prompt", text: "/question-select" });
  const choices = await assertChoiceColumns(page, "Choose using the evidence", 2);
  const order = Array.from({ length: 30 }, (_, i) => `Option ${i + 1}`);
  await expect(choices.getByRole("button")).toHaveText(order);
  // The viewport stays wide: the open files panel reduces the question's available width.
  await page.getByRole("banner").getByRole("button", { name: /files/ }).click();
  await assertChoiceColumns(page, "Choose using the evidence", 1);
  await expect(choices.getByRole("button")).toHaveText(order);
  await page.getByRole("banner").getByRole("button", { name: /files/ }).click();
  await assertChoiceColumns(page, "Choose using the evidence", 2);
  await page.setViewportSize({ width: 390, height: 740 });
  await assertChoiceColumns(page, "Choose using the evidence", 1);
  await page.getByRole("button", { name: "Refuse to answer" }).click();
  await expect(page.getByText("Selected: cancelled", { exact: true })).toBeVisible();
});

// openlore: scenario=LongChoiceDescriptionsStayStacked spec=responsive-question-choices
test("long descriptions stay in one column for buttons and checkboxes on a wide screen", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  client.send({ type: "prompt", text: "/question-long" });
  const buttons = await assertChoiceColumns(page, "Long descriptions", 1);
  await buttons.getByRole("button", { name: /Refuse access/ }).click();
  const checks = await assertChoiceColumns(page, "Long checkbox descriptions", 1);
  await checks.getByRole("checkbox", { name: /Refuse access/ }).check();
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await expect(page.getByText('Long choices: {"answer":"2. Refuse access — Keep the current sandbox","multi":"2"}', { exact: true })).toBeVisible();
});

// openlore: scenario=SuccessiveQuestionsPreserveDraftAndIsolateAnswers spec=extension-question-context
// openlore: scenario=RespondToExtensionDialog spec=components
test("successive questions reset answers, preserve the composer draft, and allow explicit refusal", async ({ page }) => {
  const composer = page.getByRole("textbox", { name: /message pi/i });
  await composer.fill("Keep my unsent draft");
  client.send({ type: "prompt", text: "/question-flow" });
  await expect(page.getByRole("region", { name: "First answer" })).toBeVisible();
  await expect(composer).toBeHidden();
  await page.getByPlaceholder("Your first answer").fill("one");
  await page.getByPlaceholder("Your first answer").press("Enter");
  const second = page.getByPlaceholder("Your second answer");
  await expect(second).toHaveValue("");
  await second.fill("two");
  await second.press("Enter");
  const editor = page.getByRole("region", { name: "Review the answer" }).getByRole("textbox");
  await expect(editor).toHaveValue("Original text");
  await editor.fill("Edited text");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await assertChoiceColumns(page, "Pick several", 2);
  await page.getByRole("checkbox", { name: /Apples/ }).check();
  await page.setViewportSize({ width: 390, height: 740 });
  await assertChoiceColumns(page, "Pick several", 1);
  await expect(page.getByRole("checkbox", { name: /Apples/ })).toBeChecked();
  await page.setViewportSize({ width: 1440, height: 900 });
  await assertChoiceColumns(page, "Pick several", 2);
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await expect(page.getByRole("region", { name: "Pick again" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Apples/ })).not.toBeChecked();
  await page.getByRole("checkbox", { name: /Pears/ }).check();
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await expect(page.getByRole("region", { name: "Finish?" })).toBeVisible();
  await page.getByRole("button", { name: "Refuse to answer" }).click();
  await expect(page.getByText('Answers: {"first":"one","second":"two","edited":"Edited text","multi":"1","next":"2","confirmed":false}', { exact: true })).toBeVisible();
  await expect(composer).toBeVisible();
  await expect(composer).toHaveValue("Keep my unsent draft");
});
