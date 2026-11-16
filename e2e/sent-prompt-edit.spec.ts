/**
 * Editing a sent prompt in the running app: the conversation is rewound to just before the
 * message and the new text is asked again. The rewind reaches the client before the agent
 * has accepted the new text, and the edited message was on screen for neither — it
 * vanished, then came back with its echo.
 *
 * On the queue-test server: its provider logs what the agent was actually sent. That server
 * holds one conversation for every test driven on it, and the queued-prompts spec compares
 * the whole of it — so this file is named to run after that one, and reads only its own
 * messages out of whatever the conversation already holds.
 */
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

async function sent(): Promise<{ n: number; users: { text: string; images: string[] }[] }[]> {
  const text = await readFile(process.env.PI_E2E_QUEUED_LOG!, "utf8").catch(() => "");
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

/** Texts of the user bubbles on screen, in order — the one still waiting for its echo included. */
const bubbles = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll(".ml-auto .whitespace-pre-wrap")].map((node) => node.textContent ?? ""));

test("an edited prompt stays on screen from the moment it is sent, and the agent is asked the edited text", async ({ page }) => {
  await page.goto(process.env.PI_E2E_QUEUED_URL!);
  await expect(page.getByTitle("connected")).toBeVisible();
  await page.getByRole("combobox").selectOption({ label: "queue-test/queue-test" });

  const before = (await sent()).length;
  const original = `to be reworded ${before}`;
  const edited = `reworded ${before}`;
  const composer = page.getByRole("textbox", { name: /message pi/i });
  await composer.fill(original);
  await composer.press("Enter");
  await expect.poll(async () => (await sent()).length).toBe(before + 1);
  // Editable only once the turn is over and the message has its persisted entry.
  const bubble = page.locator(".ml-auto", { hasText: original });
  await bubble.hover();
  const edit = bubble.getByRole("button", { name: "Edit this prompt" });
  await expect(edit).toBeVisible();
  await edit.click();
  // From here the bubble holds a draft, not its text: its controls are found on the page.
  await page.getByRole("textbox", { name: "Edit prompt" }).fill(edited);

  // Every change of the page from the click on is looked at: a message that is gone for a
  // moment is gone between two polls of a test, never between two mutations of the DOM.
  await page.evaluate((text) => {
    const seen = { changes: 0, missing: 0 };
    (window as unknown as { __edited: typeof seen }).__edited = seen;
    const shown = () => [...document.querySelectorAll(".ml-auto .whitespace-pre-wrap")].some((node) => node.textContent === text);
    new MutationObserver(() => {
      seen.changes++;
      if (!shown()) seen.missing++;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }, edited);
  await page.getByRole("button", { name: "send", exact: true }).click();

  // Asked again, with the edited text and without the original: the rewind really happened.
  await expect.poll(async () => (await sent()).length).toBe(before + 2);
  const asked = (await sent())[before + 1].users.map((user) => user.text);
  expect(asked).toContain(edited);
  expect(asked).not.toContain(original);

  // Settled: its real bubble, once, and the original gone to its own branch.
  await expect(page.locator("[data-pending-prompt]")).toHaveCount(0);
  await expect.poll(async () => (await bubbles(page)).filter((text) => text === edited)).toEqual([edited]);
  expect(await bubbles(page)).not.toContain(original);

  const seen = await page.evaluate(() => (window as unknown as { __edited: { changes: number; missing: number } }).__edited);
  expect(seen.changes).toBeGreaterThan(0);
  expect(seen.missing, "changes of the page during which the edited prompt was not on screen").toBe(0);
});
