/**
 * The approval of grants, per project: the requests waiting for the user, and what the session
 * holds once a request is approved for it.
 *
 * Only a client's `sandbox_grant_response` answers a request — never the model, never an
 * extension (theirs is `extension_ui_response`, a different message). No answer refuses: five
 * minutes without one, the turn aborted, the session replaced, or no client there to ask. The
 * first answer decides, and every client is told so its dialog closes.
 *
 * Session grants live here, in memory, and nowhere else: never in the configuration or the
 * project's settings. Replacing the session ends them (`endSession`), as does a restart.
 */
import { randomUUID } from "node:crypto";
import type { SandboxGrantDecision, SandboxGrantOutcome, SandboxGrantRequest, SandboxGrantState, ServerMessage } from "@pi-outpost/shared";
import { describeGrant, EMPTY_GRANT, isEmptyGrant, mergeGrants, type Grant } from "./sandboxGrants.ts";

/** How long a request waits for an answer. */
export const GRANT_REQUEST_TIMEOUT_MS = 5 * 60_000;

export interface GrantBrokerOptions {
  /** To every client of the project. */
  announce(message: ServerMessage): void;
  /** Whether any client is connected to the project, to ask. */
  hasClients(): boolean;
  /** One line per request. Default: the server's console. */
  log?(line: string): void;
  /** Told when the pending requests change: the project's attention follows them. */
  onPendingChanged?(): void;
  timeoutMs?: number;
}

export interface GrantAsk {
  /** Who is asking: the agent, for a command, or the proxy, for a connection waiting on the answer. */
  kind: SandboxGrantRequest["kind"];
  command: string;
  grant: Grant;
  reason: string;
  overridesReadOnly: boolean;
  signal?: AbortSignal;
}

interface Pending {
  request: SandboxGrantRequest;
  settle(outcome: SandboxGrantOutcome): void;
}

const LOGGED: Record<SandboxGrantOutcome, string> = {
  "approved-once": "approved once",
  "approved-session": "approved for the session",
  refused: "refused",
  expired: "expired",
  aborted: "aborted",
  unattended: "refused, no one to ask",
};

/** The server's line for a grant request: outcome, targets, command, reason. */
export function grantLogLine(outcome: SandboxGrantOutcome | "forbidden", targets: string, command: string, reason: string): string {
  const said = outcome === "forbidden" ? "forbidden" : LOGGED[outcome];
  return `[sandbox] grant ${said}: ${targets} for ${JSON.stringify(command)} — ${reason.replace(/[\r\n]+/g, " ")}`;
}

export class SandboxGrantBroker {
  private readonly pending = new Map<string, Pending>();
  private active: Grant = EMPTY_GRANT;

  constructor(private readonly options: GrantBrokerOptions) {}

  /** What every command of this session may reach beyond the sandbox. */
  sessionGrants(): Grant {
    return this.active;
  }

  state(): SandboxGrantState {
    return { pending: [...this.pending.values()].map((entry) => entry.request), active: this.active };
  }

  get hasPending(): boolean {
    return this.pending.size > 0;
  }

  log(line: string): void {
    (this.options.log ?? ((text: string) => console.log(text)))(line);
  }

  /** Asks the user, and resolves with what happened. Never throws. */
  ask(input: GrantAsk): Promise<SandboxGrantOutcome> {
    const targets = describeGrant(input.grant);
    const record = (outcome: SandboxGrantOutcome) => this.log(grantLogLine(outcome, targets, input.command, input.reason));
    if (input.signal?.aborted) {
      record("aborted");
      return Promise.resolve("aborted");
    }
    if (!this.options.hasClients()) {
      record("unattended");
      return Promise.resolve("unattended");
    }
    const timeoutMs = this.options.timeoutMs ?? GRANT_REQUEST_TIMEOUT_MS;
    const request: SandboxGrantRequest = {
      id: randomUUID(),
      kind: input.kind,
      command: input.command,
      grant: input.grant,
      reason: input.reason,
      overridesReadOnly: input.overridesReadOnly,
      expiresAt: Date.now() + timeoutMs,
    };
    return new Promise((resolve) => {
      const timer = setTimeout(() => settle("expired"), timeoutMs);
      const onAbort = () => settle("aborted");
      const settle = (outcome: SandboxGrantOutcome) => {
        if (!this.pending.delete(request.id)) return;
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", onAbort);
        if (outcome === "approved-session") this.addSessionGrant(input.grant);
        record(outcome);
        this.options.announce({ type: "sandbox_grant_resolved", id: request.id, outcome });
        this.options.onPendingChanged?.();
        resolve(outcome);
      };
      input.signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(request.id, { request, settle });
      this.options.announce({ type: "sandbox_grant_request", request });
      this.options.onPendingChanged?.();
    });
  }

  /** A client's answer. The first one for a request decides; any later one, or an unknown id, is ignored. */
  answer(id: string, decision: SandboxGrantDecision): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    entry.settle(decision === "once" ? "approved-once" : decision === "session" ? "approved-session" : "refused");
    return true;
  }

  /** The session is replaced, or its sandbox changed: pending requests are aborted, its grants end. */
  endSession(): void {
    // Each settle removes its own entry, which a Map's iteration allows.
    for (const entry of this.pending.values()) entry.settle("aborted");
    if (!isEmptyGrant(this.active)) {
      this.active = EMPTY_GRANT;
      this.options.announce({ type: "sandbox_grants", active: this.active });
    }
  }

  private addSessionGrant(grant: Grant): void {
    this.active = mergeGrants(this.active, grant);
    this.options.announce({ type: "sandbox_grants", active: this.active });
  }
}
