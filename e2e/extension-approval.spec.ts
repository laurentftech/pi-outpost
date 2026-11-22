import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { makeWorkspace, startServer } from "../server/test/harness.mjs";

/**
 * The project's extensions wait for the user's say (`project-extension-approval`), in the running
 * app: the dialog, its code one click away, allowing and refusing, another tab, a reload.
 * Each extension leaves a marker outside the project when it runs: what ran is read from disk.
 */
const slash = (p: string) => p.split(path.sep).join("/");

test.setTimeout(300_000);

async function project(markers: string) {
  const extension = (name: string) =>
    `// ${name}: an extension the agent wrote\nimport { writeFileSync } from "node:fs";\nwriteFileSync("${slash(path.join(markers, name))}", "ran");\nexport default function () {}\n`;
  const root = await makeWorkspace({ "README.md": "# project\n" });
  await mkdir(path.join(root, ".pi", "extensions"), { recursive: true });
  await writeFile(path.join(root, ".pi", "extensions", "x.ts"), extension("x"));
  await writeFile(path.join(root, ".pi", "extensions", "y.ts"), extension("y"));
  return root;
}

// openlore: scenario=AllowingLoadsIt spec=project-extension-approval
// openlore: scenario=RefusingIsRemembered spec=project-extension-approval
test("the dialog names each extension, shows its code, and allowing loads it while refusing keeps it out", async ({ page }) => {
  const markers = await mkdtemp(path.join(tmpdir(), "e2e-ext-markers-"));
  const root = await project(markers);
  const server = await startServer(root, {}, { env: { ANTHROPIC_API_KEY: "e2e-not-a-real-key" } });
  try {
    await page.goto(`${server.base}/?token=${server.token}`);
    const dialog = page.getByTestId("extension-approval-dialog");
    await expect(dialog).toBeVisible({ timeout: 60_000 });
    await expect(dialog).toContainText("This project has an extension pi has not loaded");
    await expect(dialog).toContainText("It would run outside the sandbox, with every right of your account");
    await expect(dialog).toContainText("1 more after this one.");
    const first = (await page.getByTestId("extension-approval-label").textContent())!.trim();
    expect([".pi/extensions/x.ts", ".pi/extensions/y.ts"]).toContain(first);

    // Its code, in the viewer.
    await page.getByTestId("extension-approval-view").click();
    await expect(page.getByText(`an extension the agent wrote`).first()).toBeVisible({ timeout: 30_000 });

    // Refuse the first, allow the second.
    await page.getByTestId("extension-approval-refuse").click();
    await expect(page.getByTestId("extension-approval-label")).not.toHaveText(first, { timeout: 30_000 });
    const second = (await page.getByTestId("extension-approval-label").textContent())!.trim();
    await page.getByTestId("extension-approval-allow").click();
    await expect(page.getByTestId("extension-allowed-notice")).toContainText(`${second} is allowed and loaded`, { timeout: 120_000 });
    await expect(dialog).toHaveCount(0);
    const name = (label: string) => path.basename(label, ".ts");
    expect(existsSync(path.join(markers, name(second)))).toBe(true);
    expect(existsSync(path.join(markers, name(first)))).toBe(false);

    // A reload asks nothing: one allowed, one refused, both remembered.
    await page.reload();
    await expect(page.getByTestId("shell-confinement").or(page.getByRole("textbox").first())).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(1500);
    await expect(dialog).toHaveCount(0);
    expect(existsSync(path.join(markers, name(first)))).toBe(false);
  } finally {
    await server.stop();
    await rm(markers, { recursive: true, force: true });
  }
});

test("monkey: another tab's answer closes the dialog here, a double-clicked allow answers once, and the notice closes", async ({ page, context }) => {
  const markers = await mkdtemp(path.join(tmpdir(), "e2e-ext-markers-"));
  const root = await project(markers);
  const server = await startServer(root, {}, { env: { ANTHROPIC_API_KEY: "e2e-not-a-real-key" } });
  try {
    await page.goto(`${server.base}/?token=${server.token}`);
    const other = await context.newPage();
    await other.goto(server.base);
    const here = page.getByTestId("extension-approval-dialog");
    const there = other.getByTestId("extension-approval-dialog");
    await expect(here).toBeVisible({ timeout: 60_000 });
    await expect(there).toBeVisible({ timeout: 60_000 });

    // The other tab refuses the first: it leaves this tab too.
    const first = (await page.getByTestId("extension-approval-label").textContent())!.trim();
    await expect(other.getByTestId("extension-approval-label")).toHaveText(first);
    await other.getByTestId("extension-approval-refuse").click();
    await expect(page.getByTestId("extension-approval-label")).not.toHaveText(first, { timeout: 30_000 });

    // Double-click allow on the second, here: one answer, one load.
    await page.getByTestId("extension-approval-allow").dblclick();
    await expect(page.getByTestId("extension-allowed-notice")).toBeVisible({ timeout: 120_000 });
    await expect(here).toHaveCount(0);
    await expect(there).toHaveCount(0, { timeout: 30_000 });

    await page.getByTestId("extension-allowed-notice").getByRole("button", { name: "OK" }).click();
    await expect(page.getByTestId("extension-allowed-notice")).toHaveCount(0);
  } finally {
    await server.stop();
    await rm(markers, { recursive: true, force: true });
  }
});
