# Proposal

## Why

The agent's `bash` is the one tool pi-outpost cannot path-check. With `allowBash` on, pi-outpost's own
`bash` runs with every right of the server's user, and the only way to confine it is to hand the name to
a sandboxing extension (`sandbox.bashFrom`, pi-landstrip). On Windows that road is closed:
pi-landstrip's AppContainer refuses `NUL`, so git and every `2>/dev/null` fail, Git Bash cannot start,
and pi-landstrip needs an upstream launcher fix to run at all
(`docs/investigations/windows-sandboxing.md`).

The confined terminal already runs a shell under a sandbox runner with a policy derived from the
workspace's sandbox, and on Windows 11 MXC's tier 1 (`wxc-exec.exe`) confines a shell where landstrip
cannot: `NUL`, native git and busybox work, reads and writes stop at the root, in about 0.1 s per launch.
The agent's `bash` can run each command the same way, with no extension in between.

## What Changes

- New optional `sandbox.bashRunner`: the path of a sandbox runner, MXC's executor or landstrip's. While
  `allowBash` is on, pi-outpost's own `bash` runs every command inside it, with the same policy as a
  confined terminal: read the root (and, under MXC, the root's drive minus everything beside the path down
  to the root), write the writable zone, never the agent directory nor the configuration.
- New optional `sandbox.bashShell`: the shell those commands run in. Default `/bin/bash`; on Windows it
  must be named, since Git Bash cannot start in a sandbox (busybox-w32's `sh.exe` is the one that works).
- A confined command receives the minimal environment of a confined terminal, never the server's keys.
- When the runner is missing or fails its self-check, `bash` stays registered and every call is refused
  with the reason. It never falls back to running unconfined.
- `bashRunner` and `bashFrom` are exclusive: naming both is refused when the configuration loads.
- Without `bashRunner`, nothing changes.

## Capabilities

### New Capabilities

- `sandbox-runner-bash`: the agent's `bash` confined by a sandbox runner named in the configuration.

### Modified Capabilities

None. `sandbox-delegated-bash` is unchanged; the two are alternatives.

## Impact

- **Server**: `server/src/config.ts` (`sandbox.bashRunner`, `sandbox.bashShell`, exclusive with `bashFrom`),
  new `server/src/confinedBash.ts` (bash operations through the runner), `server/src/sandbox.ts` (pi's
  `bash` built with those operations), `server/src/index.ts` (self-check at start, settings carry the
  fields over).
- **Shared policy**: reuses `terminalPolicy`, `mxcTerminalConfig`, `siblingsToDeny`, `confinedEnvironment`
  and `checkRunner` from `server/src/terminalSandbox.ts` (the `confined-terminal` change).
- **Documentation**: `docs/sandboxing.md` (a third way to confine `bash`, the Windows 11 recipe).
- **Tests**: unit tests with a fake runner; a real test through MXC on Windows where `MXC_EXEC` is set; a
  running-app check that the agent's `bash` is the confined one.
- **Compatibility**: none broken; opt-in.
