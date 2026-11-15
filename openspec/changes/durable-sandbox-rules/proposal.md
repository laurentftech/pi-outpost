# Proposal

## Why

A grant lasts one command or one session. A user who allows the same directory or the same host every morning is asked every morning, and there is no way to say "never" either: a refused host is asked about again on the next command. And under MXC the agent is told nothing about what the sandbox refused — it sees the program's own "Operation not permitted" and has to guess which path to ask for.

`@microsoft/mxc-sdk` 1.1.0 (#500) can report what a confined command was refused (`captureDenials`), on Windows with the request contract pi-outpost already sends, and on macOS with a development contract. landstrip already reports its refusals, and the egress proxy knows the hosts it refused. Background and sources: `research.md`.

## What Changes

- Refusals are recorded per project: the resource, the access, the command that met it.
- A confined command's output ends by naming what the sandbox refused it, on every runner that can tell.
- From a recorded refusal, or from a question as it is asked, the user can make a rule: always allow, always refuse, or ask. Rules last across sessions and restarts, per project.
- Rules are listed and revoked in the interface.
- Recording never relaxes confinement: MXC's capture runs in its `block` mode only.
- MXC runs in process through its SDK, as Microsoft recommends, for the agent's shell, the terminal and the self-check, on Windows, Linux and macOS: no executor (`wxc-exec.exe`, `lxc-exec`, `mxc-exec-mac`) runs any more. The standalone executable carries the SDK's native parts beside it. pi-outpost needs Node.js 24.21 or 26.8, the SDK's floor for native stdio on Windows.

## Capabilities

### New Capabilities
- `sandbox-durable-rules`: recording refusals, telling the agent, and the user's durable rules.

### Modified Capabilities
- `sandbox-runner-bash`: `"mxc"` names MXC run in process through its SDK, on every platform; a path to one of its executors is read as `"mxc"`.
- `terminal`: a terminal confined by MXC runs through the SDK's pseudo-terminal.
- `standalone-executable`: the executable carries MXC's native parts beside it, and runs MXC in process.
- `sandbox-approved-grants` is unchanged: rules are consulted before its questions.

## Impact

- `server/src/terminalSandbox.ts`, `server/src/confinedBash.ts`: ask MXC for the denial report, read it, end the output with what was refused.
- `server/src/sandboxGrants.ts`, `server/src/egressProxy.ts`: consult rules before asking; apply always-allow entries to a command's policy.
- A rules store in the server's own state, outside every sandbox root.
- `shared/src/protocol.ts`, `ui/`: recorded refusals, rules, and the "always" answers of the existing dialogs.
- `server/src/mxcExecutor.ts`, `terminalSandbox.ts`, `terminalManager.ts`, `confinedBash.ts`: MXC through `@microsoft/mxc-sdk/v1` (`spawn`, `spawnWithPty`, `probe`) in place of the executors.
- `server/src/buildExe.ts`, `server/scripts/build-sea.mjs`: `koffi`, its platform package and `mxc_ffi` beside the executable.
- `package.json` engines, CI's Node.js versions.
- `docs/sandboxing.md`, `docs/configuration.md`, the standalone executable's guide.

## Unverified

Everything about MXC's report comes from its documentation and types: nothing was run on Windows 11 or on an Apple silicon Mac. The first task is that verification, on Windows 11; the design is to be corrected by what it shows.
