# Scenario coverage

Scenario inventory: `rg '^#### Scenario:' openspec/changes/confined-shell-friction/` (4 scenarios, `sandbox-runner-bash`). The network drive of #547 cannot be made on the CI or the development machine: the line is fed to the filter as PowerShell 5.1 wrote it on the reporter's machine (code page 437), and written first by a command under MXC's real executor.

| Scenario | Status | Evidence |
| --- | --- | --- |
| TheDriveLineIsNotShown | covered | `server/test/confinedShellFriction.test.ts`, "is dropped before the command's output, which passes whole": the code-page-437 line, then the command's lines — only the latter come out. "is dropped when it arrives in pieces, and twice (two drives)"; "a command that prints the word later keeps its line: only the start is looked at"; "a last line without its newline is not lost …". Under MXC's real executor: "the drive line, written first by the command itself, is not shown; the rest is". |
| TheAgentIsToldBackgroundProcessesEnd | covered | `server/test/confinedShellFriction.test.ts`, "says background processes end with their command; …": the confined shell tool's guidelines carry the sentence; "an unconfined shell is not told so". |
| TheAgentIsToldThereIsNoWmi | covered | The same test: on Windows with MXC the guidelines say `Get-CimInstance` fails and name `ComputerInfo().AvailablePhysicalMemory`; elsewhere they say nothing of WMI. |
| AWalDatabaseUnderAReadGrantSaysWhatToDo | covered | `server/test/confinedShellFriction.test.ts`, under MXC's real executor, "a WAL database under a read grant: …": a WAL database outside the root, its folder granted read-only, opened with `mode=ro` — SQLite's `unable to open database file`, then the note; a database opened with no read grant fails the same and gets no note. |
