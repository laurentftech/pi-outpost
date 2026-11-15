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

## Capabilities

### New Capabilities
- `sandbox-durable-rules`: recording refusals, telling the agent, and the user's durable rules.

### Modified Capabilities
- None. `sandbox-approved-grants` keeps its one-command and one-session grants as they are; rules are consulted before its questions.

## Impact

- `server/src/terminalSandbox.ts`, `server/src/confinedBash.ts`: ask MXC for the denial report, read it, end the output with what was refused.
- `server/src/sandboxGrants.ts`, `server/src/egressProxy.ts`: consult rules before asking; apply always-allow entries to a command's policy.
- A rules store in the server's own state, outside every sandbox root.
- `shared/src/protocol.ts`, `ui/`: recorded refusals, rules, and the "always" answers of the existing dialogs.
- `docs/sandboxing.md`.

## Unverified

Everything about MXC's report comes from its documentation and types: nothing was run on Windows 11 or on an Apple silicon Mac. The first task is that verification, on Windows 11; the design is to be corrected by what it shows.
