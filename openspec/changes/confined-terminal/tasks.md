# Tasks

## 1. Configuration and self-check

- [x] 1.1 Parse `terminal.sandbox` (path resolved against the config file) in `server/src/config.ts`; verified by config tests (absent, relative, absolute; `path.join` expectations).
- [x] 1.2 Run `<runner> doctor` once at start with a timeout, keep availability and reason, report them in the snapshot; verified by ARunnerThatFailsItsSelfCheck and AMissingRunner with fake runner scripts (one failing `doctor`, one path missing), asserting no shell is spawned.

## 2. Confined spawn

- [x] 2.1 `terminalPolicy()` pure function (deny agent dir, config file, `/home`, `/root`, root's parent; allow root and tmp; write writable zone, tmp, tty devices); unit tests for sandbox with and without writable zone, `allowWrite: false`, and no sandbox (project root).
- [x] 2.2 Spawn through the runner with the policy file in a `0600` per-terminal temp dir removed on close; verified by a test with a fake runner that records its argv and policy, and checks the temp dir is gone after close.
- [x] 2.3 Minimal environment (`PATH`, `LANG`/`LC_*`, `TERM`, `SHELL`, `HOME=root`, `TMPDIR`); verified by KeysDoNotReachTheShell against the fake runner's recorded environment.
- [x] 2.4 NoRunnerConfiguredKeepsTodaysTerminal: the existing terminal suite passes unchanged without `terminal.sandbox`.

## 3. Real confinement (Linux)

- [x] 3.1 Container test with the real landstrip runner under Docker's default profile, driving a PTY: ReadsStayInsideTheRoot, WritesStayInsideTheWritableZone, TheConfinedTerminalStaysInteractive, TheServerCannotBeSignalled. It runs on the Linux CI job and is skipped elsewhere with the reason printed.

## 4. Sync and interface

- [x] 4.1 SyncUnderALockedSandbox as a server test: a confined terminal's cwd outside the root, Sync refused, agent root unchanged.
- [x] 4.2 Terminal panel: show the unavailability reason in place of the shell, and mark a confined terminal (badge naming its root); UI tests plus the running app (bench with a fake runner).

## 5. Documentation and verification

- [ ] 5.1 `docs/sandboxing.md`: installing the runner, `terminal.sandbox`, the `doctor` check to run in the target container, what stays readable (server environment, host files outside the denied trees), keys as credentials; validate the commands.
- [ ] 5.2 `scenario-coverage.md` mapping every scenario to its test; `npm run check:scenarios` and `openspec validate --strict` pass; suites green on Linux, macOS and Windows.

## Workflow follow-up

- After merge, archive this change from `main`.
- `multi-user-local-accounts` then builds on it (per-account policy, mandatory in multi-user mode).
