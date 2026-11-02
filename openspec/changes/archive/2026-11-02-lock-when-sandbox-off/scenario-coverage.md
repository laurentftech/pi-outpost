# Scenario coverage — lock-when-sandbox-off

`server/test/sandboxOffLock.test.mjs` starts the real server and reads the snapshot a client receives on
connect: the shell's verdict as the interface gets it, beside the agent's own tool list. The lock's
rendering is pinned in `ui/src/components/ConfinementLock.test.tsx`, which mounts the real `ModelBar`.

## Capability: `sandbox-defaults` (9 scenarios, modified and added)

`server/test/confineCommand.test.ts` drives `confineConfiguration` against a real file, with the canary
given. Its success paths need a runner `"auto"` can take — Seatbelt on macOS — so this change adds the file
to `scripts/mxc-macos/test.sh`, which CI's `mxc-macos` job runs; elsewhere they skip, as they always did.

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| SandboxFalseRestoresTheOldBehaviour | covered | `server/test/sandboxOffLock.test.mjs` — "with the sandbox off, the agent's shell is shown not confined, saying the sandbox is off": with `sandbox: false` the agent has an active `bash`, the snapshot's `confinement.bash` is `unconfined` with `sandboxOff`, and the machine's check then settles it with a reason (no runner in this environment) or `available`, still `sandboxOff` (fails without the change: no verdict at all); `ui/src/components/ConfinementLock.test.tsx` — "TheSandboxOff: …": open and neutral (no nudge, no ring), the description saying `the sandbox is turned off ("sandbox": false)` and `not confined by pi-outpost`, never `--confine`. The unscoped write is the sandbox being off, unchanged |
| SandboxFalseIsNudgedWhereItCanBeConfined | covered | `ui/src/components/ConfinementLock.test.tsx` — "TheSandboxOffOnACapableMachine: …": `data-nudge`, the amber ring, and a description naming Seatbelt, `pi-outpost config --confine` and that the file tools are limited too, without `bashRunner`; the server side is the same cached runner check as an unconfined shell's (`unconfinedShellVerdict`), spread into the sandbox-off verdict |
| SandboxFalseWithoutAShellShowsNoLock | covered | `server/test/sandboxOffLock.test.mjs` — "with the sandbox off and no bash tool, no lock is shown": `tools: ["read", "ls"]`, no active `bash`, and no `confinement.bash` |
| AlreadyConfinedIsANoOp | covered | Unchanged: `server/test/confineCommand.test.ts` — "AlreadyConfinedIsANoOp: …" |
| NoShellNothingToConfine | covered | Unchanged: `server/test/confineCommand.test.ts` — "NoShellNothingToConfine: …" |
| SandboxFalseIsNotOverridden | covered | `server/test/confineCommand.test.ts` — "SandboxFalseIsNotOverridden: a runner that leaks, or none at all, leaves the file as it was": exit 1, the file byte for byte, `unchanged` first — with no runner here it stops at the self-check, on macOS at the leaking canary |
| NoFileUsesTheDefault | covered | Unchanged: `server/test/confineCommand.test.ts` — "NoFileUsesTheDefault: …" |
| SandboxFalseIsRestoredAsTheDefault | covered | `server/test/confineCommand.test.ts` — "SandboxFalseIsRestoredAsTheDefault: …" (runs on `mxc-macos`): exit 0, the canary ran once, the file is `{ port, sandbox: { allowWrite, allowBash, bashRunner: "auto" }, branding }`, the output names the change and says the file tools are limited to the project, no rehearsal file left |
| SandboxFalseUnderRpcIsNotRestored | covered | `server/test/confineCommand.test.ts` — "SandboxFalseUnderRpcIsNotRestored: …": exit 1, the canary never ran, the file unchanged, the output saying a sandbox cannot be enforced for an RPC child |

## Capability: `sandbox-runner-bash` (5 scenarios, modified)

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| AVerifiedRunnerEarnsTheLock | covered | Unchanged: `server/test/confinementCanary.test.ts` "AVerifiedRunnerEarnsTheLock: …" and `ui/src/components/ConfinementLock.test.tsx` "AVerifiedRunnerEarnsTheLock: …" |
| ALeakOpensTheLockAndSaysWhat | covered | Unchanged: `server/test/confinementCanary.test.ts` "ALeakOpensTheLockAndSaysWhat: …" and `ui/src/components/ConfinementLock.test.tsx` "ALeakOpensTheLockAndSaysWhat: …" |
| NoRunnerNoLock | covered | Unchanged: `server/test/confinementCanary.test.ts` "NoRunnerNoLock: …" (`shellIsConfined` false with `allowBash` off or `bashFrom`) and `ui/src/components/ConfinementLock.test.tsx` "NoRunnerNoLock: …"; the new branch needs `sandbox` absent, so a sandbox with `allowBash` off still gets no verdict |
| AnUnconfinedShellIsMarked | covered | Unchanged: `ui/src/components/ConfinementLock.test.tsx` "ACapableMachineIsNudged: …" and "AnIncapableMachineIsNotNudged: …"; `server/test/autoRunner.test.ts` for which configurations count as unconfined |
| AnRpcChildsShellIsNotJudged | covered | `server/test/sandboxOffLock.test.mjs` — "an RPC child's shell is not judged": the `rpc` runtime with the sandbox off sends no `confinement.bash` |
