/**
 * What the server does with a client message it cannot use, over a real WebSocket.
 *
 * Every message type is checked field by field before it reaches a handler: a wrong type,
 * a missing request id, an out-of-range value. Such a message is dropped — no reply, no
 * half-run handler, no crash — and the connection keeps working. The first test sends one
 * malformed variant per guard, then a valid request, and requires that request's answer to
 * be the next thing that matters: nothing refused, nothing broken in between.
 *
 * The second test drives the file and session requests no other wire suite sends, and
 * checks each answer under its own request id.
 */
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const HUGE = "x".repeat(200_000);

/** One malformed variant per field guard in handleClientMessage. */
const MALFORMED = [
  { type: "switch_workspace", root: 1 },
  { type: "switch_workspace", root: "/x", id: 2 },
  { type: "open_project", root: 1 },
  { type: "close_project", root: 1 },
  { type: "close_project", root: "/x", id: 2 },
  { type: "open_side_session", root: 1 },
  { type: "update_pi_package", source: 1, requestId: "r" },
  { type: "lookup_pi_package", name: 1, requestId: "r" },
  { type: "lookup_pi_package", name: "a", requestId: "r", scope: "nowhere" },
  { type: "lookup_pi_package", name: "a", requestId: "r", scope: "user", version: 3 },
  { type: "install_pi_package", confirmed: 1 },
  { type: "remove_pi_package", source: 1, requestId: "r" },
  { type: "remove_pi_package", source: "a", requestId: "r", scope: "nowhere" },
  { type: "restore_pi_package", name: 1, requestId: "r" },
  { type: "restore_pi_package", name: "a", requestId: "r", scope: "nowhere" },
  { type: "prompt", text: 1 },
  { type: "prompt", text: "" },
  { type: "edit_queued_prompt", id: 1, text: "x" },
  { type: "remove_queued_prompt", id: 1 },
  { type: "set_model", provider: 1, id: "m" },
  { type: "set_thinking", level: "unheard-of" },
  { type: "switch_session", path: 1 },
  { type: "delete_session", path: 1 },
  { type: "rename_session", path: 1, name: "n" },
  { type: "rename_session", path: "/s.jsonl", name: HUGE },
  { type: "search_sessions", query: 1, requestId: "r" },
  { type: "search_sessions", query: HUGE, requestId: "r" },
  { type: "history_before", sessionId: 1, requestId: "r" },
  { type: "history_before", sessionId: "s", requestId: "r", have: "1", count: 1 },
  { type: "sandbox_grant_response", id: 1, decision: "once" },
  { type: "sandbox_grant_response", id: "g", decision: "always" },
  { type: "extension_ui_response", id: 1 },
  { type: "extension_ui_response", id: "unknown-ui-request" },
  { type: "list_directory", path: 1, requestId: "r" },
  { type: "read_file", path: 1, requestId: "r" },
  { type: "save_arrangement", documentPath: 1, content: "", requestId: "r" },
  { type: "create_file", path: 1, requestId: "r" },
  { type: "create_directory", path: 1, requestId: "r" },
  { type: "open_native", path: 1, requestId: "r" },
  { type: "reveal_native", path: 1, requestId: "r" },
  { type: "rename_file", path: 1, name: "n", requestId: "r" },
  { type: "delete_file", path: 1, requestId: "r" },
  { type: "search_files", query: 1, requestId: "r" },
  { type: "search_content", query: 1, requestId: "r" },
  { type: "navigate_tree", entryId: 1 },
  { type: "fork_session", entryId: 1 },
  { type: "edit_prompt", entryId: 1, text: "x" },
  { type: "edit_prompt", entryId: "e", text: "" },
  { type: "git_status", requestId: 1 },
  { type: "git_status", requestId: "r", repo: 1 },
  { type: "get_outcome", requestId: 1 },
  { type: "git_diff", path: 1, requestId: "r" },
  { type: "git_log", requestId: "r" },
  { type: "git_log", requestId: "r", repo: ".", limit: "5" },
  { type: "git_show", sha: 1, requestId: "r" },
  { type: "git_show", sha: "abc", requestId: "r" },
  { type: "git_file_log", path: 1, requestId: "r" },
  { type: "git_file_log", path: "a", requestId: "r", limit: "5" },
  { type: "git_file_diff", requestId: 1 },
  { type: "git_file_diff", requestId: "r", base: "--output=/tmp/x", target: "HEAD" },
  { type: "start_login", flowId: 1, provider: "anthropic", method: "oauth" },
  { type: "start_login", flowId: "f", provider: "anthropic", method: "carrier-pigeon" },
  { type: "login_answer", flowId: 1, promptId: "p", value: "v" },
  { type: "cancel_login", flowId: 1 },
  { type: "logout_provider", provider: "not a provider id" },
  { type: "remove_git_host_credential", host: 1, requestId: "r" },
  { type: "set_credential", provider: "not a provider id", apiKey: "k" },
  { type: "declare_provider", provider: "acme", apiKey: "", models: ["m"] },
  { type: "declare_provider", provider: "acme", apiKey: "k", models: [] },
  { type: "browse_server_directory", path: 1, requestId: "r" },
  { type: "suggest_agent_resource_clone_path", repositoryUrl: 1, requestId: "r" },
  { type: "clone_agent_resource_repository" },
  { type: "enroll_agent_resource_repository" },
  { type: "set_agent_resource_skills", skillRoots: [1] },
  { type: "remove_agent_resource_repository", repositoryId: 1, requestId: "r" },
  { type: "refresh_agent_resource_repositories" },
  { type: "update_agent_resource_repository" },
  { type: "terminal_open", terminalId: 1 },
  { type: "terminal_input", terminalId: 1, data: "x" },
  { type: "terminal_resize", terminalId: "t", cols: "80", rows: 24 },
  { type: "terminal_get_cwd", terminalId: 1 },
  { type: "terminal_close", terminalId: 1 },
];

/** Not even a message: dropped before any type is read. */
const NOT_MESSAGES = ["null", "42", '"text"', "{not json"];

test("MalformedMessagesAreDroppedAndTheConnectionKeepsWorking", async (t) => {
  const root = await makeWorkspace({ "readme.md": "# hi\n" });
  const server = await startServer(root);
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor("hello", 30_000);
  // Let the start-up messages land before counting what the malformed ones produce.
  client.send({ type: "list_directory", path: "", requestId: "probe:before" });
  await client.waitFor((m) => m.requestId === "probe:before");
  const from = client.received.length;

  for (const raw of NOT_MESSAGES) client.ws.send(raw);
  for (const message of MALFORMED) client.send(message);
  client.send({ type: "list_directory", path: "", requestId: "probe:after" });
  const listing = await client.waitFor((m) => m.requestId === "probe:after");
  assert.equal(listing.type, "directory_listing");
  assert.ok(listing.entries.some((e) => e.name === "readme.md"), "the request after them is answered in full");

  const answered = client.received.slice(from).filter((m) => m.requestId !== "probe:after");
  const refusals = answered.filter((m) => /error|refused|result/.test(m.type) || m.requestId !== undefined);
  assert.deepEqual(refusals, [], "a malformed message gets no answer at all");
  assert.equal(client.closed(), null, "the connection stays open");
  assert.equal(existsSync(path.join(root, "1")), false, "no handler ran with a coerced value");
});

test("FileAndSessionRequestsAreAnsweredUnderTheirRequestId", async (t) => {
  const root = await makeWorkspace({ "notes/today.md": "today\n", "notes/archive/old.md": "old\n" });
  const server = await startServer(root);
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor("hello", 30_000);
  const answer = (requestId) => client.waitFor((m) => m.requestId === requestId);

  client.send({ type: "create_file", path: "notes/new.md", requestId: "create:file" });
  const written = await answer("create:file");
  assert.equal(written.type, "file_written");
  assert.equal(written.size, 0);
  assert.equal(statSync(path.join(root, "notes", "new.md")).size, 0);

  client.send({ type: "create_file", path: "notes/new.md", requestId: "create:again" });
  const taken = await answer("create:again");
  assert.equal(taken.type, "file_browser_error");
  assert.equal(taken.reason, "conflict");

  client.send({ type: "create_directory", path: "notes/drafts", requestId: "create:dir" });
  const listed = await answer("create:dir");
  assert.equal(listed.type, "directory_listing");
  assert.equal(listed.path, "notes/drafts");
  assert.deepEqual(listed.entries, []);
  assert.ok(statSync(path.join(root, "notes", "drafts")).isDirectory());

  client.send({ type: "create_directory", path: "../escape", requestId: "create:escape" });
  const escape = await answer("create:escape");
  assert.equal(escape.type, "file_browser_error");
  assert.equal(existsSync(path.join(path.dirname(root), "escape")), false);

  // A missing file is refused before any launcher would be started.
  client.send({ type: "open_native", path: "notes/missing.pdf", requestId: "open:missing" });
  const notOpened = await answer("open:missing");
  assert.equal(notOpened.type, "file_browser_error");
  assert.equal(notOpened.reason, "not-found");

  client.send({ type: "search_files", query: "old", requestId: "search:names" });
  const found = await answer("search:names");
  assert.equal(found.type, "file_search_results");
  assert.deepEqual(found.results.map((r) => r.path), ["notes/archive/old.md"]);

  client.send({ type: "list_tree" });
  const tree = await client.waitFor("tree");
  assert.ok(Array.isArray(tree.roots));

  client.send({ type: "navigate_tree", entryId: "no-such-entry" });
  const unknownNode = await client.waitFor((m) => m.type === "error" && /Unknown tree node/.test(m.message));
  assert.ok(unknownNode);

  client.send({ type: "edit_prompt", entryId: "no-such-entry", text: "again" });
  const unknownMessage = await client.waitFor((m) => m.type === "error" && /Unknown message/.test(m.message));
  assert.ok(unknownMessage);

  client.send({ type: "prompt", text: "look", images: [{ data: "", mimeType: "image/png" }] });
  const rejected = await client.waitFor((m) => m.type === "error" && /Attachments rejected/.test(m.message));
  assert.ok(rejected);

  client.send({ type: "delete_session", path: path.join(root, "not-a-session.jsonl") });
  const unknownSession = await client.waitFor((m) => m.type === "error" && /Unknown session/.test(m.message));
  assert.ok(unknownSession);

  client.send({ type: "switch_workspace", root: path.join(root, "nowhere"), id: "no-such-workspace" });
  const noProject = await client.waitFor((m) => m.type === "workspace_error");
  assert.match(noProject.message, /No open project at no-such-workspace/);

  // A terminal that does not exist: resized and asked for its folder without an answer or a crash.
  client.send({ type: "terminal_resize", terminalId: "no-such-terminal", cols: 80, rows: 24 });
  client.send({ type: "terminal_get_cwd", terminalId: "no-such-terminal" });
  client.send({ type: "list_directory", path: "notes", requestId: "probe:alive" });
  const alive = await answer("probe:alive");
  assert.deepEqual(alive.entries.map((e) => e.name), ["archive", "drafts", "new.md", "today.md"]);
  assert.equal(client.received.some((m) => m.type === "terminal_cwd"), false);
});
