/**
 * Settings applied from a project that is not the first one.
 *
 * Each open project is confined to its own directory. The Settings panel shows the
 * server's sandbox — the first project's root — and sends it back whole on Apply,
 * whatever was changed. Applied from another project, that must not move that
 * project's boundary to the first project's directory.
 */
import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import { test } from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

async function listRoot(client, requestId) {
  client.send({ type: "list_directory", path: ".", requestId });
  const reply = await client.waitFor((message) => message.requestId === requestId);
  return (reply.entries ?? []).map((entry) => entry.name).sort();
}

test("applying Settings from a second project leaves it confined to its own directory", async (t) => {
  const alpha = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  const beta = await realpath(await makeWorkspace({ "b.md": "beta\n" }));
  const server = await startServer(alpha, {
    openProjects: [beta],
    sandbox: { root: alpha, allowWrite: true, allowBash: false },
  });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());

  const hello = await client.waitFor((message) => message.type === "hello");
  client.send({ type: "switch_workspace", root: beta });
  await client.waitFor((message) => message.type === "workspace_switched");
  assert.ok((await listRoot(client, "before")).includes("b.md"), "the second project shows its own files");

  // What the panel sends on Apply: the sandbox it was shown, unchanged.
  const shown = hello.sandbox;
  client.send({ type: "update_config", sandbox: { root: shown.root, allowWrite: shown.allowWrite, allowBash: shown.allowBash } });
  const ack = await client.waitFor((message) => message.type === "update_config_ack" || message.type === "error");
  assert.equal(ack.type, "update_config_ack", ack.message);

  const after = await listRoot(client, "after");
  assert.ok(after.includes("b.md"), `still its own directory after Apply; it lists ${JSON.stringify(after)}`);
  assert.ok(!after.includes("a.md"), "not the first project's");
});

test("changing a permission from a second project rebuilds it inside its own directory, with the new permission", async (t) => {
  const alpha = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  const beta = await realpath(await makeWorkspace({ "b.md": "beta\n" }));
  const server = await startServer(alpha, {
    openProjects: [beta],
    sandbox: { root: alpha, allowWrite: false, allowBash: false },
  });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());

  const hello = await client.waitFor((message) => message.type === "hello");
  client.send({ type: "switch_workspace", root: beta });
  const switched = await client.waitFor((message) => message.type === "workspace_switched");
  // What the panel is shown: this project's own boundary, and no root to edit.
  assert.equal(switched.sandbox?.projectRoot ?? hello.sandbox.projectRoot, beta);
  assert.equal(switched.sandbox?.rootEditable, false);

  // Write turned on, and a root typed in regardless — which a second project cannot move.
  client.send({ type: "update_config", sandbox: { root: alpha, allowWrite: true, allowBash: false } });
  const ack = await client.waitFor((message) => message.type === "update_config_ack" || message.type === "error");
  assert.equal(ack.type, "update_config_ack", ack.message);
  assert.equal(ack.sandbox.allowWrite, true, "the permission is applied");
  assert.equal(ack.sandbox.projectRoot, beta, "and the project keeps its own directory");
  // Relative to this project's browser root: "" is the whole of it writable.
  assert.equal(ack.writableRoot, "", "writing is allowed in this project's own directory");
  const after = await listRoot(client, "after-permission");
  assert.ok(after.includes("b.md") && !after.includes("a.md"), JSON.stringify(after));
});

test("the server's own project, open alone, still edits its root", async (t) => {
  const alpha = await realpath(await makeWorkspace({ "a.md": "alpha\n", "inner/c.md": "inner\n" }));
  const server = await startServer(alpha, { sandbox: { root: alpha, allowWrite: false, allowBash: false } });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  const hello = await client.waitFor((message) => message.type === "hello");
  assert.equal(hello.sandbox.rootEditable, true);

  client.send({ type: "update_config", sandbox: { root: `${alpha}/inner`, allowWrite: false, allowBash: false } });
  const ack = await client.waitFor((message) => message.type === "update_config_ack" || message.type === "error");
  assert.equal(ack.type, "update_config_ack", ack.message);
  assert.equal(ack.sandbox.root, `${alpha}/inner`);
  assert.deepEqual(await listRoot(client, "inner"), ["c.md"]);
});

test("write can be turned off and on again from a second project while the server keeps a writable root", async (t) => {
  // Found at the bench: the roots cannot be edited from a second project, so the
  // server's writable root is kept — and a writable root without write used to make
  // the configuration refuse to save.
  const alpha = await realpath(await makeWorkspace({ "a.md": "alpha\n", "out/keep.md": "kept\n" }));
  const beta = await realpath(await makeWorkspace({ "b.md": "beta\n" }));
  const server = await startServer(alpha, {
    openProjects: [beta],
    sandbox: { root: alpha, allowWrite: true, writableRoot: `${alpha}/out`, allowBash: false },
  });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor((message) => message.type === "hello");
  client.send({ type: "switch_workspace", root: beta });
  await client.waitFor((message) => message.type === "workspace_switched");

  client.send({ type: "update_config", sandbox: { root: alpha, allowWrite: false, allowBash: false, writableRoot: `${alpha}/out` } });
  const off = await client.waitFor((message) => message.type === "update_config_ack" || message.type === "error");
  assert.equal(off.type, "update_config_ack", off.message);
  assert.equal(off.sandbox.allowWrite, false);
  assert.equal(off.writableRoot, null, "nothing is writable in this project");
  assert.equal(off.sandbox.writableRoot, `${alpha}/out`, "the server's writable root is kept");

  client.send({ type: "update_config", sandbox: { root: alpha, allowWrite: true, allowBash: false, writableRoot: `${alpha}/out` } });
  // The harness can hand back a message already received: wait for this acknowledgement.
  const on = await client.waitFor(
    (message) => (message.type === "update_config_ack" && message.sandbox.allowWrite === true) || message.type === "error",
  );
  assert.equal(on.type, "update_config_ack", on.message);
  assert.equal(on.writableRoot, "", "this project is writable in its own directory again");
});
