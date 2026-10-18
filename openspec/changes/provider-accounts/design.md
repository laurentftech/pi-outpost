# Design

## Context

Credentials today: `credentials.ts` (`storeApiKey` writes `auth.json` and calls the live
`modelRuntime.setRuntimeApiKey`; `storeProvider` writes `models.json`), `set_credential` and
`declare_provider` messages, a `CredentialStatus` snapshot (`providers: {id, name, configured}`,
`usableModel`), the `Onboarding` screen shown while no model is usable, and `pi-outpost login --provider`
(key only, read from a prompt or stdin). The embedded runtime holds the SDK services
(`runtime.services.modelRuntime`), the same object pi's TUI drives `/login` and `/logout` through:

- `getProviders()`, each with `auth.apiKey` and/or `auth.oauth` (`isSubscription`, display name);
- `getProviderAuthStatus(id)` (`configured`, `source`, `label`), `isUsingOAuth(id)`;
- `login(id, "oauth" | "api_key", { signal, prompt, notify }, { getDeviceId })`;
- `logout(id, { signal })`, `listCredentials({ signal })`.

`prompt(p)` resolves with the answer: `p` is `text`, `secret`, `select` (options), or `manual_code`, and
may carry its own `signal` (a code prompt raced against a loopback callback is aborted when the callback
wins). `notify(e)` is `info` (links), `auth_url` (URL, instructions), `device_code` (code, URI, expiry) or
`progress`.

## Goals / Non-Goals

**Goals:** account sign-in and sign-out, provider states and sources, from the interface and the CLI;
a lock; no secret in any message to a client.

**Non-Goals:** per-browser-user credentials (the server has one agent identity); the RPC runtime
(sign-in is refused there with the reason); editing `models.json` endpoints beyond today's declare.

## Decisions

**The server runs the flow; one browser drives it.** `start_login { flowId, provider, method }` starts
`modelRuntime.login` with callbacks bound to that socket: `notify` → `login_event { flowId, event }`;
`prompt` → `login_prompt { flowId, promptId, prompt }` (the prompt's `signal` sent along as a later
`login_prompt_cancelled`); the browser answers `login_answer { flowId, promptId, value }` or
`cancel_login { flowId }`. The flow ends with `login_done { flowId, ok, message }`. One flow per socket at
a time; the socket closing aborts it. Alternative: open the provider's page from the server — impossible,
the server has no browser and may be remote.

**Secrets travel one way.** A `secret` prompt's answer goes browser → server once; nothing a flow
produces (tokens) is ever sent to a client. Provider states carry type and source only.

**Loopback redirects from another machine.** Flows that run a callback server on the server's loopback
also offer `manual_code`; the browser shows the authorization URL and, beside it, a field for the
redirect URL or code. Nothing else to build.

**Provider states.** `CredentialStatus.providers` gains `auth: "oauth" | "api_key" | undefined`,
`source` (`stored` | `environment` | `configuration` | other label), `methods` (`oauth`, `api_key`),
`subscription`. `removable` = stored in the agent directory (`listCredentials`).

**After sign-in or sign-out** the server refreshes what it already refreshes after a key is stored
(available models, the snapshot's credentials) and broadcasts.

**Interface.** Settings gets an *Accounts* section: one row per provider (name, state, source,
"Sign in" / "API key" / "Sign out"), a dialog for a running flow (URL as a link plus copy, device code
large with its address, prompts as fields, a choice as buttons, Cancel). Onboarding offers "Sign in with
an account" with a provider picker of those with account flows.

**CLI.** `login --provider <id>`: with a key piped in, today's path; otherwise, when the provider has an
account flow, run it on the terminal (print URL / device code, read answers; secrets not echoed); else ask
for a key as today. `logout --provider <id>` removes the stored credential.

**Lock.** `credentialsLock` (boolean, default false): the snapshot says so; the server refuses
`set_credential`, `declare_provider`, `start_login` and `logout_provider`; the UI shows states only.

## Risks / Trade-offs

- [Anyone who reaches the UI can change the server's credentials — as today with keys] → the lock, and
  the existing token auth; documented.
- [A flow left waiting on a prompt] → aborted when the socket closes, on cancel, and by the flow's own
  timeouts.
- [The SDK's login API moves] → used through one adapter (`accountRuntime`), covered by tests with a fake
  runtime and one real flow driven in the running app.
- [Testing real sign-in needs a real account] → the running-app check uses one provider the developer has
  (OpenRouter or GitHub Copilot device flow); flows are otherwise tested with a fake provider.
