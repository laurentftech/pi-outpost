import { expect, test } from "@playwright/test";
import { mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { makeWorkspace, startServer } from "../server/test/harness.mjs";

// openlore: scenario=PreservesTheChosenExtensionAlias spec=extension-path-aliases
// openlore: scenario=RemovesTheAliasWithoutRemovingItsTarget spec=extension-path-aliases
// openlore: scenario=RefusesInvalidExtensionAliases spec=extension-path-aliases
test("the resource manager preserves an extension alias, removes it, and rejects a vanished alias", async ({ page }) => {
  test.setTimeout(60_000);
  const root = await makeWorkspace();
  const target = path.join(root, "extension-v1");
  const alias = path.join(root, "stable-extension");
  await mkdir(target);
  await writeFile(path.join(target, "index.ts"), `export default pi => {
    pi.registerCommand("symlink-proof", { description: "Loaded through the stable alias", handler: async () => {} });
  };\n`);
  await symlink(target, alias, process.platform === "win32" ? "junction" : "dir");
  const project = path.join(root, "project");
  await mkdir(project);
  const server = await startServer(project, {}, { env: { ANTHROPIC_API_KEY: "sk-ant-not-a-real-key" } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const manager = async () => {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Manage agent resources", exact: true }).click();
  };
  const chooseAlias = async () => {
    await page.getByRole("button", { name: "Add local folder…" }).click();
    await page.getByRole("button", { name: "Extension folder", exact: true }).click();
    await page.getByTestId("picker-path").fill(alias);
    const go = page.getByTestId("server-path-picker").getByRole("button", { name: "Go", exact: true });
    if (await go.isEnabled()) await go.click();
    await expect(go).toBeDisabled();
    await page.getByRole("button", { name: "Use this directory", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Local resource folder" })).toHaveValue(alias);
    await page.getByText(/I trust every extension/).click();
  };
  try {
    await page.goto(server.base);
    await expect(page.getByTitle("connected")).toBeVisible();
    await manager();
    await chooseAlias();
    await page.getByRole("button", { name: "Add folder", exact: true }).click();
    const remove = page.getByRole("button", { name: `Remove ${alias}`, exact: true });
    await expect(remove).toBeVisible();
    await expect(page.getByText(alias, { exact: true })).toBeVisible();
    const saved = JSON.parse(await readFile(server.configFile, "utf8"));
    expect(saved.userExtensionPaths).toEqual([alias]);
    await page.getByRole("button", { name: "Close agent resources" }).click();
    const composer = page.getByRole("textbox", { name: /message pi/i });
    await composer.fill("/symlink-proof");
    await expect(page.getByText("Loaded through the stable alias", { exact: true })).toBeVisible();
    await composer.fill("");
    await page.keyboard.press("Escape");
    await manager();
    await remove.click();
    await expect(remove).toHaveCount(0);
    expect(JSON.parse(await readFile(server.configFile, "utf8")).userExtensionPaths).toEqual([]);
    expect(await realpath(alias)).toEqual(await realpath(target));
    expect(await readFile(path.join(target, "index.ts"), "utf8")).toContain("symlink-proof");

    // Second pass: remove the alias after choosing it but before confirming.
    // A stale picker result must not register an invalid path or close as a success.
    await chooseAlias();
    await rm(alias);
    await page.getByRole("button", { name: "Add folder", exact: true }).click();
    const local = page.getByTestId("add-local-folder");
    await expect(local.getByRole("alert")).toContainText(alias);
    expect(JSON.parse(await readFile(server.configFile, "utf8")).userExtensionPaths).toEqual([]);
    await local.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Close agent resources" }).click();
    await composer.fill("/symlink-proof");
    await expect(page.getByText("Loaded through the stable alias", { exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await server.stop();
    await rm(root, { recursive: true, force: true });
  }
});
