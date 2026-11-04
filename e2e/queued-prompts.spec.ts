/**
 * Queued prompts in the running app (queued-prompts): a turn held open by the provider's gate
 * files, prompts sent behind it, then edited, removed, delivered — and what the agent was
 * actually sent read back from the provider's log.
 *
 * The provider numbers its requests for the whole server's life, so each test reads how many
 * there were before choosing the gates it holds.
 */
import { readFile, rm, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const gate = (n: number) => `${process.env.PI_E2E_QUEUED_GATES!}-${n}`;

async function sent(): Promise<{ n: number; users: { text: string; images: string[] }[] }[]> {
  const text = await readFile(process.env.PI_E2E_QUEUED_LOG!, "utf8").catch(() => "");
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

/** Open the app on the queue-test model, start a turn held on the next request's gate (and `more` after it). */
async function holdTurn(page: Page, more = 0): Promise<number> {
  const first = (await sent()).length + 1;
  for (let n = first; n <= first + more; n++) await writeFile(gate(n), "");
  await page.goto(process.env.PI_E2E_QUEUED_URL!);
  await expect(page.getByTitle("connected")).toBeVisible();
  await page.getByRole("combobox").selectOption({ label: "queue-test/queue-test" });
  const composer = page.getByRole("textbox", { name: /message pi|steer the agent/i });
  await composer.fill(`start ${first}`);
  await composer.press("Enter");
  await expect.poll(async () => (await sent()).length).toBe(first);
  return first;
}

async function send(page: Page, text: string) {
  const composer = page.getByRole("textbox", { name: /message pi|steer the agent/i });
  await composer.fill(text);
  await composer.press("Enter");
}

const queued = (page: Page) => page.locator("[data-queued-prompt]");

async function editQueued(page: Page, index: number, text: string, save = true) {
  const bubble = queued(page).nth(index);
  await bubble.hover();
  await bubble.getByRole("button", { name: "Edit this queued message" }).click();
  await bubble.getByRole("textbox", { name: "Edit prompt" }).fill(text);
  if (save) await bubble.getByRole("button", { name: "save" }).click();
}

/** User bubble texts in the conversation, in order — queued ones excluded. */
const conversation = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".whitespace-pre-wrap")]
      .filter((node) => !node.closest("[data-queued-prompt]") && node.closest(".ml-auto"))
      .map((node) => node.textContent ?? ""),
  );

// openlore: scenario=AQueuedPromptWaitsAsAPendingBubble spec=queued-prompts
// openlore: scenario=EditAQueuedPrompt spec=queued-prompts
// openlore: scenario=RemoveAQueuedPrompt spec=queued-prompts
// openlore: scenario=AQueuedPromptJoinsTheConversationWhenDelivered spec=queued-prompts
test("a prompt sent mid-turn waits as a bubble, is edited and removed with the usual controls, and reaches the agent as edited", async ({ page }) => {
  const first = await holdTurn(page);
  await expect(page.getByText("working…")).toBeVisible();

  await send(page, "fix the tpyo");
  await expect(queued(page)).toHaveCount(1);
  await expect(queued(page)).toContainText("queued — not read yet");
  await expect(queued(page)).toContainText("fix the tpyo");
  expect(await conversation(page)).toEqual([`start ${first}`]);

  await editQueued(page, 0, "fix the typo");
  await expect(queued(page)).toContainText("fix the typo");
  await expect(queued(page)).not.toContainText("tpyo");

  await send(page, "never mind this");
  await expect(queued(page)).toHaveCount(2);
  await queued(page).nth(1).hover();
  await queued(page).nth(1).getByRole("button", { name: "Remove this queued message" }).click();
  await expect(queued(page)).toHaveCount(1);

  await rm(gate(first));
  await expect(page.getByText(`answer ${first + 1}`)).toBeVisible();
  await expect(queued(page)).toHaveCount(0);
  expect(await conversation(page)).toEqual([`start ${first}`, "fix the typo"]);

  const requests = (await sent()).slice(first - 1);
  expect(requests[1].users.at(-1)?.text).toBe("fix the typo");
  expect(requests.flatMap((request) => request.users.map((user) => user.text))).not.toContain("never mind this");
  expect(requests.flatMap((request) => request.users.map((user) => user.text))).not.toContain("fix the tpyo");
});

// openlore: scenario=AnEditOfADeliveredPromptIsRefused spec=queued-prompts
// openlore: scenario=APendingPromptOutlivesAnAbort spec=queued-prompts
// openlore: scenario=ALateClientSeesThePendingPrompts spec=queued-prompts
test("monkey: an edit the agent overtakes, a double ✕, an abort, a reload — nothing lost, nothing doubled", async ({ page, browser }) => {
  const first = await holdTurn(page, 1);
  await send(page, "A");
  await send(page, "B");
  await send(page, "C");
  await expect(queued(page)).toHaveCount(3);

  // Editing A when the agent reads it: the editor goes with the bubble, the edit goes to the composer.
  await editQueued(page, 0, "A, edited too late", false);
  await rm(gate(first));
  await expect(page.getByText(`answer ${first}`)).toBeVisible();
  await expect(queued(page)).toHaveCount(2);
  await expect(page.getByRole("textbox", { name: /message pi|steer the agent/i })).toHaveValue("A, edited too late");
  await expect(page.getByText(/read that message before your edit was saved/)).toBeVisible();
  await page.getByRole("textbox", { name: /message pi|steer the agent/i }).fill("");

  // A double ✕ on C: removed once, and no error about it.
  const errorsBefore = await page.getByText(/no longer in the queue/).count();
  await queued(page).nth(1).hover();
  await queued(page).nth(1).getByRole("button", { name: "Remove this queued message" }).dblclick({ force: true }).catch(() => {});
  await expect(queued(page)).toHaveCount(1);
  await expect(queued(page)).toContainText("B");
  expect(await page.getByText(/no longer in the queue/).count()).toBe(errorsBefore);

  // Another client, mid-turn, sees B.
  const other = await browser.newPage();
  await other.goto(process.env.PI_E2E_QUEUED_URL!);
  await expect(queued(other)).toHaveCount(1);
  await expect(queued(other)).toContainText("B");

  // Stopped: B stays pending, in both, and can still be edited — without starting a turn.
  await page.getByRole("button", { name: "Stop the agent" }).click();
  await expect(page.getByText("working…")).toHaveCount(0);
  await expect(queued(page)).toHaveCount(1);
  const before = (await sent()).length;
  await editQueued(page, 0, "B, edited after the stop");
  await expect(queued(page)).toContainText("B, edited after the stop");
  await expect(queued(other)).toContainText("B, edited after the stop");
  await page.waitForTimeout(500);
  expect((await sent()).length).toBe(before);

  // A reload finds it pending, and the next prompt takes it along.
  await page.reload();
  await expect(queued(page)).toHaveCount(1);
  await send(page, "D");
  await expect.poll(async () => (await sent()).slice(before).flatMap((request) => request.users.map((user) => user.text))).toContain("B, edited after the stop");
  await expect(queued(page)).toHaveCount(0);
  await expect(page.getByText("working…")).toHaveCount(0);

  // Each prompt is in the conversation once, as the agent received it.
  const users = await conversation(page);
  for (const text of ["A", "B, edited after the stop", "D"]) expect(users.filter((user) => user === text)).toHaveLength(1);
  expect(users).not.toContain("C");
  expect(users).not.toContain("A, edited too late");
  await other.close();
});

test("monkey: edit spam, two clients on one prompt, a new session under a queue", async ({ page, browser }) => {
  const first = await holdTurn(page);
  await send(page, "draft 0");
  await send(page, "keep me");
  await expect(queued(page)).toHaveCount(2);

  // Five edits as fast as the editor reopens: the last one wins, the order holds, ids stay put.
  const id = await queued(page).nth(0).getAttribute("data-queued-prompt");
  for (let i = 1; i <= 5; i++) await editQueued(page, 0, `draft ${i}`);
  await expect(queued(page).nth(0)).toContainText("draft 5");
  await expect(queued(page).nth(1)).toContainText("keep me");
  expect(await queued(page).nth(0).getAttribute("data-queued-prompt")).toBe(id);

  // Two clients on the same prompt: one removes it while the other has it open and saves.
  const other = await browser.newPage();
  await other.goto(process.env.PI_E2E_QUEUED_URL!);
  await expect(queued(other)).toHaveCount(2);
  await editQueued(other, 0, "edited by the other client", false);
  await queued(page).nth(0).hover();
  await queued(page).nth(0).getByRole("button", { name: "Remove this queued message" }).click();
  await expect(queued(page)).toHaveCount(1);
  // The other client's editor went with the bubble; its edit is in its composer, not lost and not sent.
  await expect(queued(other)).toHaveCount(1);
  await expect(other.getByRole("textbox", { name: /message pi|steer the agent/i })).toHaveValue("edited by the other client");

  // A new session under a running turn and a queue: the new session starts with none.
  await page.getByTitle("new session").click();
  await expect(queued(page)).toHaveCount(0);
  await expect(queued(other)).toHaveCount(0);
  await rm(gate(first));
  await page.waitForTimeout(500);
  const texts = (await sent()).slice(first - 1).flatMap((request) => request.users.map((user) => user.text));
  expect(texts).not.toContain("edited by the other client");
  expect(texts.filter((text) => text.startsWith("draft"))).toEqual([]);
  expect(await conversation(page)).toEqual([]);
  await other.close();
});

// openlore: scenario=TheQueueIsSentAfterAStop spec=queued-prompts
// openlore: scenario=SendingNowAsksFirstWhileATurnRuns spec=queued-prompts
// openlore: scenario=SendingNowStopsTheStepInProgress spec=queued-prompts
test("send now: asks while a turn runs, cancel changes nothing, confirmed it stops the step; after a stop it just sends", async ({ page }) => {
  const first = await holdTurn(page, 3);
  const composer = page.getByRole("textbox", { name: /message pi|steer the agent/i });
  await send(page, "one");
  await send(page, "two");
  await expect(queued(page)).toHaveCount(2);

  // Mid-turn: asks, and cancel leaves the turn and the queue as they were.
  await page.getByRole("button", { name: "send all 2 now" }).click();
  const confirm = page.getByRole("group", { name: /confirm sending/i });
  await expect(confirm).toContainText("reply being written is dropped");
  await confirm.getByRole("button", { name: "cancel" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(page.getByText("working…")).toBeVisible();
  await expect(queued(page)).toHaveCount(2);

  // A half-typed draft in the composer survives everything below.
  await composer.fill("half a thought");

  // Confirmed, clicked twice: the step stops once, both prompts go out together, once.
  await page.getByRole("button", { name: "send all 2 now" }).click();
  await confirm.getByRole("button", { name: "stop and send" }).dblclick({ force: true }).catch(() => {});
  await expect(queued(page)).toHaveCount(0);
  await expect.poll(async () => (await sent()).length).toBeGreaterThanOrEqual(first + 1);
  const next = (await sent())[first];
  expect(next.users.slice(-2).map((user) => user.text)).toEqual(["one", "two"]);
  await expect(composer).toHaveValue("half a thought");

  // Stop with a new prompt queued, then send it: no confirmation, nothing to type.
  await send(page, "three");
  await expect(queued(page)).toHaveCount(1);
  await page.getByRole("button", { name: "Stop the agent" }).click();
  await expect(page.getByText("working…")).toHaveCount(0);
  await expect(queued(page)).toHaveCount(1);
  const before = (await sent()).length;
  await page.getByRole("button", { name: "send now" }).click();
  await expect(page.getByRole("group", { name: /confirm sending/i })).toHaveCount(0);
  await expect.poll(async () => (await sent()).slice(before).some((request) => request.users.at(-1)?.text === "three")).toBe(true);
  await expect(queued(page)).toHaveCount(0);

  for (let n = first; n <= first + 3; n++) await rm(gate(n), { force: true });
  await expect(page.getByText("working…")).toHaveCount(0);
  const users = await conversation(page);
  for (const text of ["one", "two", "three"]) expect(users.filter((user) => user === text)).toHaveLength(1);
});

// openlore: scenario=SendingNowStopsTheStepInProgress spec=queued-prompts
test("send now while a command runs: the stopped turn ends, and the queued prompt is answered in a new one", async ({ page }) => {
  await page.goto(process.env.PI_E2E_QUEUED_URL!);
  await expect(page.getByTitle("connected")).toBeVisible();
  await page.getByRole("combobox").selectOption({ label: "queue-test/queue-test" });
  const before = (await sent()).length;
  await send(page, "run a long command");
  await expect(page.getByText("working…")).toBeVisible();
  await expect.poll(async () => (await sent()).length).toBe(before + 1);
  await send(page, "answer me after the stop");
  await expect(queued(page)).toHaveCount(1);

  await page.getByRole("button", { name: /send now/ }).click();
  await page.getByRole("group", { name: /confirm sending/i }).getByRole("button", { name: "stop and send" }).click();

  // The model is asked the queued prompt, and answers it.
  await expect.poll(async () => (await sent()).slice(before).some((request) => request.users.at(-1)?.text === "answer me after the stop")).toBe(true);
  await expect(queued(page)).toHaveCount(0);
  await expect(page.getByText("working…")).toHaveCount(0);
  const answered = (await sent()).find((request) => request.users.at(-1)?.text === "answer me after the stop")!.n;
  await expect(page.getByText(`answer ${answered}`, { exact: true })).toBeVisible();
  expect((await conversation(page)).filter((text) => text === "answer me after the stop")).toHaveLength(1);
});

test("monkey: repeated send-now interrupts deliver each queued batch once and in order", async ({ page }, testInfo) => {
  await page.goto(process.env.PI_E2E_QUEUED_URL!);
  await expect(page.getByTitle("connected")).toBeVisible();
  await page.getByRole("combobox").selectOption({ label: "queue-test/queue-test" });

  const composer = page.getByRole("textbox", { name: /message pi|steer the agent/i });
  const delivered: string[] = [];

  for (let round = 0; round < 3; round++) {
    const before = (await sent()).length;
    await send(page, "run a long command");
    await expect(page.getByText("working…")).toBeVisible();
    await expect.poll(async () => (await sent()).length).toBe(before + 1);

    const batch = [0, 1, 2].map((index) => `recovery ${testInfo.project.name} ${round} prompt ${index}`);
    delivered.push(...batch);
    for (const prompt of batch) await send(page, prompt);
    await expect(queued(page)).toHaveCount(batch.length);
    if (round === 0 && testInfo.project.name === "chromium") {
      await page.screenshot({ path: testInfo.outputPath("queue-pending.png"), fullPage: true });
    }

    await page.getByRole("button", { name: `send all ${batch.length} now` }).click();
    const confirm = page.getByRole("group", { name: /confirm sending/i });
    await confirm.getByRole("button", { name: "stop and send" }).click();

    await expect(queued(page)).toHaveCount(0);
    await expect(page.getByText("working…")).toHaveCount(0);
    await expect
      .poll(async () =>
        (await sent()).find(
          (item) => item.n > before && item.users.at(-1)?.text === batch.at(-1),
        ),
      )
      .toBeDefined();

    const recovery = (await sent()).find(
      (item) => item.n > before && item.users.at(-1)?.text === batch.at(-1),
    );
    expect(recovery, `recovery turn after interrupt ${round}`).toBeTruthy();
    expect(recovery!.users.slice(-batch.length).map(({ text }) => text)).toEqual(batch);
    await expect(page.getByText(`answer ${recovery!.n}`, { exact: true })).toBeVisible();
    if (round === 0 && testInfo.project.name === "chromium") {
      await page.screenshot({ path: testInfo.outputPath("queue-recovered.png"), fullPage: true });
    }

    const texts = await conversation(page);
    for (const prompt of batch) expect(texts.filter((text) => text === prompt)).toHaveLength(1);
    await composer.fill("");
  }

  expect(new Set(delivered).size).toBe(delivered.length);
});

test("a queued prompt in a long conversation scrolls with it, and never makes the page itself scroll", async ({ page }) => {
  await page.goto(process.env.PI_E2E_QUEUED_URL!);
  await expect(page.getByTitle("connected")).toBeVisible();
  await page.getByRole("combobox").selectOption({ label: "queue-test/queue-test" });
  // Long enough that the transcript scrolls: the queued bubble lands far below the window.
  for (let i = 0; i < 6; i++) {
    const before = (await sent()).length;
    await send(page, `long ${i} ${"lorem ipsum ".repeat(60)}`);
    await expect.poll(async () => (await sent()).length).toBe(before + 1);
    await expect(page.getByText("working…")).toHaveCount(0);
  }
  const held = (await sent()).length + 1;
  await writeFile(gate(held), "");
  await send(page, "held");
  await expect(page.getByText("working…")).toBeVisible();
  await send(page, "queued far down");
  await expect(queued(page)).toHaveCount(1);

  // Only the transcript scrolls: an element of the queued bubble placed against the page (its
  // screen-reader label, `position: absolute`) used to stretch the document past the window.
  const page_ = await page.evaluate(() => ({
    scroll: document.documentElement.scrollHeight,
    window: document.documentElement.clientHeight,
    transcriptScrolls: (() => {
      const main = document.querySelector("main")!;
      return main.scrollHeight > main.clientHeight;
    })(),
  }));
  expect(page_.transcriptScrolls, "the transcript is long enough to scroll").toBe(true);
  expect(page_.scroll, "the page does not scroll").toBeLessThanOrEqual(page_.window);

  await rm(gate(held), { force: true });
  await expect(page.getByText("working…")).toHaveCount(0);
});
