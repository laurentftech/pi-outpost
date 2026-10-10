# Scenario coverage — confined-terminal

Capability: `terminal` (6 added requirements, 12 scenarios). Three kinds of evidence:

- **Real runner, Linux**: `server/test/terminalSandboxReal.test.ts` drives a real pty through
  `TerminalManager` with landstrip's runner (`LANDSTRIP_BIN`, set by CI's Linux job; skipped elsewhere
  with the reason).
- **Real runner, Windows 11**: `server/test/terminalSandboxMxc.test.ts` does the same through MXC's
  `wxc-exec.exe` (`MXC_EXEC`; no CI runner has tier 1 yet, so it runs on a developer machine). Run on
  Windows 11 Home 24H2, build 26100.9457, on 2026-10-10: all pass.
- **Fake runner, real server**: `server/test/terminalSandboxWire.test.mjs` starts the server with a
  runner script that records what it is asked (POSIX: the fake needs a shebang).

## terminal

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| ReadsStayInsideTheRoot | covered | `server/test/terminalSandboxReal.test.ts` — "reads stop at the root: a sibling project, the agent's keys, a /proc escape": `cat` of each answers `Permission denied` (or no such file for `/proc`), and `ls` of the parent does not show the sibling. `server/test/terminalSandboxMxc.test.ts` — "reads stop at the root: a sibling project and the agent's keys": `type` answers access denied and the key never appears. |
| WritesStayInsideTheWritableZone | covered | `server/test/terminalSandboxReal.test.ts` — "writes succeed in the writable zone and are refused elsewhere in the root"; `server/test/terminalSandboxMxc.test.ts` — the same under MXC. Both read the written file back from disk and assert the refused one does not exist. |
| TheConfinedTerminalStaysInteractive | covered | `server/test/terminalSandboxReal.test.ts` — "git, a background job and its listing work as in any terminal": `git init` succeeds, `jobs` lists the background `sleep`. |
| TheServerCannotBeSignalled | covered | `server/test/terminalSandboxReal.test.ts` — "the server cannot be signalled from inside": `kill -TERM <server pid>` is refused and the test process is still running. |
| NoRunnerConfiguredKeepsTodaysTerminal | covered | `server/test/terminalManager.test.ts` — "without a runner, the shell itself is spawned, with the server's environment, unconfined": a recording pty shows the shell, not a runner, was spawned, with a server variable in its environment, and the session is not marked confined. The rest of `terminalManager.test.ts` and `terminalWire.test.mjs` pass unchanged. |
| OnWindowsTheConfinedShellIsPowerShell | covered | `server/test/terminalManager.test.ts` — "a confined terminal on Windows opens PowerShell, not Git Bash": the confined default is `powershell.exe` or `cmd.exe`, never `bash.exe`, and an explicit `terminal.shell` still wins. Runs on Windows only (CI's Windows job). |
| AnMxcRunnerBelowTier1MeansNoTerminal | covered | `server/test/terminalSandbox.test.ts` — "only tier 1 is usable: a lower tier would stamp ACLs over the readable drive": `base-container` is accepted; `appcontainer-dacl` is refused with a reason naming it and `base-container`; a build that cannot deny paths is refused. "anywhere but Windows, or a probe that fails or says nothing usable, is a reason" covers the other refusals. |
| OnWindowsWithMxcGitRunsConfined | covered | `server/test/terminalSandboxMxc.test.ts` — "git finds its work tree and runs, inside the sandbox": in a writable root, `git rev-parse` answers `true`, `git status` answers, `NUL` opens, and the agent directory's key file stays refused. |
| KeysDoNotReachTheShell | covered | `server/test/terminalSandbox.test.ts` — "keys and other server variables stay out; the shell's own basics are set" (the exact environment) and "the request carries the command line, the start directory and only the given environment" (MXC's request carries only the built list); `server/test/terminalSandboxWire.test.mjs` — "a confined terminal is spawned through the runner with its policy, a built environment, and cleaned up" (the runner's recorded environment lacks the key); `server/test/terminalSandboxMxc.test.ts` — "the server's keys are not in the shell's environment" (`set` inside the real container). |
| ARunnerThatFailsItsSelfCheck | covered | `server/test/terminalSandboxWire.test.mjs` — "a runner that fails its self-check means no terminal, with its reason, and no shell": the open is refused with the runner's words, and the runner's log shows only `doctor`. |
| AMissingRunner | covered | `server/test/terminalSandboxWire.test.mjs` — "a runner that does not exist means no terminal, with a reason naming the path". |
| SyncUnderALockedSandbox | covered | `server/test/terminalSandboxWire.test.mjs` — "syncing the agent to a confined terminal's directory cannot move a locked root": the sync is refused and the agent's root is unchanged. |
