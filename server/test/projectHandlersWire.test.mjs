/**
 * Opening, closing and side sessions where they go wrong, and the notifications of a
 * project opened after the server started. One server runs every scenario: a server
 * boot costs more than all of them together.
 */
import assert from "node:assert/strict";
import { realpath, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { connect, makeWorkspace } from "./harness.mjs";
import { next, secondProject, startScriptedServer } from "./multiProjectHarness.mjs";

test("project handlers, scenario after scenario on one server", async (t) => {
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  const gamma = await secondProject("gamma");
  const broken = await secondProject("broken");
  const server = await startScriptedServer(root, [], {
    // This project's agent fails to start; every other one starts.
    startupFailureByCwd: { [broken]: "the agent refused to start here" },
  });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor((m) => m.type === "hello");
  const workspaceError = () => next(client, (m) => m.type === "workspace_error");
  /** Listing a directory is what makes the server watch it. */
  let requests = 0;
  const watch = async (dirPath) => {
    const requestId = `watch-${++requests}`;
    const listed = next(client, (m) => m.requestId === requestId);
    client.send({ type: "list_directory", path: dirPath, requestId });
    assert.equal((await listed).type, "directory_listing");
  };

  await t.test("a file is not a project", async () => {
    const file = path.join(root, "a.md");
    const refused = workspaceError();
    client.send({ type: "open_project", root: file });
    assert.equal((await refused).message, `Cannot open ${file}: not a directory`);
  });

  await t.test("closing, or starting a side session on, a project that is not open is refused by name", async () => {
    const elsewhere = path.join(root, "never-opened");
    let refused = workspaceError();
    client.send({ type: "close_project", root: elsewhere });
    assert.equal((await refused).message, `No open project at ${elsewhere}`);
    refused = workspaceError();
    client.send({ type: "open_side_session", root: elsewhere });
    assert.equal((await refused).message, `No open project at ${elsewhere}`);
  });

  await t.test("a project opened later tells its clients about its files", async () => {
    const switched = next(client, (m) => m.type === "workspace_switched" && m.workspace?.root === gamma);
    client.send({ type: "open_project", root: gamma });
    assert.equal((await switched).workspace.id, gamma);
    await watch("");
    const changed = next(client, (m) => m.type === "directory_changed" && m.path === "");
    await writeFile(path.join(gamma, "appeared.md"), "new\n");
    await changed;
  });

  await t.test("a side session tells its clients about the project's files", async () => {
    const switched = next(client, (m) => m.type === "workspace_switched" && m.workspace?.root === gamma && m.workspace.id !== gamma);
    client.send({ type: "open_side_session", root: gamma });
    await switched;
    await watch("");
    const changed = next(client, (m) => m.type === "directory_changed" && m.path === "");
    await writeFile(path.join(gamma, "from-the-side.md"), "side\n");
    await changed;
  });

  await t.test("a project whose agent cannot start says so, and the client is taken back to one that runs", async () => {
    const refused = workspaceError();
    const back = next(client, (m) => m.type === "workspace_switched");
    client.send({ type: "open_project", root: broken });
    const { message } = await refused;
    assert.ok(message.startsWith(`Could not start ${path.basename(broken)}: `), message);
    assert.match(message, /the agent refused to start here/);
    assert.notEqual((await back).workspace.root, broken);
  });

  await t.test("a close whose open set cannot be saved is refused, and the project stays open", async () => {
    // Removing the config makes the write fail on every platform. Last: nothing after it can persist.
    await unlink(server.configFile);
    const refused = workspaceError();
    client.send({ type: "close_project", root: gamma });
    assert.ok((await refused).message.startsWith(`cannot read ${server.configFile}`), "the file it could not save through is named");
    const other = connect(server.wsUrl());
    t.after(() => other.close());
    const hello = await other.waitFor((m) => m.type === "hello");
    assert.ok(hello.workspaces.some((w) => w.root === gamma), "still open");
  });
});
