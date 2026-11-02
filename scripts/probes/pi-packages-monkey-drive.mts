/**
 * The monkey pass over Settings → Packages, against `pi-packages-monkey.mts`:
 *
 *   node --import tsx/esm scripts/probes/pi-packages-monkey-drive.mts '<json the server printed>'
 *
 * Each step reads the DOM and the settings files back and prints what it saw; nothing
 * here asserts, the point is to look at what the app claims after each transition.
 */
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { chromium, type Locator, type Page } from "@playwright/test";

const info = JSON.parse(process.argv[2]!) as { url: string; first: string; second: string; agentDir: string };
const NAME = "pi-fake-ext";
const settings = async (file: string) => JSON.parse(await readFile(file, "utf8").catch(() => "{}")).packages ?? [];
const disk = async () => ({
  user: await settings(path.join(info.agentDir, "settings.json")),
  first: await settings(path.join(info.first, ".pi", "settings.json")),
  second: await settings(path.join(info.second, ".pi", "settings.json")),
});
const say = (step: string, data: unknown) => console.log(`\n## ${step}\n${JSON.stringify(data, null, 1)}`);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function open(page: Page): Promise<Locator> {
  await page.goto(info.url);
  await page.getByRole("button", { name: "Settings" }).click();
  const section = page.getByTestId("pi-packages");
  await section.waitFor();
  await page.getByText(/1\.0\.0 — 1\.1\.0 available|1\.0\.0, up to date|1\.0\.0/).first().waitFor({ timeout: 60_000 });
  return section;
}
const rows = (section: Locator) => section.getByTestId("pi-package").allInnerTexts();
const restart = async (page: Page) => (await page.getByTestId("restart-needed").count()) ? await page.getByTestId("restart-needed").innerText() : null;

const browser = await chromium.launch();
const a = await browser.newPage();
const b = await browser.newPage();
const sa = await open(a);
const sb = await open(b);
say("start", { a: await rows(sa), b: await rows(sb), disk: await disk() });

// 1. A lookup in flight, then the project switches under the open form.
await sa.getByRole("button", { name: "Add a package" }).click();
await sa.getByLabel("npm package").fill(`${NAME}@1.1.0`);
await sa.getByLabel(/this project only/).check();
await sa.getByRole("button", { name: "Install…" }).click();
await a.getByRole("button", { name: /pi-outpost-test-/ }).first().click();
await a.getByText(path.basename(info.second)).first().click().catch(() => undefined);
await wait(3000);
const settingsOpen = await a.getByTestId("pi-packages").count();
if (!settingsOpen) await a.getByRole("button", { name: "Settings" }).click();
await wait(1000);
say("1. switched project under a pending lookup", {
  workspace: await a.locator("header").innerText().then((t) => t.split("\n").slice(0, 3)),
  formOpen: await a.getByLabel("npm package").count(),
  confirm: (await a.getByTestId("pi-package-add-confirm").count()) ? await a.getByTestId("pi-package-add-confirm").innerText() : null,
  scopeLabel: (await a.getByLabel(/this project only/).count()) ? await a.locator("label", { hasText: "this project only" }).innerText() : null,
  rows: await rows(a.getByTestId("pi-packages")),
});
await a.goto(info.url);
await a.getByRole("button", { name: "Settings" }).click();

// 2. Two clients: A removes, B sees it; then both act on the same package at once.
const sa2 = a.getByTestId("pi-packages");
await sa2.getByRole("button", { name: `Remove ${NAME}` }).first().click();
await sa2.getByTestId("pi-package-confirm").getByRole("button", { name: "Remove" }).click();
await wait(4000);
say("2a. removed in A", { a: await rows(sa2), b: await rows(sb), restartA: await restart(a), restartB: await restart(b), disk: await disk() });
await Promise.all([
  sa2.getByRole("button", { name: "Undo" }).click(),
  sb.getByRole("button", { name: "Undo" }).click(),
]);
await wait(5000);
say("2b. Undo clicked in both at once", { a: await rows(sa2), b: await rows(sb), restartA: await restart(a), restartB: await restart(b), disk: await disk() });

// 3. A double click on Update, and Remove spammed in B while it runs.
const update = sa2.getByRole("button", { name: "Update", exact: true });
if (await update.count()) {
  await update.click();
  await sa2.getByRole("button", { name: "Install 1.1.0" }).dblclick().catch(() => undefined);
  for (let i = 0; i < 5; i++) await sb.getByRole("button", { name: `Remove ${NAME}` }).first().click({ timeout: 500 }).catch(() => undefined);
  const bConfirm = sb.getByTestId("pi-package-confirm").getByRole("button", { name: "Remove" });
  if (await bConfirm.count()) await bConfirm.click().catch(() => undefined);
  await wait(8000);
  say("3. update in A while B removes", { a: await rows(sa2), b: await rows(sb), restartA: await restart(a), disk: await disk() });
}

// 4. The package's files deleted underneath, then the list and a removal.
await rm(path.join(info.agentDir, "npm", "node_modules", NAME), { recursive: true, force: true });
await sa2.getByRole("button", { name: "check for updates" }).click();
await wait(3000);
say("4a. installed files deleted underneath", { a: await rows(sa2), restartA: await restart(a), disk: await disk() });
const remove = sa2.getByRole("button", { name: `Remove ${NAME}` }).first();
if (await remove.count()) {
  await remove.click();
  await sa2.getByTestId("pi-package-confirm").getByRole("button", { name: "Remove" }).click();
  await wait(4000);
  say("4b. removed after deletion", { a: await rows(sa2), restartA: await restart(a), disk: await disk() });
}

// 5. Add form spam: open/close, submit repeatedly while a lookup runs.
for (let i = 0; i < 4; i++) {
  await sa2.getByRole("button", { name: "Add a package" }).click();
  await a.keyboard.press("Escape");
}
await sa2.getByRole("button", { name: "Add a package" }).click();
await sa2.getByLabel("npm package").fill(NAME);
for (let i = 0; i < 4; i++) await sa2.getByLabel("npm package").press("Enter").catch(() => undefined);
await wait(3000);
say("5. add form spam", {
  settingsStillOpen: await a.getByTestId("pi-packages").count(),
  confirm: (await a.getByTestId("pi-package-add-confirm").count()) ? await a.getByTestId("pi-package-add-confirm").innerText() : null,
  alert: (await sa2.getByRole("alert").count()) ? await sa2.getByRole("alert").innerText() : null,
  rows: await rows(sa2),
});

await browser.close();
