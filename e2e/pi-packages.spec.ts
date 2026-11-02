/**
 * Adding, removing and restoring an npm pi package from Settings, in a real browser
 * against a real server, a real npm and a registry of the suite's own (global setup).
 *
 * What the browser shows is checked against what lands on disk: the settings files are
 * read back after every action. The layout checks measure the section, because "the
 * labels move" was the complaint this design answers and only a browser lays it out.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

const NAME = "pi-fake-ext";
const ROOT = process.env.PI_E2E_PACKAGES_ROOT!;
const AGENT_DIR = process.env.PI_E2E_PACKAGES_AGENT_DIR!;

const userPackages = async () => JSON.parse(await readFile(path.join(AGENT_DIR, "settings.json"), "utf8")).packages ?? [];
const projectPackages = async () => JSON.parse(await readFile(path.join(ROOT, ".pi", "settings.json"), "utf8").catch(() => "{}")).packages ?? [];

async function openSettings(page: Page): Promise<Locator> {
  await page.goto(process.env.PI_E2E_PACKAGES_URL!);
  await page.getByRole("button", { name: "Settings" }).click();
  const section = page.getByTestId("pi-packages");
  await expect(section).toBeVisible();
  return section;
}

const row = (section: Locator, text: RegExp) => section.getByTestId("pi-package").filter({ hasText: text });
const box = async (locator: Locator) => {
  const b = await locator.boundingBox();
  return b ? [Math.round(b.x), Math.round(b.y), Math.round(b.width)] : null;
};

test("add, refuse, remove, undo and update, with the section holding still", async ({ page }) => {
  test.setTimeout(240_000);
  const section = await openSettings(page);
  const agentRow = row(section, /^(?!this project)/).filter({ hasText: NAME }).first();
  await expect(agentRow).toContainText("1.0.0 — 1.1.0 available", { timeout: 60_000 });

  // One text size in the whole section, and no monospace.
  const fonts = await section.evaluate((root) => {
    const seen = new Set<string>();
    for (const el of root.querySelectorAll<HTMLElement>("*")) {
      const own = [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim());
      if (!own && !(el instanceof HTMLButtonElement || el instanceof HTMLInputElement)) continue;
      const style = getComputedStyle(el);
      seen.add(`${style.fontSize} ${/mono/i.test(style.fontFamily) ? "mono" : "sans"}`);
    }
    return [...seen];
  });
  expect(fonts).toEqual(["12px sans"]);

  // AnUnknownPackageIsRefusedInPlace + ARefusalDoesNotMoveTheForm
  await section.getByRole("button", { name: "Add a package" }).click();
  const field = section.getByLabel("npm package");
  await expect(field).toBeFocused();
  await field.fill("pi-nope-xyz");
  const install = section.getByRole("button", { name: "Install…" });
  const before = [await box(field), await box(install)];
  await install.click();
  await expect(section.getByRole("alert")).toHaveText("pi-nope-xyz was not found on the registry", { timeout: 30_000 });
  expect([await box(field), await box(install)]).toEqual(before);
  await expect(field).toHaveValue("pi-nope-xyz");

  // AConfiguredPackageIsNotAddedTwice
  await field.fill(NAME);
  await install.click();
  await expect(section.getByRole("alert")).toHaveText(`${NAME} is already in the agent's settings`, { timeout: 30_000 });

  // AProjectInstallGoesToTheProjectsSettings + AVersionGivenIsPinned + NoInstallWithoutConfirmation
  await field.fill(`${NAME}@1.1.0`);
  await section.getByLabel(/this project only/).check();
  await install.click();
  const confirm = section.getByTestId("pi-package-add-confirm");
  await expect(confirm).toContainText(`${NAME} 1.1.0 (pinned), for the`, { timeout: 30_000 });
  await confirm.getByRole("button", { name: "Cancel" }).click();
  expect(await projectPackages()).toEqual([]);
  await install.click();
  await confirm.getByRole("button", { name: `Install ${NAME}` }).dblclick();
  const projectRow = row(section, /this project ·/);
  await expect(projectRow).toContainText("1.1.0 installed — restart to use it", { timeout: 120_000 });
  await expect(projectRow).toHaveCount(1);
  expect(await projectPackages()).toEqual([`npm:${NAME}@1.1.0`]);
  await expect(page.getByTestId("restart-needed")).toContainText(`${NAME} 1.1.0`);

  // Removed before any restart, a package installed since the start simply goes: it never ran.
  await projectRow.getByRole("button", { name: `Remove ${NAME}` }).click();
  await expect(projectRow.getByTestId("pi-package-confirm")).toContainText(/project's settings and uninstalls it/);
  await projectRow.getByTestId("pi-package-confirm").getByRole("button", { name: "Remove" }).click();
  await expect(projectRow).toHaveCount(0, { timeout: 120_000 });
  expect(await projectPackages()).toEqual([]);
  await expect(page.getByTestId("restart-needed")).toHaveCount(0);

  // AConfirmedRemovalIsListedUntilARestart → UndoRestoresWhatIsRunning, with nothing moving.
  const name = agentRow.locator("span").first();
  const slots = () => Promise.all([box(name), box(agentRow.getByRole("button").last())]);
  const resting = await slots();
  await agentRow.getByRole("button", { name: `Remove ${NAME}` }).click();
  await agentRow.getByTestId("pi-package-confirm").getByRole("button", { name: "Remove" }).click();
  await expect(agentRow).toContainText("removed — still running until pi-outpost restarts", { timeout: 120_000 });
  expect(await userPackages()).toEqual([]);
  await expect(page.getByTestId("restart-needed")).toContainText(`${NAME} removed`);
  expect(await slots()).toEqual(resting);
  // AddingARemovedPackagePointsAtUndo
  await section.getByRole("button", { name: "Add a package" }).click();
  await section.getByLabel("npm package").fill(NAME);
  await section.getByRole("button", { name: "Install…" }).click();
  await expect(section.getByRole("alert")).toContainText("undo the removal", { timeout: 30_000 });
  await section.getByRole("button", { name: "Cancel" }).click();

  await agentRow.getByRole("button", { name: "Undo" }).click();
  await expect(agentRow).toContainText("1.0.0 — 1.1.0 available", { timeout: 120_000 });
  expect(await userPackages()).toEqual([`npm:${NAME}`]);
  await expect(page.getByTestId("restart-needed")).toHaveCount(0);
  expect(await slots()).toEqual(resting);

  // AnUpdateInProgressMovesNothing
  const watched = () => Promise.all([box(name), box(agentRow.getByRole("button", { name: `Remove ${NAME}` })), box(section.getByRole("button", { name: "Add a package" }))]);
  const still = await watched();
  await agentRow.getByRole("button", { name: "Update" }).click();
  await agentRow.getByRole("button", { name: "Install 1.1.0" }).click();
  await expect(agentRow).toContainText("updating to 1.1.0…");
  expect(await watched()).toEqual(still);
  await expect(agentRow).toContainText("1.1.0 installed — restart to use it", { timeout: 120_000 });
  expect(await watched()).toEqual(still);
});
