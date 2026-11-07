# Proposal

## Why

At the office, pi-outpost runs in a Rocky Linux container with Bubblewrap (MXC on Linux) and
`sandbox.allowedHosts`. The user wanted the agent to read an internal page; the connection was refused
with `[pi-outpost] network refused: … not in sandbox.allowedHosts` and no dialog appeared — the host
question only exists under MXC on Windows.

The `sandbox-command-exceptions` design (archived 2026-11-01) gated host questions per runner behind one
proof — *a command reaches its own proxy and no other command's* — and said "until that passes there,
nobody is asked". That proof (`another session's proxy under …` in `server/test/sandboxGrantsReal.test.ts`)
now passes in CI under MXC on Linux and macOS and under Seatbelt, and again locally on Debian and Rocky 9,
but `hostGrantsRefusal` was never lifted. The end-to-end question (connection held, user asked, answer
applied) was probed on Bubblewrap (Rocky 9) and Seatbelt and behaves as on Windows.

## What Changes

- An unlisted host is **asked about on connection** under MXC on Linux, MXC on macOS and Seatbelt, as it
  already is under MXC on Windows, when `sandbox.allowedHosts` is set and `sandbox.grants` is not `"never"`.
- The per-runner gate stays: a runner is asked about only once the proxy-isolation proof names it. Any
  other runner (landstrip cannot hold `allowedHosts` at all) keeps refusing at once, as the list says.
- The end-to-end question is tested under each POSIX runner where CI already runs it, not only probed.
- `docs/sandboxing.md`: the runner table and the "Without someone to ask" paragraph.

Unchanged: IP literals and loopback names stay refused without a question; a refused or unanswered host
behaves as today; the terminal panel and file tools are untouched.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sandbox-approved-grants`: *EachRunnerAppliesAGrantOrSaysItCannot* names the runners that ask about
  hosts (MXC on Windows, Linux and macOS, Seatbelt) and keeps refusal for any other; its scenario
  *AnUnprovenRunnerAsksNothingAboutHosts* now concerns runners without the proof, and a scenario per POSIX
  runner covers the question itself.

## Impact

- `server/src/sandboxGrants.ts` (`hostGrantsRefusal`), its unit tests in `server/test/sandboxGrants.test.ts`.
- `server/test/sandboxGrantsReal.test.ts`: the question end to end under MXC on Linux (CI `mxc-linux`),
  MXC on macOS and Seatbelt (CI `mxc-macos`).
- `docs/sandboxing.md`.
- `scripts/probes/mxc-linux-rocky/` kept as the Rocky 9 reproduction.
- No protocol, UI or configuration change: the dialog, broker and per-command proxy already exist.
