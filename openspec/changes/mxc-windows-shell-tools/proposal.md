# Proposal

## Why

Under MXC on Windows, the agent's confined shell could not run two kinds of programs that work outside
it. A tool installed for the user — Python in `AppData\Local\Programs`, `uv`, WindowsApps aliases — was
not found, though its folder is on `PATH`: the policy reopens only the drive, the root and the shell's
folder, and the profile is denied. The agent told the user Python was not installed. And
`sandbox.bashShell: "pwsh.exe"`, a bare name as the docs suggest, started no command at all (#391): the
configuration resolved it against its own folder, and the runner looks nothing up.

## What Changes

- Under MXC on Windows, every folder the shell's `PATH` names is readable to a confined command (the
  agent's shell and the confined terminal), so a program found on `PATH` runs. A folder that is or
  holds the home directory, or holds the agent directory or the configuration, is left out, and a
  drive's root as before: those would undo the sandbox. The agent directory and the configuration stay
  denied.
- A bare `sandbox.bashShell` is looked up on `PATH` when the configuration loads, `PATHEXT` included on
  Windows. One that is not on `PATH` stops startup, naming it, instead of failing every command. A path
  is resolved against the configuration's folder, as before.
- Out of scope: the Python launcher `py.exe` still finds no interpreter, since it reads the registry and
  `…\Programs\Python` itself, neither of which is on `PATH`. `python` runs.

## Capabilities

### New Capabilities

### Modified Capabilities
- `sandbox-runner-bash`: a confined command may read the folders of its `PATH` under MXC on Windows
  (`AConfinedCommandGetsAMinimalEnvironment` is unchanged; a new requirement is added), and a bare
  `bashShell` is found on `PATH`.

## Impact

- `server/src/terminalSandbox.ts`: `mxcTerminalConfig` and `readableSearchEntries`.
- `server/src/confinedBash.ts`, `server/src/confinementStatus.ts`: pass the search path and the home
  directory.
- `server/src/config.ts`: `resolveShell`.
- `docs/sandboxing.md`, `README.md`: the Windows limits and the `bashShell` row.
