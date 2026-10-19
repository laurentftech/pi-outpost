/** The sign-in relay's edges: a prompt the flow withdraws, one flow per client, answers meant for another flow. */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ServerMessage } from "@pi-outpost/shared";
import { LoginRelay } from "../src/loginRelay.ts";

function client() {
  const sent: ServerMessage[] = [];
  return { key: {}, sent, send: (message: ServerMessage) => sent.push(message) };
}

const until = async (predicate: () => boolean) => {
  for (let i = 0; i < 100 && !predicate(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
};

describe("LoginRelay", () => {
  test("a prompt the flow withdraws (its redirect arrived) is retracted from the browser", async () => {
    const relay = new LoginRelay<object>();
    const c = client();
    const redirect = new AbortController();
    const run = relay.run(c.key, "f", c.send, async (interaction) => {
      const pasted = interaction.prompt({ type: "manual_code", message: "Paste", signal: redirect.signal }).catch(() => "from-redirect");
      setTimeout(() => redirect.abort(), 10);
      assert.equal(await pasted, "from-redirect");
    });
    const outcome = await run;
    assert.equal(outcome.ok, true);
    const prompt = c.sent.find((m) => m.type === "login_prompt");
    assert.ok(prompt && prompt.type === "login_prompt");
    assert.deepEqual(c.sent.find((m) => m.type === "login_prompt_cancelled"), { type: "login_prompt_cancelled", flowId: "f", promptId: prompt.promptId });
    assert.ok(!("signal" in prompt.prompt), "the prompt's signal does not travel");
  });

  test("starting another provider cancels the current flow and waits for it to release the socket", async () => {
    const relay = new LoginRelay<object>();
    const c = client();
    const first = relay.run(c.key, "f1", c.send, async (interaction) => {
      await interaction.prompt({ type: "secret", message: "First provider key" });
    });
    await until(() => c.sent.some((message) => message.type === "login_prompt"));

    const second = relay.run(c.key, "f2", c.send, async (interaction) => {
      interaction.notify({ type: "progress", message: "Second provider started" });
    });

    assert.deepEqual(await first, { ok: false, cancelled: true });
    assert.deepEqual(await second, { ok: true });
    const firstDone = c.sent.findIndex((message) => message.type === "login_done" && message.flowId === "f1");
    const secondStarted = c.sent.findIndex((message) => message.type === "login_event" && message.flowId === "f2");
    assert.ok(firstDone >= 0 && secondStarted > firstDone, "the old flow finishes before the new one starts");
    assert.equal(relay.running(c.key), false);
  });

  test("one flow per client; an answer for another flow or prompt is ignored", async () => {
    const relay = new LoginRelay<object>();
    const c = client();
    let answered = "";
    const first = relay.run(c.key, "f1", c.send, async (interaction) => {
      answered = await interaction.prompt({ type: "secret", message: "Key" });
    });
    await until(() => c.sent.some((m) => m.type === "login_prompt"));
    const prompt = c.sent.find((m) => m.type === "login_prompt");
    assert.ok(prompt && prompt.type === "login_prompt");
    relay.answer(c.key, "f2", prompt.promptId, "not-for-this-flow");
    relay.answer(c.key, "f1", "other-prompt", "not-for-this-prompt");
    relay.answer({}, "f1", prompt.promptId, "another-client");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(answered, "", "an answer reached the wrong flow");
    relay.answer(c.key, "f1", prompt.promptId, "the-key");
    assert.deepEqual(await first, { ok: true });
    assert.equal(answered, "the-key");
    assert.equal(relay.running(c.key), false);
  });

  test("cancel rejects the pending prompt and aborts the flow's signal", async () => {
    const relay = new LoginRelay<object>();
    const c = client();
    let aborted = false;
    const run = relay.run(c.key, "f", c.send, async (interaction) => {
      interaction.signal.addEventListener("abort", () => (aborted = true));
      await interaction.prompt({ type: "text", message: "Name" });
    });
    await until(() => c.sent.some((m) => m.type === "login_prompt"));
    relay.cancel(c.key);
    assert.deepEqual(await run, { ok: false, cancelled: true });
    assert.equal(aborted, true);
    assert.deepEqual(c.sent.at(-1), { type: "login_done", flowId: "f", ok: false, cancelled: true });
  });
});
