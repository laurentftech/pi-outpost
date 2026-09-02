## 1. The message

- [x] 1.1 Add the function that turns a failed bind into the line an operator reads, from the error, the host and the port; verify unit tests assert the occupied-port case names both the address refused and the flag that moves it, that another bind failure still produces a readable line, and that neither carries a stack.

## 2. The decision to hold the console

- [x] 2.1 Add the function that decides whether this process owns the console it printed on, from the platform, the environment and the parent's identity, with the parent supplied rather than looked up; verify unit tests assert a confident yes only for a file-manager parent on Windows, and no for a shell parent, an unknown parent, a probe that answered nothing, a non-Windows platform, and a continuous integration runner — the last taking precedence over everything else.
- [x] 2.2 Add the real parent probe behind that injection point, reading the parent's image name once and only when asked; verify a test proves a probe that fails or finds nothing returns no answer rather than throwing, so the decision degrades to "do not hold".

## 3. Joining the failure path

- [x] 3.1 Guard the one unguarded `await app.listen(...)` so a failure goes through the file's existing `complain()` and exits non-zero, and hold the console before exiting where the decision says to; verify a test starts a server on a port already bound — bound at port 0 and read back, never a fixed number — and asserts the exit code, the single line on stderr, and the absence of a stack trace.
- [x] 3.2 Verify the success path is untouched: a test asserts a server that binds prints what it printed before, waits for nothing, and answers `/health`. Done: `startup-failure.test.mjs` asserts the address line, the absence of any prompt to dismiss, and a served `/health`. "Never consulted" is structural rather than asserted — the probe has one call site, inside the `catch` at `server/src/index.ts:742`; nothing on the success path can reach it.

## 4. Proving it where it was found

- [x] 4.1 On Windows, double-click the standalone executable while another instance holds the port, and confirm the window stays open with the message in it until dismissed; record what appears verbatim. Done on Windows 11 against a fresh SEA. Launched through a shortcut (a double-click, parent `explorer.exe` confirmed via `ParentProcessId`) with port 3141 already bound. The window stayed open — process alive 9–20+ s, no timeout — showing verbatim:
  ```
  [config] loaded C:\Users\lfran\pi-outpost\server\dist\pi-outpost.config.json
  [config] agent runtime embedded
  [config] no sandbox: full toolset in C:\Users\lfran\pi-outpost\server\dist
  [server] serving web UI from embedded bundle (190 assets)
  [pi] cannot start: 127.0.0.1:3141 is already in use — something is listening there already; "--port <n>" starts this one somewhere else
  [pi] press any key to close this window
  ```
  A space keypress ended it and the process exited. One `[pi] cannot start:` line, no stack trace.
- [x] 4.2 On the same machine, run the same failing start from PowerShell and confirm it exits immediately with the same line and no prompt to dismiss. Done. Parent = `pwsh.exe`; exit code 1; stderr was exactly `[pi] cannot start: 127.0.0.1:3141 is already in use — something is listening there already; "--port <n>" starts this one somewhere else` — no "press any key", no stack, no `unhandled`. It returned as soon as the bind failed (the ~2.6 s was startup work, not a wait).

## 5. The rest of the pre-listen failures

The Windows check turned up the gap this section closes. The hold wrapped only the
`await app.listen()` rejection. Every earlier exit — no configuration file, a flag that
will not parse, an unreadable setting — went straight to `process.exit(1)`, so a
double-clicked launch that failed for the commonest first-run reason (no config yet)
still flashed its message and vanished. Verified on Windows before the fix: the no-config
window closed on its own in ~2 s.

- [x] 5.1 Factor the hold into `holdConsoleIfOwned()` in `startupFailure.ts` and call it before the `NoConfigError`, the `complain()`-then-exit, and the `parseCli` failure exits, as well as the existing bind catch; the decision stays injectable so a test can drive both directions off Windows. `server/src/startupFailure.ts`, `server/src/index.ts` (the config and `parseCli` IIFEs become `await`ed).
- [x] 5.2 Unit tests for `holdConsoleIfOwned`: a file-manager parent on Windows prints the prompt and drives `waitForAKey` (raw on, wait, raw off, pause, in order); a shell parent, a CI runner, a non-Windows platform, and a probe that could not answer each touch nothing. Integration test in `startup-failure.test.mjs`: a real `index.ts` started with a launch dir that has no config and an empty `XDG_CONFIG_HOME` exits non-zero with the "no configuration file found" line, no stack, and — run from a test runner, not a file manager — no "press any key" and no hang.
- [x] 5.3 On Windows 11, a fresh SEA double-clicked (shortcut, parent `explorer.exe`) with no discoverable config now holds the window until a keypress, showing the "no configuration file found" block followed by `[pi] press any key to close this window`. The same start from PowerShell still exits at once with no prompt.

## 6. Scenario coverage and validation

- [x] 6.1 Enumerate every `#### Scenario:` in the delta, write the scenario-to-test matrix with assertion-level evidence, and leave none partial or uncovered — `scenario-coverage.md`. `TheMessageOutlivesTheWindow` and the new `AFailureBeforeListeningIsHeldToo` are now established on a real Windows machine (task 4.1 / 5.3), not left partial.
- [x] 6.2 Run the focused tests, then the server suite, typecheck, lint, and `openspec validate say-why-the-server-could-not-start --strict` — see `scenario-coverage.md` for the run.
