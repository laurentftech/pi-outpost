/**
 * The approval of grants: who answers, when no answer is a refusal, and what each request leaves
 * in the server's log.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ServerMessage } from "@pi-outpost/shared";
import { grantLogLine, SandboxGrantBroker } from "../src/sandboxGrantBroker.ts";

const grant = { hosts: ["example.com"], directories: [{ path: "/work/beside", access: "write" as const }] };

function broker(options: { clients?: boolean; timeoutMs?: number } = {}) {
  const announced: ServerMessage[] = [];
  const logged: string[] = [];
  let pendingChanges = 0;
  const instance = new SandboxGrantBroker({
    announce: (message) => announced.push(message),
    hasClients: () => options.clients ?? true,
    log: (line) => logged.push(line),
    onPendingChanged: () => pendingChanges++,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  const requested = () => announced.filter((m): m is Extract<ServerMessage, { type: "sandbox_grant_request" }> => m.type === "sandbox_grant_request").map((m) => m.request);
  const resolved = () => announced.filter((m) => m.type === "sandbox_grant_resolved");
  return { instance, announced, logged, requested, resolved, pendingChanges: () => pendingChanges };
}

const ask = { kind: "command" as const, command: "curl https://example.com/", grant, reason: "check the page", overridesReadOnly: false };

describe("SandboxGrantBroker", () => {
  test("a request is shown with its exact command, grant and reason, and answered once", async () => {
    const b = broker();
    const outcome = b.instance.ask(ask);
    const [request] = b.requested();
    assert.equal(request.command, ask.command);
    assert.deepEqual(request.grant, grant);
    assert.equal(request.reason, "check the page");
    assert.ok(request.expiresAt > Date.now());
    assert.deepEqual(b.instance.state().pending.map((p) => p.id), [request.id], "pending in the snapshot, for a client that reloads");
    assert.equal(b.instance.answer(request.id, "once"), true);
    assert.equal(await outcome, "approved-once");
    assert.deepEqual(b.instance.sessionGrants(), { hosts: [], directories: [] }, "once is not for the session");
    assert.equal(b.instance.state().pending.length, 0);
  });

  // openlore: scenario=ARefusedRequestRunsNothing spec=sandbox-approved-grants
  test("ARefusedRequestRunsNothing: a refusal resolves as refused, and grants nothing", async () => {
    const b = broker();
    const outcome = b.instance.ask(ask);
    b.instance.answer(b.requested()[0].id, "refuse");
    assert.equal(await outcome, "refused");
    assert.deepEqual(b.instance.sessionGrants(), { hosts: [], directories: [] });
  });

  // openlore: scenario=TheFirstAnswerWins spec=sandbox-approved-grants
  test("TheFirstAnswerWins: the first answer decides, a later one is ignored, every client is told", async () => {
    const b = broker();
    const outcome = b.instance.ask(ask);
    const { id } = b.requested()[0];
    assert.equal(b.instance.answer(id, "once"), true);
    assert.equal(b.instance.answer(id, "refuse"), false, "the second answer changes nothing");
    assert.equal(await outcome, "approved-once");
    assert.deepEqual(b.resolved(), [{ type: "sandbox_grant_resolved", id, outcome: "approved-once" }], "one resolution, to every client");
    assert.equal(b.instance.answer("not-a-request", "once"), false);
  });

  // openlore: scenario=NoAnswerIsARefusal spec=sandbox-approved-grants
  test("NoAnswerIsARefusal: unanswered in time it expires, aborted it is aborted; the dialog closes either way", async () => {
    const late = broker({ timeoutMs: 30 });
    assert.equal(await late.instance.ask(ask), "expired");
    assert.equal(late.resolved().length, 1);
    assert.equal(late.instance.state().pending.length, 0);

    const aborted = broker();
    const controller = new AbortController();
    const outcome = aborted.instance.ask({ ...ask, signal: controller.signal });
    controller.abort();
    assert.equal(await outcome, "aborted");
    assert.deepEqual(aborted.resolved().map((m) => m.type === "sandbox_grant_resolved" && m.outcome), ["aborted"]);
    // Already aborted: never shown at all.
    const before = broker();
    assert.equal(await before.instance.ask({ ...ask, signal: AbortSignal.abort() }), "aborted");
    assert.equal(before.requested().length, 0);
  });

  // openlore: scenario=NobodyToAskIsARefusal spec=sandbox-approved-grants
  test("NobodyToAskIsARefusal: with no client connected, refused at once and never shown", async () => {
    const b = broker({ clients: false });
    assert.equal(await b.instance.ask(ask), "unattended");
    assert.equal(b.requested().length, 0);
    assert.match(b.logged[0], /refused, no one to ask/);
  });

  test("a session grant is kept, merged, announced; ending the session aborts what waits and ends the grants", async () => {
    const b = broker();
    const first = b.instance.ask(ask);
    b.instance.answer(b.requested()[0].id, "session");
    assert.equal(await first, "approved-session");
    assert.deepEqual(b.instance.sessionGrants(), grant);
    assert.ok(b.announced.some((m) => m.type === "sandbox_grants" && m.active.hosts.length === 1 && m.active.hosts[0] === "example.com"));

    const waiting = b.instance.ask({ ...ask, command: "ls" });
    b.instance.endSession();
    assert.equal(await waiting, "aborted");
    assert.deepEqual(b.instance.sessionGrants(), { hosts: [], directories: [] });
    assert.deepEqual(b.announced.at(-1), { type: "sandbox_grants", active: { hosts: [], directories: [] } });
  });

  // openlore: scenario=AGrantLeavesATrace spec=sandbox-approved-grants
  test("AGrantLeavesATrace: one log line per request naming the outcome, each target, the command and the reason", async () => {
    const b = broker({ timeoutMs: 20 });
    const once = b.instance.ask(ask);
    b.instance.answer(b.requested()[0].id, "once");
    await once;
    const session = b.instance.ask(ask);
    b.instance.answer(b.requested()[1].id, "session");
    await session;
    const refused = b.instance.ask(ask);
    b.instance.answer(b.requested()[2].id, "refuse");
    await refused;
    await b.instance.ask(ask);
    assert.deepEqual(b.logged, [
      '[sandbox] grant approved once: host example.com, read-write /work/beside for "curl https://example.com/" — check the page',
      '[sandbox] grant approved for the session: host example.com, read-write /work/beside for "curl https://example.com/" — check the page',
      '[sandbox] grant refused: host example.com, read-write /work/beside for "curl https://example.com/" — check the page',
      '[sandbox] grant expired: host example.com, read-write /work/beside for "curl https://example.com/" — check the page',
    ]);
    assert.equal(grantLogLine("forbidden", "read /srv/agent", "cat x", "need\nit"), '[sandbox] grant forbidden: read /srv/agent for "cat x" — need it', "one line, whatever the reason holds");
  });
});
