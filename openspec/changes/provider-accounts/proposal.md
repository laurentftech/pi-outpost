# Provider accounts: sign in, re-key and sign out from the web UI

## Why

pi-outpost knows API keys only. Its setup screen stores a key or declares an OpenAI-compatible
endpoint, `pi-outpost login --provider` stores a key, and nothing — in the interface or the CLI — can
see which providers are configured, sign in with an account, or remove a credential. pi's terminal UI has
`/login` (OAuth sign-in to a subscription: Claude Pro/Max, ChatGPT/Codex, GitHub Copilot, OpenRouter,
xAI, …) and `/logout`; a pi-outpost user meets `/login` only in an error message telling them to run a
command that does not exist here (the onboarding component says so). Checking a deployment on another
machine today meant copying an API key over; signing in there would have been the clean way.

The pi SDK already carries every flow: `modelRuntime.login(provider, method, { prompt, notify, signal })`,
`logout(provider)`, `listCredentials()`, `getProviderAuthStatus(provider)`. A flow talks through two
callbacks only — `notify` (an info line, an authorization URL, a device code, progress) and `prompt` (a
text, a secret, a choice, an authorization code to paste) — which carry over a WebSocket as they are.

## What Changes

- **Accounts in Settings**: the providers the server knows, each with its state — signed in (account),
  API key (stored, environment, or configuration), not configured — and the ways it can be set up.
- **Sign in** with any provider that offers an account flow: the server runs the SDK's flow and relays it
  to the browser that asked — the URL to open, the device code to enter, a question to answer, a code to
  paste. Cancellable. A flow that waits for a redirect to the *server's* loopback works from a browser on
  another machine by pasting the redirect URL or code, which the flows already accept.
- **API key** for any provider that takes one, from the same screen (today's onboarding path, reused).
- **Sign out / remove**: removes a credential this server stored (`auth.json`); a key from the server's
  environment or `models.json` is shown as such and not removable from the UI, with where it comes from.
- **Onboarding** offers "Sign in with an account" beside "Provider API key".
- **`pi-outpost login`** gains account sign-in on a terminal (`--provider <id>` picks it; the flow
  prints the URL or device code and reads pasted codes), and `pi-outpost logout --provider <id>`.
- **A lock**: `credentialsLock: true` in the configuration hides account management from the interface
  (a deployment whose browser users must not change the server's credentials); the CLI still works.
- Embedded runtime only; under the RPC runtime the screen says sign-in is not available there.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `credentials`: account sign-in and sign-out from the web UI and the CLI, provider states, the lock.

## Impact

`server/src/credentials.ts` and a login-flow relay (server), `server/src/embeddedRuntime.ts` (reaching
`modelRuntime`), `server/src/index.ts` (messages, the lock, refreshing models after sign-in),
`server/src/cli.ts` (`login` account flow, `logout`), `shared/src/protocol.ts` (messages, provider
states), `ui/src/components/` (an Accounts section in Settings, Onboarding), tests, `README.md`
(*Model credentials*, CLI), the config reference.
