/**
 * The sandbox selected in Settings must govern both surfaces the user sees:
 * the Files sidebar and the actual tools invoked by the agent.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

// openlore: scenario=NewSandboxGovernsTheReplacementSession spec=persistent-runtime-settings
test("a sandbox chosen in Settings also moves the agent's ls tool", async ({ page }) => {
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
});
