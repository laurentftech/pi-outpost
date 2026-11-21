# Design

## Context

Measured on Windows 11 24H2 (10.0.26100.9711) with mxc-sdk 1.1.0's `wxc-exec.exe`, Python 3.15, a probe
calling `socket.socketpair()` then connecting to a host listener on `127.0.0.1`:

| MXC `network` | socketpair | host listener |
|---|---|---|
| `egress: allow` (today's request, `mxcTerminalConfig`) | hangs in `accept` | — |
| `+ ingress: allow` | hangs | — |
| `+ egress.allow` rule `127.0.0.1/32` (deny or allow default) | hangs | — |
| `egress: deny`, `ingress: allow`, `hostLoopback: allow`, proxy (`allowedHosts`) | hangs | refused, proxy port only |
| any `egress` with `hostLoopback: allow`, no proxy | works | reached |

MXC refuses any `egress.allow` rule beside `runtimeConfig.networkProxy`. Codex's MXC backend
(`codex-rs/mxc-sandbox`) makes the same choice this design makes: `hostLoopback: allow` whenever the
network is enabled, documented as "permits local servers and direct host-loopback connections".

The server today: `tokenValid()` accepts everything when no token is configured; the WebSocket accepts a
client with no `Origin` header ("a local process already has shell access", `server/src/index.ts`) and
counts it as the server's own interface (may restart). Over `/ws`, `update_config` can change
`sandbox.root`, `allowWrite` and `userExtensionPaths` — only the runner keys are refused — and
`restart_session` loads extensions in the unconfined pi process. Every confined environment is built
from an allowlist (`confinedEnvironment`), and every runner denies the agent directory.

## Goals / Non-Goals

**Goals:**
- No configuration in which a confined process can reach an unauthenticated server.
- asyncio works under MXC on Windows without the operator doing anything.

**Non-Goals:**
- Fixing asyncio under `sandbox.allowedHosts` on Windows: no MXC policy allows it today
  (microsoft/mxc#1261, #1731).
- Per-message authorization on the WebSocket (the `multi-user-local-accounts` change owns roles).
- Closing other host services to a command while the loopback is open: MXC cannot select ports.

## Decisions

**A token always, generated when absent — not "token only when the loopback is open".** A conditional
token would tie the server's security to the sandbox configuration of whichever project opens the
loopback, and every future runner that opens it would have to remember the coupling. Always requiring it
also retires the `Origin`-less trust, which was only ever sound for unconfined local processes.
Alternative rejected: a per-launch token (Jupyter) — the installed web app and open tabs would meet the
token screen after every restart.

**Stored in the agent directory, as `outpost-token`, mode 0600, created atomically.** Every runner
already denies that directory by name, so no new deny rule is needed; it is per user, survives upgrades,
and is where credentials live. Created with exclusive-create so two servers starting together agree on one
token (the loser reads the winner's file). A configured token never writes the file, and the file is
never read when one is configured.

**A generated token does not satisfy the off-loopback rule.** Off-loopback still requires a token the
operator chose (`server.token` / `PI_OUTPOST_TOKEN`): a generated secret printed on a console is not
an exposure decision, and the Docker recipe keeps its explicit secret.

**The startup URL carries `?token=`, and the browser the server opens uses it.** The browser flow
(`authToken.ts`) already stores and strips it. In development, the UI on Vite's port has no URL from the
server; the token screen takes it once (the startup line prints the token-bearing URL to copy it from).

**`sandbox.hostLoopback`, boolean, default `true`, effective only under MXC on Windows without
`allowedHosts`.** One key covers both the agent's shell and the confined terminal, because they share
`mxcTerminalConfig` and the same trade-off. With `allowedHosts` the request is unchanged (already
`hostLoopback: allow`, filtered to the proxy by MXC). Named for what it opens, not for the bug, so it stays
meaningful when Windows fixes intra-container loopback and the default can flip to `false`.

**The diagnosis request (`mxcDiagnosticConfig`) is left unchanged.** It only takes things away from the
command's request; a Python command rerun for diagnosis may hang there until its timeout, which the
diagnosis already bounds.

## Risks / Trade-offs

- [Every in-repo client that connects without a token breaks: ~290 `wsUrl()` calls in server tests, the
  e2e servers and pages, the bench, probes] → the harness gives every server a known token through
  `PI_OUTPOST_TOKEN` and `wsUrl()` carries it unless a test passes one explicitly (or `null` to test the
  refusal); e2e servers get explicit tokens and pages open with `?token=`.
- [Operators who bookmarked `http://127.0.0.1:3141/` meet the token screen once per browser] → the
  printed and opened URLs carry the token; release notes and `docs/getting-started.md` say where it is.
- [The token appears in the console and in any log capturing it] → the same exposure as Jupyter's;
  the file is the source of truth and can be deleted to rotate.
- [With the loopback open, a command can reach other local services: databases, dev servers, another
  user's tools on a shared machine] → documented next to the setting, `sandbox.hostLoopback: false`
  closes it; the startup line says which way it is.
- [MXC changes `hostLoopback` semantics or Windows ships the fix] → the probe in `tasks.md` becomes a
  test that fails loudly; the default can then flip without a schema change.

## Migration Plan

Ships in one release: token first (server, UI unchanged, harness, e2e), then the MXC network change,
then docs. Rollback is a revert; a generated token file left behind is harmless (ignored once a token is
configured, reused if the feature returns).
