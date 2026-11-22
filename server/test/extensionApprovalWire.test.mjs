/**
 * A real server: the project's extensions wait for the user's say, and only the interface gives it
 * (`project-extension-approval`). Each extension leaves a marker outside the project when it runs.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const slash = (p) => p.split(path.sep).join("/");

let root;
let markers;
let server;
let client;

before(async () => {
  markers = await mkdtemp(path.join(tmpdir(), "ext-approval-markers-"));
  const extension = (name) => `import { writeFileSync } from "node:fs"; writeFileSync("${slash(path.join(markers, name))}", "ran"); export default function () {}`;
  root = await makeWorkspace({ "README.md": "# project\n" });
  await mkdir(path.join(root, ".pi", "extensions"), { recursive: true });
  await writeFile(path.join(root, ".pi", "extensions", "x.ts"), extension("x"));
  await writeFile(path.join(root, ".pi", "extensions", "y.ts"), extension("y"));
  server = await startServer(root);
  client = connect(server.wsUrl());
});

after(async () => {
  client?.close?.();
  await server?.stop();
  await rm(markers, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const ran = (name) => existsSync(path.join(markers, name));
/** What follows, and nothing before it: the client keeps every message it received. */
const fresh = () => {
  client.received.length = 0;
};
const labels = (questions) => (questions ?? []).map((question) => question.label).sort();

// openlore: scenario=AnExtensionTheAgentWroteDoesNotRunUntilAllowed spec=project-extension-approval
// openlore: scenario=AllowingLoadsIt spec=project-extension-approval
// openlore: scenario=RefusingIsRemembered spec=project-extension-approval
test("the project's extensions wait for an answer; refused stays out and is not asked again; allowed loads now", { timeout: 180_000 }, async () => {
  const hello = await client.waitFor("hello", 60_000);
  assert.deepEqual(labels(hello.extensionQuestions), [".pi/extensions/x.ts", ".pi/extensions/y.ts"], "both asked about on connect");
  assert.equal(ran("x") || ran("y"), false, "neither ran while waiting");
  const byLabel = Object.fromEntries(hello.extensionQuestions.map((question) => [question.label, question]));

  fresh();
  client.send({ type: "extension_question_response", id: byLabel[".pi/extensions/y.ts"].id, decision: "refuse" });
  const afterRefuse = await client.waitFor((message) => message.type === "extension_questions" && message.questions.length === 1, 30_000);
  assert.deepEqual(labels(afterRefuse.questions), [".pi/extensions/x.ts"]);
  const refused = await client.waitFor((message) => message.type === "extension_decisions" && message.decisions.some((decision) => decision.decision === "refuse"), 30_000);
  assert.deepEqual(refused.decisions.map((decision) => [decision.label, decision.decision]), [[".pi/extensions/y.ts", "refuse"]]);

  fresh();
  client.send({ type: "extension_question_response", id: byLabel[".pi/extensions/x.ts"].id, decision: "allow" });
  const allowed = await client.waitFor("extension_allowed", 120_000);
  assert.deepEqual(allowed, { type: "extension_allowed", label: ".pi/extensions/x.ts", loaded: true });
  assert.equal(ran("x"), true, "the allowed extension ran once the session was rebuilt");
  assert.equal(ran("y"), false, "the refused one did not");

  // A new conversation: x loads without asking, y is not asked about again.
  fresh();
  client.send({ type: "new_session" });
  const replaced = await client.waitFor("session_replaced", 120_000);
  assert.deepEqual(labels(replaced.extensionQuestions), [], "nothing asked again");
  assert.equal(ran("y"), false);
});

test("a decision withdrawn from Settings is asked about again at the next session", { timeout: 180_000 }, async () => {
  fresh();
  client.send({ type: "extension_decisions_get" });
  const listed = await client.waitFor("extension_decisions", 30_000);
  const y = listed.decisions.find((decision) => decision.label === ".pi/extensions/y.ts");
  assert.ok(y, "the refusal is listed");
  fresh();
  client.send({ type: "extension_decision_withdraw", kind: y.kind, key: y.key });
  await client.waitFor((message) => message.type === "extension_decisions" && !message.decisions.some((decision) => decision.label === ".pi/extensions/y.ts"), 30_000);
  fresh();
  client.send({ type: "restart_session" });
  const asked = await client.waitFor((message) => message.type === "extension_questions" && message.questions.some((question) => question.label === ".pi/extensions/y.ts"), 120_000);
  assert.deepEqual(labels(asked.questions), [".pi/extensions/y.ts"]);
  assert.equal(ran("y"), false);
});

test("an answer to an unknown or already answered question changes nothing", { timeout: 60_000 }, async () => {
  fresh();
  client.send({ type: "extension_question_response", id: "no-such-question", decision: "allow" });
  client.send({ type: "extension_decisions_get" });
  const listed = await client.waitFor("extension_decisions", 30_000);
  assert.deepEqual(listed.decisions.map((decision) => [decision.label, decision.decision]), [[".pi/extensions/x.ts", "allow"]]);
  assert.equal(ran("y"), false);
});
