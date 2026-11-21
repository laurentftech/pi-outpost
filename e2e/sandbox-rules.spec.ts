/**
 * The user's durable sandbox rules in the running app (`durable-sandbox-rules`): made from the
 * grant dialog, listed and revoked from the shell's lock, and then a pass that tries to break it —
 * two clients answering at once, a rule on a directory deleted since, a revoke clicked twice, a
 * panel left open while a rule is made elsewhere.
 *
 * The provider and the broker are real; node stands in for the sandbox runner, as in
 * `sandbox-question-context.spec.ts`, and prints the policy each launch was handed so the tool
 * results show what a rule really gave a command.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, realpath, rm } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { connect, makeWorkspace, startServer } from "../server/test/harness.mjs";
import { SandboxRulesStore } from "../server/src/sandboxRules.ts";

const provider = fileURLToPath(new URL("../server/test/fixtures/bash-call-provider.mjs", import.meta.url));
const doctor = fileURLToPath(new URL("../server/test/fixtures/fake-runner-doctor.cjs", import.meta.url));
const model = { provider: "bash-call-test", id: "bash-call-test" };

// Prints what the launch may read, then runs the "shell" (node) on the command's script.
const runner = `const fs = require("node:fs");
const { spawn } = require("node:child_process");
const args = process.argv.slice(2);
const policy = JSON.parse(fs.readFileSync(args[args.indexOf("-p") + 1], "utf8"));
process.stdout.write("readable=" + JSON.stringify(policy.filesystem.allowRead) + "\\n");
const [shell, script] = args.slice(args.indexOf("--") + 1);
spawn(shell, [script], {stdio:"inherit",env:process.env}).on("exit", code => process.exit(code ?? 1));`;

const ran = `console.log("ran")`;
const slash = (p: string) => p.replaceAll("\\", "/");
const readableIn = (text: string, dir: string) => (JSON.parse(/readable=(\[.*\])/.exec(text)?.[1] ?? "[]") as string[]).some((p) => slash(p) === slash(dir));
const grantStep = (dir: string) => ({ tool: "run_with_grant", args: { command: ran, reason: "read the notes beside the project", directories: [{ path: dir, access: "read" }] } });
const bashStep = { tool: "bash", args: { command: ran } };

// Each test starts its own server and runs an agent turn: more than the suite's default budget.
test.describe.configure({ timeout: 120_000 });

type Steps = (paths: { root: string; beside: string }) => unknown[];

async function start(steps: Steps, before?: (paths: { root: string; beside: string; store: SandboxRulesStore }) => Promise<void>) {
  const root = await realpath(await makeWorkspace({ run: runner }));
  const beside = `${root}-beside`;
  await mkdir(beside, { recursive: true });
  const store = new SandboxRulesStore({ agentDir: path.join(root, ".pi-agent"), root });
  await before?.({ root, beside, store });
  const log = path.join(root, "results.json");
  const server = await startServer(
    root,
    { sandbox: { root, allowWrite: true, allowBash: true, bashRunner: process.execPath, bashShell: process.execPath }, extensionPaths: [provider], allowedModels: [model] },
    { env: { BASH_CALL_LOG: log, BASH_CALL_STEPS: JSON.stringify(steps({ root, beside })), NODE_OPTIONS: `--require "${doctor.replaceAll("\\", "/")}"` } },
  );
  const client = connect(server.wsUrl());
  await client.waitFor("hello", 30_000);
  return {
    root,
    beside,
    server,
    client,
    store,
    /** The agent's turn: its tool results once it has finished. */
    async go() {
      client.send({ type: "set_model", ...model });
      await client.waitFor("model_changed");
      client.send({ type: "prompt", text: "Go." });
    },
    async results(): Promise<string[]> {
      for (let i = 0; i < 300; i++) {
        const text = await readFile(log, "utf8").catch(() => undefined);
        if (text) return (JSON.parse(text) as Array<{ content: Array<{ text?: string }> }>).map((r) => r.content.map((c) => c.text ?? "").join(""));
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("the agent never finished");
    },
    async stop() {
      client.close();
      await server.stop();
    },
  };
}

// openlore: scenario=ARuleIsMadeFromARecordedRefusal spec=sandbox-durable-rules
// openlore: scenario=RulesAreListedAndRevoked spec=sandbox-durable-rules
test("always allow from the dialog: the rule is listed under the shell's lock, the next request is not asked, and it is revoked there", async ({ page }) => {
  const app = await start(({ beside }) => [grantStep(beside), grantStep(beside), bashStep]);
  try {
    await page.goto(`${app.server.base}/?token=${encodeURIComponent(app.server.token)}`);
    await expect(page.getByRole("textbox", { name: /message pi/i })).toBeEnabled();

    // Before anything: the panel opens on no rule, and closes on Escape.
    await page.getByTestId("sandbox-rules-toggle").click();
    await expect(page.getByTestId("sandbox-rules-none")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("sandbox-rules-panel")).toHaveCount(0);

    await app.go();
    const dialog = page.getByTestId("sandbox-grant-dialog");
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole("button", { name: "Always allow" }).click();
    await expect(dialog).toHaveCount(0);

    const results = await app.results();
    expect(results[0]).toMatch(/always, from now on/);
    expect(results[1]).toMatch(/already gives what was asked/);
    expect(readableIn(results[2], app.beside)).toBe(true);
    expect(app.client.received.filter((m: { type: string }) => m.type === "sandbox_grant_request")).toHaveLength(1);

    // The lock lists it, as the store holds it.
    await page.getByTestId("sandbox-rules-toggle").click();
    const list = page.getByTestId("sandbox-rules-list");
    await expect(list).toContainText(`Always allow read ${app.beside}`);
    const [kept] = await app.store.rules();
    expect(kept).toMatchObject({ kind: "directory", target: app.beside, access: "read", decision: "allow" });

    // Revoked in one click: gone from the panel and from the store.
    await list.getByRole("button", { name: "Revoke" }).click();
    await expect(page.getByTestId("sandbox-rules-none")).toBeVisible();
    expect(await app.store.rules()).toEqual([]);
  } finally {
    await app.stop();
  }
});

test("a recorded refusal becomes a rule from the panel, and the agent directory is offered none", async ({ page }) => {
  const app = await start(() => [bashStep], async ({ root, beside, store }) => {
    await store.record({ kind: "directory", target: beside, access: "read", command: "cat ../beside/notes.txt" });
    await store.record({ kind: "directory", target: path.join(root, ".pi-agent"), access: "read", command: "cat auth.json" });
  });
  try {
    await page.goto(`${app.server.base}/?token=${encodeURIComponent(app.server.token)}`);
    await page.getByTestId("sandbox-rules-toggle").click();
    const refusals = page.getByTestId("sandbox-refusals-list");
    await expect(refusals).toContainText(`reading ${app.beside}`);
    const keysRow = refusals.locator("li", { hasText: ".pi-agent" });
    await expect(keysRow.getByRole("button", { name: "Always allow" })).toHaveCount(0);
    await expect(keysRow.getByTestId("sandbox-refusal-not-allowable")).toContainText("the agent directory holds the provider keys");

    const besideRow = refusals.locator("li", { hasText: `reading ${app.beside}` });
    await besideRow.getByRole("button", { name: "Always allow" }).click();
    await expect(besideRow).toContainText("A rule of yours covers it");
    await expect(page.getByTestId("sandbox-rules-list")).toContainText(`Always allow read ${app.beside}`);

    await app.go();
    const [result] = await app.results();
    expect(readableIn(result, app.beside)).toBe(true);
  } finally {
    await app.stop();
  }
});

test("break it: two clients answer at once, a rule's directory is deleted, a revoke is clicked twice, a panel stays open while a rule is made elsewhere", async ({ page }) => {
  const app = await start(({ beside }) => [grantStep(beside), bashStep], async ({ store }) => {
    await store.record({ kind: "host", target: "elsewhere.example.com", command: "curl https://elsewhere.example.com" });
  });
  try {
    await page.goto(`${app.server.base}/?token=${encodeURIComponent(app.server.token)}`);
    await expect(page.getByRole("textbox", { name: /message pi/i })).toBeEnabled();
    // The panel is open before anything happens, and stays open throughout.
    await page.getByTestId("sandbox-rules-toggle").click();
    await expect(page.getByTestId("sandbox-rules-none")).toBeVisible();
    await expect(page.getByTestId("sandbox-refusals-list")).toContainText("host elsewhere.example.com");

    await app.go();
    const { request } = await app.client.waitFor("sandbox_grant_request", 30_000);
    const dialog = page.getByTestId("sandbox-grant-dialog");
    await expect(dialog).toBeVisible();
    // Two clients at once: the other refuses for this command alone, the page says always allow.
    // The page's button may be gone before its click lands: that is the race, not a failure.
    await Promise.all([
      Promise.resolve(app.client.send({ type: "sandbox_grant_response", id: request.id, decision: "refuse" })),
      dialog.getByRole("button", { name: "Always allow" }).click({ timeout: 3_000 }).catch(() => {}),
    ]);
    const resolved = (await app.client.waitFor((m: { type: string; id?: string }) => m.type === "sandbox_grant_resolved" && m.id === request.id)) as unknown as { outcome: string };
    // Exactly one resolution, whoever answered.
    expect(app.client.received.filter((m: { type: string; id?: string }) => m.type === "sandbox_grant_resolved" && m.id === request.id)).toHaveLength(1);
    await expect(dialog).toHaveCount(0);
    await app.results();
    // The first answer decided; a rule exists only if that answer was the page's.
    const rules = await app.store.rules();
    if (resolved.outcome === "refused") expect(rules).toEqual([]);
    else expect(resolved.outcome).toBe("approved-always");
    // Whatever won, the open panel shows what the store holds.
    if (rules.length === 0) await expect(page.getByTestId("sandbox-rules-none")).toBeVisible();
    else await expect(page.getByTestId("sandbox-rules-list")).toBeVisible();

    // A rule made by another client reaches the open panel, unasked.
    app.client.send({ type: "sandbox_rule_set", refusalKey: "host:elsewhere.example.com", decision: "refuse" });
    await expect(page.getByTestId("sandbox-rules-list")).toContainText("Always refuse host elsewhere.example.com");
    const made = (await app.store.rules()).find((rule) => rule.target === "elsewhere.example.com")!;
    await expect(page.locator(`[data-refusal-key="host:elsewhere.example.com"]`)).toContainText("A rule of yours covers it");

    // Revoke clicked twice: one revoke, no error, the list consistent.
    const revoke = page.locator(`[data-rule-id="${made.id}"]`).getByRole("button", { name: "Revoke" });
    await revoke.dblclick();
    await expect(page.locator(`[data-rule-id="${made.id}"]`)).toHaveCount(0);
    await expect(page.getByTestId("sandbox-rules-error")).toHaveCount(0);
  } finally {
    await app.stop();
  }
});

test("break it: a rule on a directory deleted since does not stop the next command", async ({ page }) => {
  const app = await start(() => [bashStep], async ({ beside, store }) => {
    await store.setRule({ kind: "directory", target: beside, access: "read", decision: "allow" });
    await rm(beside, { recursive: true, force: true });
  });
  try {
    await page.goto(`${app.server.base}/?token=${encodeURIComponent(app.server.token)}`);
    await app.go();
    const [result] = await app.results();
    expect(result).toMatch(/ran/);
    expect(readableIn(result, app.beside)).toBe(false);
    // The rule is still listed: the user decides, not the server.
    await page.getByTestId("sandbox-rules-toggle").click();
    await expect(page.getByTestId("sandbox-rules-list")).toContainText(app.beside);
  } finally {
    await app.stop();
  }
});

test("break it: a rule revoked while a command runs holds for that command and is gone from the next", async ({ page }) => {
  const slow = `setTimeout(() => console.log("ran"), 4000)`;
  const app = await start(() => [{ tool: "bash", args: { command: slow } }, bashStep], async ({ beside, store }) => {
    await store.setRule({ kind: "directory", target: beside, access: "read", decision: "allow" });
  });
  try {
    await page.goto(`${app.server.base}/?token=${encodeURIComponent(app.server.token)}`);
    await expect(page.getByRole("textbox", { name: /message pi/i })).toBeEnabled();
    await page.getByTestId("sandbox-rules-toggle").click();
    await expect(page.getByTestId("sandbox-rules-list")).toContainText(app.beside);
    await app.go();
    // The first command is running: its tool row is there, and its result is not.
    await expect(page.getByRole("button", { name: "bash" }).first()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("sandbox-rules-list").getByRole("button", { name: "Revoke" }).click();
    await expect(page.getByTestId("sandbox-rules-none")).toBeVisible();
    const [during, next] = await app.results();
    expect(during).toMatch(/ran/);
    expect(readableIn(during, app.beside)).toBe(true);
    expect(readableIn(next, app.beside)).toBe(false);
  } finally {
    await app.stop();
  }
});
