# Scenario coverage

`orient` pointed at `server/src/terminalSandbox.ts` (`checkRunner`), `server/src/confinedBash.ts`,
`server/src/terminalManager.ts`, `server/src/doctor.ts` and `ui/src/components/TerminalPanel.tsx`.
Scenarios enumerated with `rg '^#### Scenario:' openspec/changes/confinement-lock`.

| Scenario | Status | Test file and name |
|---|---|---|
| AVerifiedRunnerEarnsTheLock | covered | Real runner: `server/test/confinementCanary.test.ts`: `AVerifiedRunnerEarnsTheLock: every attempt is refused through the runner's own path` — Seatbelt on macOS (`SEATBELT_EXEC`, here and CI `mxc-macos`), Bubblewrap through MXC on Linux (CI `mxc-linux`): verdict `verified`, all five attempts refused in order, the bait gone. Interface: `ui/src/components/ConfinementLock.test.tsx`: `AVerifiedRunnerEarnsTheLock: closed, naming the runner, the time and each refusal`. |
| ALeakOpensTheLockAndSaysWhat | covered | `server/test/confinementCanary.test.ts`: `ALeakOpensTheLockAndSaysWhat: every attempt is reached, and named` — a runner that confines nothing: verdict `leaking` naming the agent directory and every other attempt, the bait removed. Interface: `ui/src/components/ConfinementLock.test.tsx`: `ALeakOpensTheLockAndSaysWhat: open, red, naming the agent directory`. Running app: a fake runner opened both locks in red (below). |
| NoRunnerNoLock | covered | `ui/src/components/ConfinementLock.test.tsx`: `NoRunnerNoLock: no runner, no lock` — no verdict, no element. The server sends `confinement.bash` only with `bashRunner` and `allowBash` (`confinementOf`, exercised in the running app). |
| DoctorReportsWhatGotThrough | covered | `server/test/doctor.test.ts`: `DoctorReportsWhatGotThrough: a write beside the root is a failed check, and the exit status says so` — `shell sandbox` is `fail`, names `/opt/landstrip` and the write, `exitCodeFor` is 1. A real `doctor` on this Mac reported both surfaces `ok` under Seatbelt. |
| AReadableEnvironmentWithoutSecretsKeepsTheLock | covered | `server/test/confinementCanary.test.ts`: `AReadableEnvironmentWithoutSecretsKeepsTheLock: only the server's process environment readable, and it holds no secret` (verdict `verified` with `environmentReadable`), and the real landstrip test (`LANDSTRIP_BIN`, CI's Linux `check`): the verdict follows the server's actual environment — `verified` and readable when it holds no secret, `partial` naming exactly its secret-looking variables otherwise. Interface: `ui/src/components/ConfinementLock.test.tsx`: `AReadableEnvironmentWithoutSecretsKeepsTheLock: …`. |
| SecretsInAReadableEnvironmentAreNamed | covered | `server/test/confinementCanary.test.ts`: `SecretsInAReadableEnvironmentAreNamed: …` (`partial` naming `OPENAI_API_KEY`; with anything else reached, still `leaking`) and `secret-looking names only, by name, …`. Interface: `ui/src/components/ConfinementLock.test.tsx`: `SecretsInAReadableEnvironmentAreNamed: amber, …` — the name in the tooltip, never a value. `doctor` warns: `server/src/doctor.ts` `partial` case. |
| AnUnverifiedTerminalIsNotCalledConfined | covered | `ui/src/components/TerminalPanel.test.tsx`: `AnUnverifiedTerminalIsNotCalledConfined: until the canary answers, the badge says it is checking` — `data-state="checking"`, no 🔒. |
| ALeakingTerminalSaysSo | covered | `ui/src/components/TerminalPanel.test.tsx`: `ALeakingTerminalSaysSo: the badge is open, red, and names the write beside the root`. |

## Running app

2026-10-18, this Mac (Intel), the web UI driven with Playwright and the DOM read back:

- Seatbelt (`"seatbelt"` for both surfaces, `allowedHosts`): the shell's lock read "checking" at load,
  then 🔒 with the seven refusals (proxy attempts included); the terminal's badge 🔒 with five.
- A fake runner that passes its self-check and runs the command unconfined: both open in red, naming
  the agent directory, beside the root, the write and the signal; the server's environment stayed
  refused (the shell's environment is rebuilt, and macOS has no `/proc`).
- Monkey: turning "Allow write" off and applying flipped both to "checking" within 250 ms and back to
  their verdict within a second; a reload shows the cached verdict at once.
- `pi-outpost doctor` on the Seatbelt configuration: `shell sandbox` and `terminal sandbox` `ok`, the
  agent directory left as it was.
