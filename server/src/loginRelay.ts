/**
 * A provider sign-in, run by the server and driven from one browser.
 *
 * The SDK's flows talk through two callbacks: `notify` (an authorization URL, a device code, an
 * info line, progress) and `prompt` (a text, a secret, a choice, a code to paste). Here they become
 * messages to the socket that started the flow, and that socket's answers resolve the prompts.
 * Nothing a flow produces — the token it stores — ever goes to a client: only what the person has to
 * see or answer.
 *
 * One flow per socket. Cancelling, or the socket going away, aborts it: a flow left waiting on a
 * prompt nobody can answer would hold the provider's credential lock.
 */
import { randomUUID } from "node:crypto";
import type { LoginEvent, LoginPrompt, ServerMessage } from "@pi-outpost/shared";
import type { LoginInteraction } from "./agentRuntime.ts";

type Send = (message: ServerMessage) => void;

interface Flow {
  flowId: string;
  controller: AbortController;
  prompts: Map<string, { resolve(value: string): void; reject(error: Error): void }>;
  finished: Promise<void>;
  finish(): void;
}

/** Raised when the person stops the flow; the SDK reports it as "Login cancelled". */
export class LoginCancelledError extends Error {
  constructor() {
    super("Login cancelled");
  }
}

export class LoginRelay<Client extends object> {
  private flows = new WeakMap<Client, Flow>();

  /** Whether `client` has a flow running. */
  running(client: Client): boolean {
    return this.flows.has(client);
  }

  /**
   * Run `flow` for `client`, relaying its steps through `send`. Resolves when it ended, however it
   * ended; the outcome is sent as `login_done`, never thrown.
   */
  async run(client: Client, flowId: string, send: Send, flow: (interaction: LoginInteraction) => Promise<void>): Promise<{ ok: boolean; cancelled?: boolean; message?: string }> {
    // A new provider can replace the one the browser currently has open. Abort
    // it and wait until its SDK flow releases the credential lock before starting
    // the new one. Recheck after the wait in case two replacements raced.
    while (this.flows.has(client)) {
      const active = this.flows.get(client)!;
      this.cancel(client, active.flowId);
      await active.finished;
    }
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    const controller = new AbortController();
    const state: Flow = { flowId, controller, prompts: new Map(), finished, finish };
    this.flows.set(client, state);
    const interaction: LoginInteraction = {
      signal: controller.signal,
      notify: (event: LoginEvent) => send({ type: "login_event", flowId, event: copyEvent(event) }),
      prompt: (prompt) =>
        new Promise<string>((resolve, reject) => {
          if (controller.signal.aborted) return reject(new LoginCancelledError());
          const promptId = randomUUID();
          const settle = () => {
            state.prompts.delete(promptId);
            prompt.signal?.removeEventListener("abort", withdrawn);
          };
          // The flow no longer needs this answer: the redirect it raced arrived on its own.
          const withdrawn = () => {
            settle();
            send({ type: "login_prompt_cancelled", flowId, promptId });
            reject(prompt.signal?.reason instanceof Error ? prompt.signal.reason : new LoginCancelledError());
          };
          state.prompts.set(promptId, {
            resolve: (value) => {
              settle();
              resolve(value);
            },
            reject: (error) => {
              settle();
              reject(error);
            },
          });
          prompt.signal?.addEventListener("abort", withdrawn, { once: true });
          send({ type: "login_prompt", flowId, promptId, prompt: copyPrompt(prompt) });
        }),
    };
    let outcome: { ok: boolean; cancelled?: boolean; message?: string };
    try {
      await flow(interaction);
      outcome = { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outcome = controller.signal.aborted || message === "Login cancelled" ? { ok: false, cancelled: true } : { ok: false, message };
    } finally {
      for (const pending of state.prompts.values()) pending.reject(new LoginCancelledError());
      this.flows.delete(client);
    }
    try {
      send({ type: "login_done", flowId, ...outcome });
    } finally {
      state.finish();
    }
    return outcome;
  }

  /** The person's answer to a prompt of their flow. Ignored for any other flow or prompt. */
  answer(client: Client, flowId: string, promptId: string, value: string): void {
    const flow = this.flows.get(client);
    if (!flow || flow.flowId !== flowId) return;
    flow.prompts.get(promptId)?.resolve(value);
  }

  /** Stop `client`'s flow: every pending prompt rejects, the SDK's flow sees its signal abort. */
  cancel(client: Client, flowId?: string): void {
    const flow = this.flows.get(client);
    if (!flow || (flowId !== undefined && flow.flowId !== flowId)) return;
    flow.controller.abort(new LoginCancelledError());
    for (const pending of flow.prompts.values()) pending.reject(new LoginCancelledError());
  }
}

/** Only the fields the protocol carries: a flow's event may hold more, and none of it is the client's. */
function copyEvent(event: LoginEvent): LoginEvent {
  switch (event.type) {
    case "info":
      return { type: "info", message: event.message, ...(event.links ? { links: event.links.map((l) => ({ url: l.url, ...(l.label ? { label: l.label } : {}) })) } : {}) };
    case "auth_url":
      return { type: "auth_url", url: event.url, ...(event.instructions ? { instructions: event.instructions } : {}) };
    case "device_code":
      return {
        type: "device_code",
        userCode: event.userCode,
        verificationUri: event.verificationUri,
        ...(event.intervalSeconds !== undefined ? { intervalSeconds: event.intervalSeconds } : {}),
        ...(event.expiresInSeconds !== undefined ? { expiresInSeconds: event.expiresInSeconds } : {}),
      };
    case "progress":
      return { type: "progress", message: event.message };
  }
}

function copyPrompt(prompt: LoginPrompt): LoginPrompt {
  switch (prompt.type) {
    case "select":
      return { type: "select", message: prompt.message, options: prompt.options.map((o) => ({ id: o.id, label: o.label, ...(o.description ? { description: o.description } : {}) })) };
    default:
      return { type: prompt.type, message: prompt.message, ...(prompt.placeholder ? { placeholder: prompt.placeholder } : {}) };
  }
}
