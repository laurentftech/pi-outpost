# Tasks

## 1. The search path under MXC on Windows

- [x] 1.1 Make every folder of the shell's `PATH` readable in `mxcTerminalConfig`, leaving out a drive's root and any folder that is or holds the home directory, or holds the agent directory or the configuration (compared without case), for the agent's shell and the confined terminal. Verify with `server/test/terminalSandbox.test.ts` "AToolInstalledForTheUserRuns: …", and under the real `wxc-exec.exe`: `python --version` and a line of Python run, the agent directory's keys file stays refused, `.ssh` stays out of reach.

## 2. A bare bashShell

- [x] 2.1 Look a bare `sandbox.bashShell` up on `PATH` at load (`PATHEXT` on Windows), and stop startup naming one not found. Verify with `server/test/config.test.ts` "ABareShellNameIsFoundOnThePath: …", and with `pi-outpost doctor` and `"bashShell": "pwsh.exe"` under the real executor: the shell sandbox is confined.

## 3. Documentation and coverage

- [x] 3.1 Update `docs/sandboxing.md` (the Windows limits, the bare shell name) and the README's `bashShell` row. Verify that the anchors resolve.
- [x] 3.2 Write `scenario-coverage.md` and run `npm run check:scenarios` and `openspec validate mxc-windows-shell-tools --strict`; verify both pass.

## Workflow follow-up

- Archive the change after review and merge.
