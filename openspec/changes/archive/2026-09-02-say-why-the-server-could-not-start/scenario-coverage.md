# Scenario coverage

Every `#### Scenario:` in `specs/cli/spec.md`, with the assertion that would fail if the
contract broke. Enumerated with `rg '^#### Scenario:' openspec/changes/say-why-the-server-could-not-start/`.

| Scenario | Status | Where | What would fail |
|---|---|---|---|
| ThePortIsAlreadyTaken | covered | `server/test/startup-failure.test.mjs` — "exits non-zero with one readable line and no stack trace"; `server/test/startupFailure.test.ts` — "an occupied port names the address refused and the flag that moves it" | The integration test holds a real port (bound at 0, read back), starts a real server against it, and asserts the exit code is non-zero, that stderr names `127.0.0.1:<that port>`, says "already in use", names `--port`, carries no `at ` stack frame, no `unhandled`, and exactly one `cannot start` line. Remove the `try`/`catch` at `server/src/index.ts:742` and every one of those fails. |
| TheBindFailsForSomeOtherReason | covered | `server/test/startupFailure.test.ts` — "another reason still gets a sentence", "an unknown reason carries the reason, and never a stack" | Asserts EACCES and EADDRNOTAVAIL each name the address and the flag that applies (`--port`, `--host`); that EACCES on a high port does not blame privilege, which a reserved range or a security product can cause; that a literal IPv6 host keeps its brackets so `[::1]:3141` still names a port; and that an unrecognised code still yields a sentence carrying the underlying message and never the stack. Reached at the wire only through a port the machine refuses, which is not portable to assert; the message is the whole of what changes between codes, and it is asserted directly. |
| TheMessageOutlivesTheWindow | covered | `server/test/startupFailure.test.ts` — "a file manager above us on Windows owns the window", "a key ends the wait and hands the terminal back"; **task 4.1 on real Windows** | The decision is asserted in full: `explorer.exe` above us on Windows is the only yes, in three spellings. The wait is driven through a supplied stream and asserts raw mode goes on and back off and the stream is paused. Task 4.1 established the rest on a real machine: a shortcut-launched (double-click) SEA with the port taken has `explorer.exe` as `ParentProcessId`, holds the window (process alive 20+ s, no timeout) showing the `cannot start` line and `press any key to close this window`, and exits on a keypress. |
| AFailureBeforeListeningIsHeldToo | covered | `server/test/startupFailure.test.ts` — "a file-manager launch that fails before listening still holds the window", "a shell launch is not held…"; `server/test/startup-failure.test.mjs` — "no configuration file: one readable line, no stack, and nothing to dismiss from a shell"; **task 5.3 on real Windows** | `holdConsoleIfOwned` is now the single hold, called before the `NoConfigError`, `complain()` and `parseCli` exits as well as the bind catch. The unit test drives the file-manager branch (prompt printed, `waitForAKey` sequenced raw:true→wait→raw:false→pause) and the shell/CI/non-Windows branches (nothing touched). The integration test starts a real `index.ts` with no discoverable config and asserts exit≠0, the "no configuration file found" line, no stack, and — from a test runner — no "press any key" and no hang. Task 5.3: the same no-config double-click on Windows 11 now holds until a keypress. |
| NobodyElseIsMadeToWait | covered | `server/test/startupFailure.test.ts` — "a shell borrows a console that outlives us", "no answer is not a yes", "elsewhere the terminal outlives the process", "a runner is never made to wait", "a shell launch is not held…", "a runner is never held…"; `server/test/startup-failure.test.mjs` — rows 1 and the no-config row; **task 4.2 on real Windows** | Four shells answer no, an absent or empty parent answers no, macOS and Linux answer no whatever the parent, and `CI` answers no even with `explorer.exe` above. Both integration tests assert stderr never says "press any key" — they run from a test runner and would hang rather than fail if the decision flipped. Task 4.2: from PowerShell (`pwsh.exe` parent) the occupied-port start exits code 1 at once with the one line and no prompt. |
| AServerThatStartsIsUnchanged | covered | `server/test/startup-failure.test.mjs` — "says what it always said, waits for nothing, and serves" | Starts a real server through the harness, which only resolves once `/health` answers — so a process that stopped to be dismissed fails by timing out. Then asserts the `[server] http://127.0.0.1:<port>/` line is printed as before and that the log contains neither "press any key" nor "cannot start". |

## What no test here establishes

Every scenario is now backed by a test *and*, for the Windows-only behaviour, by a real
run on Windows 11 (tasks 4.1, 4.2, 5.3). The one thing still outside a test's reach is a
genuinely browser/`tasklist`-less hardened Windows box: `parentImageName()` is asserted
not to throw and to answer `undefined` off Windows, and `parseTasklistImageName` is
asserted against real `tasklist` CSV and its polite refusal — but a machine where
`tasklist` is absent or blocked can only be reasoned about (the probe returns `undefined`,
`ownsItsConsole` says no, the process exits as it does today).

## The run

- typecheck clean; lint clean (warnings pre-existing, none in touched files)
- focused: `startupFailure.test.ts` + `startup-failure.test.mjs` — all pass, including the
  five new `holdConsoleIfOwned` unit tests and the no-config integration test
- `openspec validate say-why-the-server-could-not-start --strict` — valid
- full server suite: pre-existing environmental failures on this Windows box only (pptx
  tooling absent, symlink privilege, release-channel tag detection), each reproduced with
  the branch stashed
