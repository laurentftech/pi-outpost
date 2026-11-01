# Scenario coverage

Inventory: `rg '^#### Scenario:' openspec/changes/mxc-windows-shell-tools/` lists every scenario of the change, both of them below.

| Applicable scenario | Status | Tests and assertions |
|---|---|---|
| AToolInstalledForTheUserRuns | covered | `server/test/terminalSandbox.test.ts` "AToolInstalledForTheUserRuns: the search path's folders are readable, but never one that would undo the sandbox" asserts that Python's folders, WindowsApps and `Program Files\nodejs` are in `readonlyPaths`. It also asserts that the home directory, `c:\users` (above it), `.pi` (holding the agent directory) and a relative entry are not, and that the agent directory stays denied. Under the real `wxc-exec.exe` on Windows 11, with this machine's `PATH`: `python --version` gave `Python 3.14.7` and `python -c` ran (both "not recognized" before), `Test-Path` on the agent directory's keys file was refused, and `.ssh` listed nothing. |
| ABareShellNameIsFoundOnThePath | covered | `server/test/config.test.ts` "ABareShellNameIsFoundOnThePath: …" asserts a bare name found in the `PATH` folder that has it (not the config's folder), a name without extension found through `PATHEXT` on Windows, a name not on `PATH` stopping startup with the message naming it, and a path resolved as before. Under the real executor, `pi-outpost doctor` with `"bashShell": "pwsh.exe"` reports the shell sandbox confined, where #391 reported "error code 2". |
