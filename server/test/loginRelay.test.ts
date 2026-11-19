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

describe("LoginRelay: what reaches the browser", () => {
  /** Every event a flow notifies, as the browser receives it. */
  const relayed = async (events: unknown[]) => {
    const relay = new LoginRelay<object>();
    const c = client();
    await relay.run(c.key, "f", c.send, async (interaction) => {
      for (const event of events) interaction.notify(event as never);
    });
    return c.sent.filter((m) => m.type === "login_event").map((m) => (m as Extract<ServerMessage, { type: "login_event" }>).event);
  };

  test("each kind of event keeps the fields the protocol carries, with or without its optional ones, and nothing else", async () => {
    const events = await relayed([
      { type: "info", message: "Sign in", links: [{ url: "https://a.example", label: "Docs", token: "x" }, { url: "https://b.example" }], extra: 1 },
      { type: "info", message: "No links" },
      { type: "auth_url", url: "https://login.example", instructions: "Open it", accessToken: "secret" },
      { type: "auth_url", url: "https://login.example" },
      { type: "device_code", userCode: "AB-CD", verificationUri: "https://device.example", intervalSeconds: 5, expiresInSeconds: 600, deviceCode: "secret" },
      { type: "device_code", userCode: "AB-CD", verificationUri: "https://device.example" },
      { type: "progress", message: "Waiting", percent: 50 },
    ]);
    assert.deepEqual(events, [
      { type: "info", message: "Sign in", links: [{ url: "https://a.example", label: "Docs" }, { url: "https://b.example" }] },
      { type: "info", message: "No links" },
      { type: "auth_url", url: "https://login.example", instructions: "Open it" },
      { type: "auth_url", url: "https://login.example" },
      { type: "device_code", userCode: "AB-CD", verificationUri: "https://device.example", intervalSeconds: 5, expiresInSeconds: 600 },
      { type: "device_code", userCode: "AB-CD", verificationUri: "https://device.example" },
      { type: "progress", message: "Waiting" },
    ]);
  });

  test("a prompt keeps its question, its choices and its placeholder, and nothing else", async () => {
    const relay = new LoginRelay<object>();
    const c = client();
    const run = relay.run(c.key, "f", c.send, async (interaction) => {
      const asked = [
        interaction.prompt({ type: "select", message: "Account", options: [{ id: "a", label: "Work", description: "Company" }, { id: "b", label: "Home" }] }),
        interaction.prompt({ type: "text", message: "Name", placeholder: "you@example.com" }),
        interaction.prompt({ type: "manual_code", message: "Paste the code" }),
      ];
      await Promise.allSettled(asked);
    });
    await until(() => c.sent.filter((m) => m.type === "login_prompt").length === 3);
    const prompts = c.sent.filter((m) => m.type === "login_prompt").map((m) => (m as Extract<ServerMessage, { type: "login_prompt" }>).prompt);
    assert.deepEqual(prompts, [
      { type: "select", message: "Account", options: [{ id: "a", label: "Work", description: "Company" }, { id: "b", label: "Home" }] },
      { type: "text", message: "Name", placeholder: "you@example.com" },
      { type: "manual_code", message: "Paste the code" },
    ]);
    relay.cancel(c.key);
    assert.deepEqual(await run, { ok: true }, "the flow settled its own prompts and ended");
  });
});

describe("LoginRelay: how a flow ends", () => {
  test("a flow that fails reports its message; one that throws something else reports it as text", async () => {
    const relay = new LoginRelay<object>();
    const c = client();
    assert.deepEqual(
      await relay.run(c.key, "f1", c.send, async () => {
        throw new Error("The provider refused the code");
      }),
      { ok: false, message: "The provider refused the code" },
    );
    assert.deepEqual(
      await relay.run(c.key, "f2", c.send, async () => {
        throw "network down";
      }),
      { ok: false, message: "network down" },
    );
    assert.deepEqual(c.sent.at(-1), { type: "login_done", flowId: "f2", ok: false, message: "network down" });
  });

  test("the SDK's own cancellation message counts as cancelled, even without the signal", async () => {
    const relay = new LoginRelay<object>();
    const c = client();
    assert.deepEqual(
      await relay.run(c.key, "f", c.send, async () => {
        throw new Error("Login cancelled");
      }),
      { ok: false, cancelled: true },
    );
  });

  test("a prompt asked after the flow was cancelled is refused at once, and never shown", async () => {
    const relay = new LoginRelay<object>();
    const c = client();
    let refused: unknown;
    const run = relay.run(c.key, "f", c.send, async (interaction) => {
      await new Promise<void>((resolve) => interaction.signal.addEventListener("abort", () => resolve(), { once: true }));
      refused = await interaction.prompt({ type: "text", message: "Too late" }).catch((error) => error);
      // As the SDK's flows do: the refusal ends the flow.
      throw refused;
    });
    await until(() => relay.running(c.key));
    relay.cancel(c.key);
    assert.deepEqual(await run, { ok: false, cancelled: true });
    assert.ok(refused instanceof Error && refused.message === "Login cancelled");
    assert.equal(c.sent.some((m) => m.type === "login_prompt"), false);
  });

  test("a prompt withdrawn with a reason rejects with that reason", async () => {
    const relay = new LoginRelay<object>();
    const c = client();
    const withdrawn = new AbortController();
    let caught: unknown;
    await relay.run(c.key, "f", c.send, async (interaction) => {
      const asked = interaction.prompt({ type: "manual_code", message: "Paste", signal: withdrawn.signal });
      withdrawn.abort(new Error("redirect received"));
      caught = await asked.catch((error) => error);
    });
    assert.ok(caught instanceof Error && caught.message === "redirect received");
  });

  test("a prompt still pending when the flow returns is rejected, not left waiting", async () => {
    const relay = new LoginRelay<object>();
    const c = client();
    let pending!: Promise<unknown>;
    assert.deepEqual(
      await relay.run(c.key, "f", c.send, async (interaction) => {
        pending = interaction.prompt({ type: "secret", message: "Key" }).catch((error) => error);
      }),
      { ok: true },
    );
    const settled = await pending;
    assert.ok(settled instanceof Error && settled.message === "Login cancelled");
  });

  test("cancelling another flow, or a client with none, stops nothing", async () => {
    const relay = new LoginRelay<object>();
    const c = client();
    relay.cancel({});
    const run = relay.run(c.key, "f1", c.send, async (interaction) => {
      return interaction.prompt({ type: "text", message: "Name" }).then(() => undefined);
    });
    await until(() => c.sent.some((m) => m.type === "login_prompt"));
    relay.cancel(c.key, "f2");
    assert.equal(relay.running(c.key), true, "a cancel naming another flow left this one running");
    const prompt = c.sent.find((m) => m.type === "login_prompt") as Extract<ServerMessage, { type: "login_prompt" }>;
    relay.answer(c.key, "f1", prompt.promptId, "me");
    assert.deepEqual(await run, { ok: true });
  });
});
