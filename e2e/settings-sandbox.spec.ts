/**
 * The sandbox selected in Settings must govern both surfaces the user sees:
 * the Files sidebar and the actual tools invoked by the agent.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

// openlore: scenario=NewSandboxGovernsTheReplacementSession spec=persistent-runtime-settings
// openlore: scenario=ReadConfiguredResourceOutsideRoot spec=file
test("Settings keeps the agent's sandbox and external resource access in sync", async ({ page }) => {
  await page.goto(process.env.PI_E2E_SETTINGS_SANDBOX_URL!);
  await expect(page.getByTitle("connected")).toBeVisible();

  const root = process.env.PI_E2E_SETTINGS_SANDBOX_ROOT!;
  const moved = path.join(root, "moved");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Browse for sandbox root" }).click();
  await page.getByTestId("picker-path").fill(moved);
  await page.getByRole("button", { name: "Go" }).click();
  await page.getByRole("button", { name: "Use this directory" }).click();
  await page.getByRole("textbox", { name: /Writable root/ }).fill(moved);
  await page.getByRole("button", { name: "Apply & restart session" }).click();
  await expect(page.getByRole("button", { name: "Apply & restart session" })).toHaveCount(0, { timeout: 20_000 });

  // The sidebar reads the server's browser root after the apply.
  await page.getByTitle("Show files").click();
  await expect(page.getByText("moved.txt", { exact: true })).toBeVisible();
  await expect(page.getByText("original.txt", { exact: true })).toHaveCount(0);

  // The model calls the real `ls` tool. Its result is captured at the provider
  // boundary, after tool execution, rather than inferred from the snapshot.
  await page.getByRole("combobox").selectOption({ label: "sandbox-settings-test/sandbox-settings-test" });
  const composer = page.getByRole("textbox", { name: /message pi/i });
  await composer.fill("List the files in your sandbox.");
  await composer.press("Enter");
  await expect.poll(async () => readFile(process.env.PI_E2E_SETTINGS_SANDBOX_LOG!, "utf8").catch(() => "")).toContain("moved.txt");
  await expect.poll(async () => readFile(process.env.PI_E2E_SETTINGS_SANDBOX_LOG!, "utf8").catch(() => "")).not.toContain("original.txt");
  await expect(page.getByText("done", { exact: true })).toBeVisible();

  // A configured resource is a read-only exception even when it lives beside,
  // rather than under, the sandbox root. Drive the real resource manager and
  // verify the next agent turn reads the skill body with the real `read` tool.
  const skillDir = process.env.PI_E2E_SETTINGS_SANDBOX_SKILL_DIR!;
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Manage agent resources" }).click();
  await page.getByRole("button", { name: "Add local folder…" }).click();
  await page.getByRole("button", { name: "Skill folder" }).click();
  await page.getByTestId("picker-path").fill(skillDir);
  await page.getByRole("button", { name: "Go" }).click();
  await page.getByRole("button", { name: "Use this directory" }).click();
  await page.getByRole("button", { name: "Add folder" }).click();
  const ungrouped = page.getByRole("button", { name: /Provenance unavailable 1/ });
  await expect(ungrouped).toBeVisible();
  await ungrouped.click();
  await expect(page.getByText("outside-skill", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close agent resources" }).click();

  // Adding the resource replaces the session, which intentionally reapplies the
  // configured default model. Select the deterministic tool-calling provider for
  // the verification turn as well.
  await page.getByRole("combobox").selectOption({ label: "sandbox-settings-test/sandbox-settings-test" });
  await composer.fill("Read the matching skill before answering.");
  await composer.press("Enter");
  await expect.poll(async () => readFile(process.env.PI_E2E_SETTINGS_SANDBOX_LOG!, "utf8").catch(() => "")).toContain("E2E_OUTSIDE_SKILL_BODY");
  await expect.poll(async () => readFile(process.env.PI_E2E_SETTINGS_SANDBOX_LOG!, "utf8").catch(() => "")).not.toContain("Access denied");
});
