/**
 * The operator's rule over slash commands, over a real connection and a real extension.
 *
 * The extension registers a setup command the deployment blocks, a command it allows, and
 * a `session_start` hook. Each command's handler leaves a file behind when it runs, so a
 * refused command is proved not to have run rather than assumed, and the hook's file
 * proves the extension itself kept working.
 *
 * Each subtest boots a server. Keep the count low.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { connect, startServer } from "./harness.mjs";

const NOT_AVAILABLE = "This command is not available.";

/** An extension whose commands and hook each leave a marker file in `markers`. */
async function extensionDir(root, markers) {
  const dir = path.join(root, "operator-extension");
  await mkdir(dir, { recursive: true });
  const mark = (name) => JSON.stringify(path.join(markers, name));
  await writeFile(
    path.join(dir, "index.ts"),
    `import { writeFileSync } from "node:fs";
export default (pi) => {
  pi.on("session_start", async () => { writeFileSync(${mark("hook-ran")}, "yes"); });
  pi.registerCommand("setup-creds", { description: "reconfigure credentials", handler: async () => { writeFileSync(${mark("setup-ran")}, "yes"); } });
  pi.registerCommand("status", { description: "show status", handler: async () => { writeFileSync(${mark("status-ran")}, "yes"); } });
};
`,
  );
  return dir;
}

const commandNames = (message) => (message.commands ?? []).map((command) => command.name);

async function eventually(check, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return check();
}

/** The next error the server sends this client after `send`. */
async function errorAfter(client, frame) {
  const seen = client.received.filter((message) => message.type === "error").length;
  client.send(frame);
  return client.waitFor((message) => message.type === "error" && client.received.filter((m) => m.type === "error").indexOf(message) >= seen, 15_000);
}

/**
 * No provider credentials reach the server: a message that is not refused would otherwise
 * go to a real model on a developer's machine, at their cost.
 */
const NO_CREDENTIALS = Object.fromEntries(
  Object.keys(process.env)
    .filter((key) => /(_API_KEY|_AUTH_TOKEN|_ACCESS_TOKEN)$/.test(key))
    .map((key) => [key, undefined]),
);

async function boot(config) {
  const root = await mkdtemp(path.join(tmpdir(), "pi-outpost-command-policy-wire-"));
  const markers = path.join(root, "markers");
  await mkdir(markers);
  const extension = await extensionDir(root, markers);
  const server = await startServer(root, { extensionPaths: [extension], ...config }, { env: NO_CREDENTIALS });
  const client = connect(server.wsUrl());
  await client.open();
  const hello = await client.waitFor("hello", 30_000);
  return { root, markers, server, client, hello };
}

describe("slash commands the operator keeps from users", () => {
  test("BlockedCommandsAreNotOffered + ATypedBlockedCommandDoesNotRun + TheExtensionKeepsWorking", async () => {
    const { root, markers, server, client, hello } = await boot({ blockedCommands: ["setup*"] });
    try {
      assert.ok(commandNames(hello).includes("status"), "precondition: the extension's commands reached the client");
      assert.ok(!commandNames(hello).includes("setup-creds"), "the blocked command is not offered");
      for (const message of client.received.filter((m) => m.type === "extensions_bound")) {
        assert.ok(!commandNames(message).includes("setup-creds"), "nor offered when extensions bind late");
      }

      // Typed anyway, in any case: refused, with a message that does not name it, nothing echoed, nothing run.
      for (const text of ["/setup-creds key=abc", "/SETUP-creds", "  /setup-creds"]) {
        const error = await errorAfter(client, { type: "prompt", text });
        assert.equal(error.message, NOT_AVAILABLE);
        assert.ok(!/setup/i.test(error.message));
      }
      // Through the edit of a past message too — refused before any rewind.
      const editError = await errorAfter(client, { type: "edit_prompt", entryId: "any-entry", text: "/setup-creds" });
      assert.equal(editError.message, NOT_AVAILABLE);
      assert.equal(client.received.filter((m) => m.type === "user").length, 0, "no refused prompt was echoed");

      // An allowed command of the same extension still runs, and its hook ran.
      client.send({ type: "prompt", text: "/status" });
      assert.ok(await eventually(() => existsSync(path.join(markers, "status-ran"))), "the allowed command ran");
      assert.ok(existsSync(path.join(markers, "hook-ran")), "the extension's hook ran: it is still loaded");
      assert.ok(!existsSync(path.join(markers, "setup-ran")), "the blocked command never ran");
    } finally {
      client.close();
      await server.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("AnAllowlistLimitsTheCommands: only what it names, and a message beginning with a slash is still a message", async () => {
    const { root, markers, server, client, hello } = await boot({ allowedCommands: ["status"] });
    try {
      assert.deepEqual(commandNames(hello), ["status"]);
      const error = await errorAfter(client, { type: "prompt", text: "/setup-creds" });
      assert.equal(error.message, NOT_AVAILABLE);

      // Not a command the runtime has: it goes on as a message (and fails for want of a
      // model here — but not with the command refusal).
      const plain = await errorAfter(client, { type: "prompt", text: "/tmp is full" });
      assert.notEqual(plain.message, NOT_AVAILABLE);

      client.send({ type: "prompt", text: "/status" });
      assert.ok(await eventually(() => existsSync(path.join(markers, "status-ran"))));
      assert.ok(!existsSync(path.join(markers, "setup-ran")));
    } finally {
      client.close();
      await server.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
});
