# Proposal

## Why

On Windows 11, MXC's process container blocks every loopback TCP connection — even one a process makes
to itself — unless the host's loopback is opened (`ingress.hostLoopback: "allow"`). CPython on Windows
builds `socket.socketpair()`, and with it every asyncio event loop, from such a connection, so any
Python using asyncio (pytest-asyncio, lancedb at import, uvicorn, MCP servers) hangs silently forever in
the agent's shell and in a confined terminal (issue #525; measured with mxc-sdk 1.1.0 on Windows
10.0.26100.9711, reported upstream as microsoft/mxc#1261, an acknowledged OS bug with no fix date).
No MXC policy gives a process its own loopback without also opening the host's.

Opening the host's loopback today would be a sandbox escape: the server listens on `127.0.0.1` without
a token by default and accepts any WebSocket client that sends no `Origin` header, on the assumption that
"a local process already has shell access". A confined command could then drive the server — load an
extension that runs unconfined, widen `sandbox.root`, answer its own grant questions, use stored
credentials. The token has to close that door before the loopback opens.

## What Changes

- **BREAKING** The server always requires a token, on loopback too. When neither `server.token` nor
  `PI_OUTPOST_TOKEN` is set, it generates one at first start, keeps it in the agent directory (which
  every sandbox runner already denies) and reuses it on later starts.
- The startup line and the browser the server opens carry the token (`?token=`), as Jupyter does; the
  existing browser flow stores it and strips it from the address bar. Print mode and the embed widget
  keep passing their token as they do now.
- A WebSocket client without an `Origin` header is no longer trusted for being local: it presents the
  token like any other client. `/health` no longer exposes the session id to an unauthenticated caller.
- Under MXC on Windows, with no `sandbox.allowedHosts`, the agent's shell and the confined terminal run
  with the host's loopback open, so `socket.socketpair()` and asyncio work. Other services listening on
  the machine's loopback become reachable from a command, as under Codex's MXC backend; the
  configuration key `sandbox.hostLoopback: false` closes it again (for when Windows ships the fix, or for
  an operator who prefers the hang to the exposure).
- Under `sandbox.allowedHosts` nothing changes: MXC refuses any loopback rule beside its proxy, so
  asyncio still hangs there. The startup line and the documentation say so.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `auth`: the token is no longer optional — generated and persisted when none is configured, required on
  loopback listeners, and carried in the startup and browser URLs; `/health` is redacted always.
- `server-transport`: a loopback listener keeps plain HTTP but no longer serves without a token.
- `sandbox-runner-bash`: under MXC on Windows without `sandbox.allowedHosts`, a command reaches its own
  loopback (and the host's) unless `sandbox.hostLoopback` is false; under `sandbox.allowedHosts` the
  limit is stated.
- `terminal`: the Windows MXC terminal follows the same loopback rule as the agent's shell.

## Impact

- `server/src/config.ts` (token generation and storage, `sandbox.hostLoopback`), `server/src/index.ts`
  (WebSocket and HTTP token checks, `Origin`-less trust removed, startup URL, `/health`),
  `server/src/terminalSandbox.ts` (`mxcTerminalConfig` network block), `server/src/confinementStatus.ts`
  and the startup sandbox line.
- The test harness (`server/test/harness.mjs`): about 290 `wsUrl()` calls connect without a token; the
  harness gives every server a known token and `wsUrl()` carries it by default. e2e global setup and the
  embed bench likewise.
- Clients that open `http://127.0.0.1:3141/` by hand now meet the token screen once per browser; the
  printed URL avoids it. The development UI on Vite's port needs the token once the same way.
- Documentation: `docs/getting-started.md`, `docs/configuration.md` (`server.token`, new
  `sandbox.hostLoopback`), `docs/sandboxing.md` (Windows 11 MXC network), `docs/command-line.md`.
- No interaction with the in-flight `multi-user-local-accounts` change beyond making its premise (every
  connection authenticated) true in single-user mode as well.
