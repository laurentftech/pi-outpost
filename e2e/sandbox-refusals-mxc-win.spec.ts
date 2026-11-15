/**
 * What MXC refused, in the running app, on Windows (`durable-sandbox-rules`): MXC on Windows reports
 * refused files only on demand. A command of the agent's reads beside the root and fails; its result
 * ends offering a diagnosis; the agent asks for one, which names the directory; the lock says
 * refusals are recorded on demand and lists it; an always-allow made there opens the directory to
 * the next command; a revoke closes it again. Then a pass that tries to break it.
 *
 * Nothing stands in for the runner: `"mxc"` is MXC itself, on Windows 11 tier 1 — no CI runner has
 * it, so `npx playwright test --config e2e/playwright.config.ts sandbox-refusals-mxc-win` on such a
 * machine. The provider is scripted, so each turn runs the command, then the same with `diagnose`.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { connect, makeWorkspace, startServer } from "../server/test/harness.mjs";
import { SandboxRulesStore } from "../server/src/sandboxRules.ts";

const provider = fileURLToPath(new URL("../server/test/fixtures/bash-call-provider.mjs", import.meta.url));
const model = { provider: "bash-call-test", id: "bash-call-test" };
const POWERSHELL = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

test.skip(process.platform !== "win32", "MXC reports on demand on Windows only");
// Each test starts its own server and runs agent turns under a real sandbox.
test.describe.configure({ timeout: 240_000 });

const escape = (text: string) => text.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
// The offer ends the command's output; pi itself adds only the exit status after it.
const OFFER_ENDS = /run the same command again with diagnose: true[^\n]*\n(?:\s*Command exited with code \d+)?\s*$/;
const quoted =(p: string) => `'${p.replaceAll("'", "''")}'`;

async function start() {
  const root = await realpath(await makeWorkspace({ "inside.txt": "inside" }));
  const beside = `${root}-beside`;
  await mkdir(beside, { recursive: true });
  await writeFile(path.join(beside, "notes.txt"), "beside-notes\n");
  const agentDir = path.join(root, ".pi-agent");
  const store = new SandboxRulesStore({ agentDir, root });
  const log = path.join(root, "results.json");
  // The refused read last, so the command's exit status is its failure.
  const command = `Get-Content inside.txt; Get-Content ${quoted(path.join(beside, "notes.txt"))}`;
  const server = await startServer(
    root,
    { sandbox: { root, allowWrite: true, allowBash: true, bashRunner: "mxc", bashShell: POWERSHELL }, extensionPaths: [provider], allowedModels: [model] },
    {
      env: {
        BASH_CALL_LOG: log,
        BASH_CALL_STEPS: JSON.stringify([
          { tool: "powershell", args: { command } },
          { tool: "powershell", args: { command, diagnose: true } },
        ]),
      },
    },
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
    /** One turn: the command, then its diagnosis; what the agent read of each comes back. */
    async turn(): Promise<{ run: string; diagnosis: string }> {
      await rm(log, { force: true });
      client.send({ type: "prompt", text: "Go." });
      for (let i = 0; i < 1200; i++) {
        const text = await readFile(log, "utf8").catch(() => undefined);
        if (text) {
          const results = (JSON.parse(text) as Array<{ content: Array<{ text?: string }> }>).map((r) => r.content.map((c) => c.text ?? "").join(""));
          if (results.length >= 2) return { run: results[0], diagnosis: results[1] };
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("the agent never finished");
    },
    async stop() {
      client.close();
      await server.stop();
      await rm(beside, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    },
  };
}

// openlore: scenario=AFailureOnWindowsOffersADiagnosis spec=sandbox-durable-rules
// openlore: scenario=ADiagnosisNamesTheRefusedDirectory spec=sandbox-durable-rules
// openlore: scenario=ARunnerThatReportsOnDemandSaysSo spec=sandbox-durable-rules
test("under MXC on Windows: a refused read offers a diagnosis, the diagnosis names the directory, the lock lists it, and an always-allow made there opens it to the next command", async ({ page }) => {
  const app = await start();
  try {
    await page.goto(app.server.base);
    await expect(page.getByRole("textbox", { name: /message pi/i })).toBeEnabled();

    // Before any command: nothing recorded, and the sentence that this runner reports on demand.
    await page.getByTestId("sandbox-rules-toggle").click();
    await expect(page.getByTestId("sandbox-refusals-none")).toBeVisible();
    await expect(page.getByTestId("sandbox-rules-files")).toContainText("only when the agent asks for a diagnosis");
    await page.keyboard.press("Escape");

    const first = await app.turn();
    expect(first.run).toContain("inside");
    expect(first.run).not.toContain("beside-notes");
    // Nothing named by the command itself: the offer ends it.
    expect(first.run).not.toContain(`refused reading ${app.beside}`);
    expect(first.run).toMatch(OFFER_ENDS);
    expect(first.diagnosis).not.toContain("beside-notes");
    expect(first.diagnosis).toMatch(new RegExp(`diagnosis: the sandbox refused reading ${escape(app.beside)}\\.`, "i"));

    await page.getByTestId("sandbox-rules-toggle").click();
    const besideRow = page.getByTestId("sandbox-refusals-list").locator("li", { hasText: new RegExp(`reading ${escape(app.beside)}`, "i") });
    await expect(besideRow).toBeVisible();
    const recorded = await app.store.refusals();
    expect(recorded.some((r) => r.kind === "directory" && r.access === "read" && r.target.toLowerCase() === app.beside.toLowerCase())).toBe(true);

    await besideRow.getByRole("button", { name: "Always allow" }).click();
    await expect(besideRow).toContainText("A rule of yours covers it");
    await expect(page.getByTestId("sandbox-rules-list")).toContainText(new RegExp(`Always allow read ${escape(app.beside)}`, "i"));

    // The same command, a new turn: MXC lets the read through, and offers nothing.
    const second = await app.turn();
    expect(second.run).toContain("beside-notes");
    expect(second.run).not.toMatch(/diagnose: true/);

    // Revoked in one click: the next command is refused again, and the diagnosis says so.
    await page.getByTestId("sandbox-rules-list").getByRole("button", { name: "Revoke" }).click();
    await expect(page.getByTestId("sandbox-rules-none")).toBeVisible();
    const third = await app.turn();
    expect(third.run).not.toContain("beside-notes");
    expect(third.run).toMatch(OFFER_ENDS);
    expect(third.diagnosis).toMatch(new RegExp(`diagnosis: the sandbox refused reading ${escape(app.beside)}\\.`, "i"));
  } finally {
    await app.stop();
  }
});

test("break it under MXC on Windows: always allow clicked twice, the directory deleted under its rule, the panel open across turns", async ({ page }) => {
  const app = await start();
  try {
    await page.goto(app.server.base);
    await expect(page.getByRole("textbox", { name: /message pi/i })).toBeEnabled();
    // The panel is open before the first refusal exists, and stays open.
    await page.getByTestId("sandbox-rules-toggle").click();
    await expect(page.getByTestId("sandbox-refusals-none")).toBeVisible();

    await app.turn();
    // The diagnosis' refusal reaches the open panel, unasked.
    const besideRow = page.getByTestId("sandbox-refusals-list").locator("li", { hasText: new RegExp(`reading ${escape(app.beside)}`, "i") });
    await expect(besideRow).toBeVisible();

    // Twice at once: one rule, no error.
    await besideRow.getByRole("button", { name: "Always allow" }).dblclick();
    await expect(besideRow).toContainText("A rule of yours covers it");
    await expect(page.getByTestId("sandbox-rules-error")).toHaveCount(0);
    expect((await app.store.rules()).filter((rule) => rule.target.toLowerCase() === app.beside.toLowerCase())).toHaveLength(1);

    // The directory goes while its rule stays: the command still runs, and reads nothing there.
    await rm(app.beside, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    const after = await app.turn();
    expect(after.run).toContain("inside");
    expect(after.run).not.toContain("beside-notes");
    // The rule is still listed: the user decides, not the server.
    await expect(page.getByTestId("sandbox-rules-list")).toContainText(new RegExp(`Always allow read ${escape(app.beside)}`, "i"));
  } finally {
    await app.stop();
  }
});
