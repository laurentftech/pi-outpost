/**
 * Pi's `defaultTools` setting under a sandbox.
 *
 * The sandbox replaces Pi's built-in toolset, which the SDK can only express as
 * `noTools: "builtin"` — and that option also makes the SDK skip `defaultTools`
 * entirely. Tools Pi registers inactive (`codemode`, `tool_search`) are switched on
 * by nothing else, so a user who enabled them for `pi` found them missing here.
 *
 * The harness runs with a sandbox, so these tests are the sandboxed case.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

async function activeToolsWith(settings) {
  const root = await makeWorkspace();
  if (settings) {
    const agentDir = path.join(root, ".pi-agent");
    await mkdir(agentDir, { recursive: true });
    await writeFile(path.join(agentDir, "settings.json"), JSON.stringify(settings));
  }
  const server = await startServer(root);
  const client = connect(server.wsUrl());
  try {
    const hello = await client.waitFor("hello", 30_000);
    return {
      active: hello.tools.filter((tool) => tool.active).map((tool) => tool.name),
      all: hello.tools.map((tool) => tool.name),
    };
  } finally {
    client.close();
    await server.stop();
  }
}

test("defaultTools activates codemode and tool_search under a sandbox", async () => {
  const { active } = await activeToolsWith({ defaultTools: ["+codemode", "+tool_search"] });
  assert.ok(active.includes("codemode"), `codemode active: ${active.join(", ")}`);
  assert.ok(active.includes("tool_search"), `tool_search active: ${active.join(", ")}`);
  // The sandboxed file tools stay as they were.
  for (const name of ["read", "write", "edit"]) assert.ok(active.includes(name), `${name} still active`);
});

test("without defaultTools, codemode and tool_search stay registered but inactive", async () => {
  const { active, all } = await activeToolsWith(undefined);
  assert.ok(all.includes("codemode") && all.includes("tool_search"), "both are registered");
  assert.ok(!active.includes("codemode"), "codemode is not switched on uninvited");
  assert.ok(!active.includes("tool_search"), "tool_search is not switched on uninvited");
});

test("defaultTools cannot bring back a built-in the sandbox withholds", async () => {
  // allowBash is false in the harness: the sandbox ships no bash, and a setting
  // naming it must not resurrect Pi's unconfined one.
  const { active } = await activeToolsWith({ defaultTools: ["read", "bash", "codemode"] });
  assert.ok(!active.includes("bash"), "bash stays off");
  assert.ok(active.includes("codemode"), "codemode still honoured");
});

const CODEMODE_PROVIDER = fileURLToPath(new URL("./fixtures/codemode-provider.mjs", import.meta.url));

test("a codemode script runs under the sandbox and is confined by it", async () => {
  const root = await makeWorkspace({ "inside.txt": "INSIDE-MARKER" });
  const elsewhere = await mkdtemp(path.join(os.tmpdir(), "codemode-outside-"));
  const outside = path.join(elsewhere, "secret.txt");
  await writeFile(outside, "OUTSIDE-MARKER");
  const agentDir = path.join(root, ".pi-agent");
  await mkdir(agentDir, { recursive: true });
  await writeFile(path.join(agentDir, "settings.json"), JSON.stringify({ defaultTools: ["+codemode"] }));
  const log = path.join(elsewhere, "codemode-result.txt");

  const server = await startServer(
    root,
    { extensionPaths: [CODEMODE_PROVIDER], allowedModels: [{ provider: "codemode-test", id: "codemode-test" }] },
    { env: { CODEMODE_LOG: log } },
  );
  const client = connect(server.wsUrl());
  try {
    await client.waitFor("hello", 30_000);
    client.send({ type: "set_model", provider: "codemode-test", id: "codemode-test" });
    await client.waitFor((message) => message.type === "model_changed");
    client.send({ type: "prompt", text: `RUN CODEMODE ${outside}` });

    const deadline = Date.now() + 60_000;
    let result = "";
    while (!result && Date.now() < deadline) {
      result = await readFile(log, "utf8").catch(() => "");
      if (!result) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.match(result, /Script completed/, `the script ran: ${result}`);
    assert.match(result, /INSIDE-MARKER/, "a file inside the workspace is readable from a script");
    assert.doesNotMatch(result, /OUTSIDE-MARKER/, "a file outside the sandbox is not");
    assert.match(result, /outsideError/, "the outside read was refused, not skipped");
    assert.match(result, /"bash":\s*"undefined"/, "a script cannot reach the unconfined bash");
  } finally {
    client.close();
    await server.stop();
    await rm(elsewhere, { recursive: true, force: true });
  }
});
