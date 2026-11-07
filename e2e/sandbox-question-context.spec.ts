import path from "node:path";
import { fileURLToPath } from "node:url";
import { access, mkdir, readFile, realpath, rm } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { connect, makeWorkspace, startServer } from "../server/test/harness.mjs";

const provider = fileURLToPath(new URL("../server/test/fixtures/bash-call-provider.mjs", import.meta.url));
const doctor = fileURLToPath(new URL("../server/test/fixtures/fake-runner-doctor.cjs", import.meta.url));
const model = { provider: "bash-call-test", id: "bash-call-test" };
const exists = async (file: string) => access(file).then(() => true, () => false);

// The provider and broker are real. Node stands in for the sandbox runner, as in
// sandboxGrantsServer.test.mjs; it executes only this test's command after approval.
const runner = `const fs = require("node:fs");
const { spawn } = require("node:child_process");
const args = process.argv.slice(2);
const [shell, script] = args.slice(args.indexOf("--") + 1);
spawn(shell, [script], {stdio:"inherit",env:process.env}).on("exit", code => process.exit(code ?? 1));`;
const context = `export default pi => pi.registerCommand("grant-context", {handler: async () => {
  pi.sendMessage({customType:"grant-evidence",display:true,content:Array.from({length:30},(_,i)=>"Evidence "+(i+1)+": review these figures before granting access.").join("\\n\\n")});
}});`;

for (const decision of ["Refuse", "Allow once"] as const) {
  // openlore: scenario=LongSandboxRequestsKeepContextAndDecisionsVisible spec=responsive-question-choices
  // openlore: scenario=AnApprovedCommandRuns spec=sandbox-approved-grants
  // openlore: scenario=ARefusedRequestRunsNothing spec=sandbox-approved-grants
  test(`long sandbox request: ${decision} stays explicit while details and timeline scroll`, async ({ page }, testInfo) => {
    const root = await realpath(await makeWorkspace({ run: runner, "context.mjs": context }));
    const beside = `${root}-beside`;
    const directories = Array.from({ length: 16 }, (_, i) => ({ path: path.join(beside, `target-${i}-${"long-directory-name-".repeat(4)}`), access: i % 2 === 0 ? "write" : "read" }));
    await Promise.all(directories.map(dir => mkdir(dir.path, { recursive: true })));
    const marker = path.join(directories[0].path, "ran.txt");
    const command = [...Array.from({ length: 25 }, (_, i) => `// Step ${i}: inspect the exact command and all requested directories before approving.`), `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran");`].join("\n");
    const reason = "Compare the complete build output with the adjacent archive before copying any files. ".repeat(16);
    const log = path.join(root, "results.json");
    const server = await startServer(root, {
      sandbox: { root, allowWrite: false, allowBash: true, bashRunner: process.execPath, bashShell: process.execPath },
      extensionPaths: [provider, path.join(root, "context.mjs")],
      allowedModels: [model],
    }, { env: { BASH_CALL_LOG: log, BASH_CALL_STEPS: JSON.stringify([{ tool: "run_with_grant", args: { command, reason, directories } }]), NODE_OPTIONS: `--require "${doctor.replaceAll("\\", "/")}"` } });
    const client = connect(server.wsUrl());
    try {
      await client.waitFor("hello", 30_000);
      await page.setViewportSize(decision === "Refuse" ? { width: 390, height: 740 } : { width: 1440, height: 900 });
      await page.goto(server.base);
      await expect(page.getByRole("textbox", { name: /message pi/i })).toBeEnabled();
      client.send({ type: "prompt", text: "/grant-context" });
      await expect(page.getByText("Evidence 1: review these figures before granting access.", { exact: true })).toBeAttached();
      client.send({ type: "set_model", ...model });
      await client.waitFor("model_changed");
      await page.getByRole("textbox", { name: /message pi/i }).fill("Keep my sandbox note unsent");
      client.send({ type: "prompt", text: "Request the sandbox grant." });
      const { request } = await client.waitFor("sandbox_grant_request", 30_000);
      const panel = page.getByRole("region", { name: "The agent asks to run a command beyond its sandbox" });
      await expect(panel).toBeVisible();
      await expect(panel).toHaveAttribute("data-request-id", request.id);
      expect(await panel.getByTestId("sandbox-grant-command").textContent()).toBe(command);
      expect(await panel.getByTestId("sandbox-grant-reason").textContent()).toBe(reason);
      for (const dir of directories) await expect(panel.getByTestId("sandbox-grant-targets")).toContainText(dir.path);
      await expect(panel.getByTestId("sandbox-grant-overrides")).toContainText("Writing is off");
      // No approval by appearance, focus, reading or resizing.
      expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BUTTON");
      const main = page.getByRole("main");
      await main.hover();
      await page.mouse.wheel(0, -100_000);
      await expect.poll(() => main.evaluate(el => el.scrollTop)).toBe(0);
      await page.getByText("Evidence 1: review these figures before granting access.", { exact: true }).click();
      await page.setViewportSize({ width: 390, height: 740 });
      const bounds = await panel.boundingBox();
      const timeline = await main.boundingBox();
      expect(bounds!.height).toBeLessThanOrEqual(740 * 0.4 + 1);
      expect(timeline!.height).toBeGreaterThan(150);
      expect(timeline!.y + timeline!.height).toBeLessThanOrEqual(bounds!.y);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      const details = panel.getByTestId("sandbox-grant-details");
      await details.evaluate(el => el.scrollTop = el.scrollHeight);
      await expect(panel.getByTestId("sandbox-grant-reason")).toBeInViewport();
      for (const name of ["Refuse", "Allow for this session", "Allow once"]) await expect(panel.getByRole("button", { name, exact: true })).toBeInViewport();
      expect(await exists(marker)).toBe(false);
      expect(client.received.some((m: { type: string }) => m.type === "sandbox_grant_resolved")).toBe(false);
      await page.screenshot({ path: testInfo.outputPath("long-sandbox-question-mobile.png") });
      await panel.getByRole("button", { name: decision, exact: true }).click();
      const resolved = await client.waitFor((m) => m.type === "sandbox_grant_resolved" && m.id === request.id);
      expect(resolved.type).toBe("sandbox_grant_resolved");
      if (resolved.type !== "sandbox_grant_resolved") throw new Error("Expected the grant resolution");
      expect(resolved.outcome).toBe(decision === "Refuse" ? "refused" : "approved-once");
      await expect(panel).toHaveCount(0);
      await expect.poll(() => exists(log)).toBe(true);
      const results = JSON.parse(await readFile(log, "utf8"));
      expect(results[0].isError).toBe(decision === "Refuse");
      expect(await exists(marker)).toBe(decision === "Allow once");
      await expect(page.getByRole("textbox", { name: /message pi|steer the agent/i })).toHaveValue("Keep my sandbox note unsent");
    } catch (error) {
      console.log(server.log());
      throw error;
    } finally {
      client.close();
      await server.stop();
      await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
      await rm(beside, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    }
  });
}
