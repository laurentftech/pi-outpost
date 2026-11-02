## Why

With `"sandbox": false` the agent's shell runs with every right of the server's account, and the interface
says nothing: the shell's lock is shown only when pi-outpost has a sandbox to judge. An unconfined shell
chosen with `"bashRunner": "none"` gets an open lock, while the same shell with the whole sandbox turned off
looks like no shell at all.

## What Changes

- With `"sandbox": false` and a `bash` tool active, the shell's lock is shown **open**, saying the sandbox is
  turned off and that pi-outpost does not confine the shell. It suggests no command: `pi-outpost config
  --confine` refuses a turned-off sandbox, because turning it back on also scopes the file tools.
- With no `bash` tool active (a `tools` allowlist without it), still no lock: there is no shell to qualify.
- Under the `rpc` runtime, still no lock: the shell is the child's, which may be confined by other means
  pi-outpost cannot see.

## Capabilities

### Modified Capabilities

- `sandbox-defaults`: a turned-off sandbox shows the shell's lock open.
- `sandbox-runner-bash`: the lock is said not to judge an RPC child's shell.

## Impact

`shared/src/protocol.ts` (`sandboxOff` on the unconfined verdict), `server/src/index.ts` (`confinementOf`),
`ui/src/components/ConfinementLock.tsx` (the description).
