## 1. The canary

- [x] 1.1 Bait: marker file in the agent directory, private directory outside the root with a marker, marker variable in the server's environment; removed in `finally`; "not checked" when the private directory falls inside the root.
- [x] 1.2 The canary scripts (POSIX `sh`, PowerShell): one `PI_OUTPOST_CANARY <name> refused|reached` line per attempt — agent file, file beside the root, write beside the root, signal, environment marker, and under `allowedHosts` the proxy refusal and a direct connection.
- [x] 1.3 Run through `confinedBashOperations` (agent's shell) and under the terminal's policy (terminal); parse into a verdict; a missing line is "failed".

## 2. Server and protocol

- [x] 2.1 `confinement` verdicts in the snapshot (`checking`, `verified`, `leaking`, `failed`); absent with no runner.
- [x] 2.2 Run at start after the self-check, and again on sandbox settings changes; broadcast.

## 3. Interface

- [x] 3.1 The composer's lock: closed, open and red, checking, warning; tooltip with runner, time, attempts.
- [x] 3.2 `TerminalPanel`'s badge from `confinement.terminal`.

## 4. Doctor

- [x] 4.1 `confinementCheck` per configured runner: ok, fail per reached attempt, warn when not checked or failed; exit status.

## 5. Tests

- [x] 5.1 Unit: verdict parsing, bait placement and cleanup, "not checked" cases, doctor's check, the UI states (lock and badge).
- [x] 5.2 A leaking runner (a fake that runs the command unconfined) opens the lock naming each attempt; a real runner closes it — on this Mac (Seatbelt), in CI's `mxc-linux` and `mxc-macos`.
- [x] 5.3 Running app: the lock closed under a real runner, open under the fake one; monkey pass (change sandbox settings while checking, reconnect, switch project).

## 6. Documentation and checks

- [x] 6.1 `docs/sandboxing.md` *Check that it is really confined*, README.
- [x] 6.2 `scenario-coverage.md`, `openspec validate --strict`, `check:scenarios`, typecheck, lint, the UI suite.

## After merge

- Archive the change from `main`.
