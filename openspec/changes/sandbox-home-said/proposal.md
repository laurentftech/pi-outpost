## Why

Issue #549, point 5. In a confined command `HOME` is the project, and on Windows `USERPROFILE`, `TEMP` and `LOCALAPPDATA` are the command's own throwaway folders and `APPDATA` the sandbox's cache. That isolation is intended. But nothing told the agent: a `~/projet.log` named by a document was looked for in the project, and the agent could not tell the user's data from the sandbox's. Measured under MXC: the user's file is refused without a grant, and read with a read grant on that file.

## What Changes

- Every confined command and terminal gets `PI_OUTPOST_USER_HOME`, the user's own home (not under WSLC, whose container holds no folder of the user's). It is a path, not an access.
- The confined shell tool's guidelines say `HOME` is the project (and on Windows what the other folders are), name the user's home, and say a `~` path from the user or a document is read there, with `run_with_grant`.

## Capabilities

### Modified Capabilities

- `sandbox-runner-bash`: adds `TheAgentIsToldWhereTheUsersHomeIs`.

## Impact

`server/src/terminalSandbox.ts`, `server/src/confinedBash.ts`, `server/src/sandbox.ts`, `docs/sandboxing.md`. The isolation does not change.
