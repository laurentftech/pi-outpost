/**
 * What Seatbelt refused, in the running app, under MXC itself (`durable-sandbox-rules`, macOS): a
 * command of the agent's reads beside the root and is refused; its result ends naming the
 * directory; the lock lists the refusal; an always-allow made there opens the directory to the next
 * command; a revoke closes it again. Then a pass that tries to break it.
 *
 * Nothing stands in for the runner: `"mxc"` is MXC's SDK, on a Mac on Apple silicon — CI's
 * `mxc-macos` job, or `npx playwright test --config e2e/playwright.config.ts sandbox-refusals-mxc-mac`
 * on such a Mac. The provider is scripted, so each turn runs the one command.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { connect, makeWorkspace, startServer } from "../server/test/harness.mjs";
import { SandboxRulesStore } from "../server/src/sandboxRules.ts";

const provider = fileURLToPath(new URL("../server/test/fixtures/bash-call-provider.mjs", import.meta.url));
const model = { provider: "bash-call-test", id: "bash-call-test" };

test.skip(process.platform !== "darwin" || process.arch !== "arm64", "MXC confines on macOS on Apple silicon only");
// Each test starts its own server and runs agent turns under a real sandbox.
test.describe.configure({ timeout: 180_000 });

async function start() {
  const root = await realpath(await makeWorkspace({ "inside.txt": "inside" }));
  const beside = `${root}-beside`;
  await mkdir(beside, { recursive: true });
  await writeFile(path.join(beside, "notes.txt"), "beside-notes\n");
  const agentDir = path.join(root, ".pi-agent");
  const store = new SandboxRulesStore({ agentDir, root });
  const log = path.join(root, "results.json");
  const command = `cat ${beside}/notes.txt; echo "read=$?"; ls ${agentDir} >/dev/null; echo "keys=$?"; cat inside.txt`;
  const server = await startServer(
    root,
    { sandbox: { root, allowWrite: true, allowBash: true, bashRunner: "mxc" }, extensionPaths: [provider], allowedModels: [model] },
    { env: { BASH_CALL_LOG: log, BASH_CALL_STEPS: JSON.stringify([{ tool: "bash", args: { command } }]) } },
  );
  const client = connect(server.wsUrl());
  await client.waitFor("hello", 30_000);
  client.send({ type: "set_model", ...model });
  await client.waitFor("model_changed");
  return {
    root,
    beside,
    agentDir,
    store,
    server,
    client,
    /** One turn: the command runs once, and what the agent read of it comes back. */
    async turn(): Promise<string> {
      await rm(log, { force: true });
      client.send({ type: "prompt", text: "Go." });
      for (let i = 0; i < 600; i++) {
        const text = await readFile(log, "utf8").catch(() => undefined);
        if (text) return (JSON.parse(text) as Array<{ content: Array<{ text?: string }> }>).map((r) => r.content.map((c) => c.text ?? "").join("")).join("\n");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("the agent never finished");
    },
    async stop() {
      client.close();
      await server.stop();
      await rm(beside, { recursive: true, force: true });
    },
  };
}

// openlore: scenario=OnMacOsMxcReportsWhatSeatbeltRefused spec=sandbox-durable-rules
// openlore: scenario=TheOutputNamesTheRefusedDirectory spec=sandbox-durable-rules
test("under MXC on macOS: a refused read ends the result naming the directory, is listed under the lock, and an always-allow made there opens it to the next command", async ({ page }) => {
  const app = await start();
  try {
    await page.goto(`${app.server.base}/?token=${encodeURIComponent(app.server.token)}`);
    await expect(page.getByRole("textbox", { name: /message pi/i })).toBeEnabled();

    // Before any command: nothing recorded, and no sentence saying this runner reports nothing.
    await page.getByTestId("sandbox-rules-toggle").click();
    await expect(page.getByTestId("sandbox-refusals-none")).toBeVisible();
    await expect(page.getByTestId("sandbox-rules-files")).toHaveCount(0);
    await page.keyboard.press("Escape");

    const first = await app.turn();
    expect(first).not.toContain("beside-notes");
    expect(first).toMatch(/read=1/);
    expect(first).toMatch(/keys=1/);
    expect(first).toContain("inside");
    expect(first).toContain(`[pi-outpost] the sandbox refused reading ${app.beside}.`);
    expect(first).toMatch(/ask run_with_grant for exactly it; judge the command by its exit status and output\.\s*$/);

    // The lock lists both, as the store holds them: one a rule can open, one it never can.
    await page.getByTestId("sandbox-rules-toggle").click();
    const refusals = page.getByTestId("sandbox-refusals-list");
    const besideRow = refusals.locator("li", { hasText: `reading ${app.beside}` });
    await expect(besideRow).toBeVisible();
    // By what was refused, not by the command, which names both directories.
    const keysRow = refusals.locator("li", { hasText: `reading ${app.agentDir}` });
    await expect(keysRow.getByRole("button", { name: "Always allow" })).toHaveCount(0);
    await expect(keysRow.getByTestId("sandbox-refusal-not-allowable")).toBeVisible();
    const recorded = await app.store.refusals();
    expect(recorded.filter((r) => r.kind === "directory").map((r) => r.target).sort()).toEqual([app.beside, app.agentDir].sort());
    expect(recorded.every((r) => r.kind === "directory")).toBe(true);

    await besideRow.getByRole("button", { name: "Always allow" }).click();
    await expect(besideRow).toContainText("A rule of yours covers it");
    await expect(page.getByTestId("sandbox-rules-list")).toContainText(`Always allow read ${app.beside}`);

    // The same command, a new turn: Seatbelt lets the read through, and still not the keys.
    const second = await app.turn();
    expect(second).toContain("beside-notes");
    expect(second).toMatch(/read=0/);
    expect(second).toMatch(/keys=1/);
    expect(second).not.toContain(`refused reading ${app.beside}.`);

    // Revoked in one click: the next command is refused again, and told so.
    await page.getByTestId("sandbox-rules-list").getByRole("button", { name: "Revoke" }).click();
    await expect(page.getByTestId("sandbox-rules-none")).toBeVisible();
    const third = await app.turn();
    expect(third).not.toContain("beside-notes");
    expect(third).toContain(`[pi-outpost] the sandbox refused reading ${app.beside}.`);
  } finally {
    await app.stop();
  }
});

test("break it under MXC on macOS: always allow clicked twice, the directory deleted under its rule, the panel open across turns", async ({ page }) => {
  const app = await start();
  try {
    await page.goto(`${app.server.base}/?token=${encodeURIComponent(app.server.token)}`);
    await expect(page.getByRole("textbox", { name: /message pi/i })).toBeEnabled();
    // The panel is open before the first refusal exists, and stays open.
    await page.getByTestId("sandbox-rules-toggle").click();
    await expect(page.getByTestId("sandbox-refusals-none")).toBeVisible();

    await app.turn();
    // The refusal reaches the open panel, unasked.
    const besideRow = page.getByTestId("sandbox-refusals-list").locator("li", { hasText: `reading ${app.beside}` });
    await expect(besideRow).toBeVisible();

    // Twice at once: one rule, no error.
    await besideRow.getByRole("button", { name: "Always allow" }).dblclick();
    await expect(besideRow).toContainText("A rule of yours covers it");
    await expect(page.getByTestId("sandbox-rules-error")).toHaveCount(0);
    expect((await app.store.rules()).filter((rule) => rule.target === app.beside)).toHaveLength(1);

    // The directory goes while its rule stays: the command still runs, and reads nothing there.
    await rm(app.beside, { recursive: true, force: true });
    const after = await app.turn();
    expect(after).toMatch(/read=1/);
    expect(after).toContain("inside");
    expect(after).not.toContain("beside-notes");
    // The rule is still listed: the user decides, not the server.
    await expect(page.getByTestId("sandbox-rules-list")).toContainText(`Always allow read ${app.beside}`);
  } finally {
    await app.stop();
  }
});
