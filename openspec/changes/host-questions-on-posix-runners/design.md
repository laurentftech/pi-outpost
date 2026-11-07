# Design

## Context

- `asksAboutHosts` (`server/src/sandbox.ts`) gives the agent's confined bash an `askHost` hook only when
  `hostGrantsRefusal(runner)` (`server/src/sandboxGrants.ts`) returns nothing. Today that is MXC on Windows
  alone; every POSIX runner gets "host grants are not yet proven under …".
- Everything downstream is runner-independent and already shipped: a proxy per command started by
  `confinedBashOperations` when `askHost` is present, the broker, the `connection` grant request, the
  dialog, the notes appended to the output, the session's host grants.
- The proof the gate waits for — a command reaches its own proxy and no other command's port — is
  `another session's proxy under …` in `server/test/sandboxGrantsReal.test.ts`. CI runs it under MXC on
  Linux (`scripts/mxc-linux/test.sh`, documented Docker flags) and under MXC on macOS and Seatbelt
  (`scripts/mxc-macos/test.sh`, Apple silicon). All three pass. It also passed by hand on Debian and Rocky 9
  (`scripts/probes/mxc-linux-rocky/cross-proxy.mts`).
- The question end to end was probed on Bubblewrap (Rocky 9) and Seatbelt
  (`scripts/probes/mxc-linux-rocky/ask-host.mts`): allowed once → 200 for two connections, one question;
  refused → connection fails, refusal note.

## Goals / Non-Goals

**Goals:**
- Ask about an unlisted host under every runner the proof covers, with the same dialog and notes as on
  Windows.
- Keep the gate as a gate: a runner is admitted by name, because its proof exists; anything else refuses.
- Turn the probes into tests where CI already runs each runner.

**Non-Goals:**
- landstrip: `sandbox.allowedHosts` is refused by the configuration for it, so there is nothing to ask.
- Chaining the egress proxy to a corporate proxy, or passing `HTTPS_PROXY` into confined commands: the
  office need is internal pages, which are reached directly. Kept as a separate follow-up.
- Changing what can never be granted (IP literals, loopback names).

## Decisions

### 1. Admit runners by kind, not "everything but landstrip"

`hostGrantsRefusal` returns nothing for `runnerKind(runner)` of `"mxc"` (Windows, Linux, macOS) and
`"seatbelt"`, and keeps its refusal otherwise. The alternative — refuse only landstrip — would admit any
runner added later before its proof exists, which is what the gate is for. The refusal text keeps saying
what a runner must show.

### 2. Test the question where each runner already runs in CI

`sandboxGrantsReal.test.ts` gains, beside the isolation proof and for the same three POSIX runners, the
question end to end through `confinedBashOperations` with a shared list proxy and an `askHost` that plays
the user: two connections to an unlisted host, allowed once (both 200, one question, the allow note) and
refused (no 200, the refusal note). The target is a real public host (`example.com`), used only where
the job is online — as the existing `OnLinuxAnAllowedHostIsReachedAndOthersAreRefused` already does — and
the test skips otherwise.

*Alternative:* a local origin. Rejected: the proxy refuses IP literals and loopback names by design, so a
local target would test the refusal, not the question.

### 3. The server path once, under a real POSIX runner

A wire test in the style of `sandboxGrantsServer.test.mjs` (scripted provider, real server, a client
answering the `connection` grant request) with `bashRunner` set to the runner the environment names
(`SEATBELT_EXEC`, `MXC_MAC_EXEC`, `MXC_LXC_EXEC`), so `asksAboutHosts` itself is exercised, not only the
bash operations under it. It is added to both CI scripts and skips where no runner is named.

### 4. Live check: the office's shape

The running app is checked twice: on this Mac under Seatbelt with the bench host page, and in the Rocky 9
image under Bubblewrap with the server's port published — the scripted provider makes the agent run
`curl` against an unlisted host, and the dialog is answered in the browser.

## Risks / Trade-offs

- [A POSIX runner's isolation regresses in a future MXC or macOS release] → The proof stays in CI for each
  runner; a failure there is a failing job, not a silent widening. The gate is one function to close again.
- [Questions about hosts nobody typed (e.g. certificate revocation fetches)] → As on Windows: a real
  connection, said as such; the docs already recommend listing those hosts.
- [CI without outbound network skips the end-to-end question] → The isolation proof does not need the
  network (it targets `example.invalid` through local proxies) and still runs; the skip is visible in the
  log.

## Migration Plan

Behavioural, no data. A deployment with `sandbox.allowedHosts` on a POSIX MXC or Seatbelt runner starts
receiving host questions instead of immediate refusals; `sandbox.grants: "never"` restores the previous
behaviour.
