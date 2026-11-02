# Scenario coverage — lock-when-sandbox-off

`server/test/sandboxOffLock.test.mjs` starts the real server and reads the snapshot a client receives on
connect: the shell's verdict as the interface gets it, beside the agent's own tool list. The lock's
rendering is pinned in `ui/src/components/ConfinementLock.test.tsx`, which mounts the real `ModelBar`.

## Capability: `sandbox-defaults` (2 scenarios, modified)

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| SandboxFalseRestoresTheOldBehaviour | covered | `server/test/sandboxOffLock.test.mjs` — "with the sandbox off, the agent's shell is shown not confined, saying the sandbox is off": with `sandbox: false` the agent has an active `bash` and `hello.confinement.bash` is exactly `{ state: "unconfined", sandboxOff: true }` (fails without the change: no verdict at all); `ui/src/components/ConfinementLock.test.tsx` — "TheSandboxOff: …": an open lock, neutral (no nudge, no ring), whose description says `the sandbox is turned off ("sandbox": false)` and `not confined by pi-outpost`, and never `--confine`. The write outside the directory is the sandbox being off, unchanged and covered by the default-sandbox tests. |
| SandboxFalseWithoutAShellShowsNoLock | covered | `server/test/sandboxOffLock.test.mjs` — "with the sandbox off and no bash tool, no lock is shown": `tools: ["read", "ls"]`, no active `bash`, and no `confinement.bash` |

## Capability: `sandbox-runner-bash` (5 scenarios, modified)

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| AVerifiedRunnerEarnsTheLock | covered | Unchanged: `server/test/confinementCanary.test.ts` "AVerifiedRunnerEarnsTheLock: …" and `ui/src/components/ConfinementLock.test.tsx` "AVerifiedRunnerEarnsTheLock: …" |
| ALeakOpensTheLockAndSaysWhat | covered | Unchanged: `server/test/confinementCanary.test.ts` "ALeakOpensTheLockAndSaysWhat: …" and `ui/src/components/ConfinementLock.test.tsx` "ALeakOpensTheLockAndSaysWhat: …" |
| NoRunnerNoLock | covered | Unchanged: `server/test/confinementCanary.test.ts` "NoRunnerNoLock: …" (`shellIsConfined` false with `allowBash` off or `bashFrom`) and `ui/src/components/ConfinementLock.test.tsx` "NoRunnerNoLock: …"; the new branch needs `sandbox` absent, so a sandbox with `allowBash` off still gets no verdict |
| AnUnconfinedShellIsMarked | covered | Unchanged: `ui/src/components/ConfinementLock.test.tsx` "ACapableMachineIsNudged: …" and "AnIncapableMachineIsNotNudged: …"; `server/test/autoRunner.test.ts` for which configurations count as unconfined |
| AnRpcChildsShellIsNotJudged | covered | `server/test/sandboxOffLock.test.mjs` — "an RPC child's shell is not judged": the `rpc` runtime with the sandbox off sends no `confinement.bash` |
