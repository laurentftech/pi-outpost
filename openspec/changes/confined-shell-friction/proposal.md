## Why

Issue #547, measured under MXC on Windows with 0.64.0:

1. On a machine with a mapped network drive, every command's output began with PowerShell's `La tentative d'exécution de l'opération InitializeDefaultDrives sur le fournisseur FileSystem a échoué`, garbled. PowerShell initialises every drive of the session as it starts; the container does not reach the network share, and the host prints the error before the command runs — before pi-outpost switches the output to UTF-8. The command itself runs.
2. A process started in the background (`Start-Process`, `Start-Job`, `&`) runs while its command does and ends with it: each command runs in a container of its own. Nothing said so.
3. `Get-CimInstance` fails (no WMI in the container), `Get-Process` sees the container's processes only; the free memory is readable through .NET.
4. A SQLite database in WAL mode, in a folder granted read-only, fails to open (`unable to open database file`): reading it writes its `-wal` and `-shm`. `immutable=1` works under the read grant; a write grant works.

## What Changes

- A confined PowerShell's output is held line by line at its start, and PowerShell's `InitializeDefaultDrives` line dropped there; the first other line lets everything pass as it comes.
- The confined shell tool's guidelines say background processes end with their command (keep a server in one command with a timeout, or the terminal), and under MXC on Windows that WMI is out and how to read the free memory.
- After a command whose SQLite could not open a database while a folder was granted read-only, a note names `?immutable=1` and a write grant.

## Capabilities

### Modified Capabilities

- `sandbox-runner-bash`: adds `PowerShellsDriveLineIsNotShown`, `TheAgentIsToldWhatItsSandboxEnds`, `AWalDatabaseUnderAReadGrantSaysWhatToDo`.

## Impact

`server/src/confinedBash.ts`, `server/src/sandbox.ts`, `docs/sandboxing.md`. Not in scope: opening WMI (it would widen the sandbox a great deal); granting `-wal`/`-shm` for write on a read grant (a later step if the note is not enough); MXC exposing a drive it does not reach (to be raised upstream).
