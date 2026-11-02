## Why

With `"sandbox": false` the agent's shell runs with every right of the server's account, and the interface
says nothing: the shell's lock is shown only when pi-outpost has a sandbox to judge. An unconfined shell
chosen with `"bashRunner": "none"` gets an open lock, while the same shell with the whole sandbox turned off
looks like no shell at all.

## What Changes

- With `"sandbox": false` and a `bash` tool active, the shell's lock is shown **open**, saying the sandbox is
  turned off and that pi-outpost does not confine the shell. Where this machine's runner passes its
  self-check, it is highlighted and offers `pi-outpost config --confine`, saying that this also scopes the
  file tools.
- **`pi-outpost config --confine` restores a turned-off sandbox**: after the self-check and the canary, it
  replaces `"sandbox": false` with the default sandbox and says the file tools are now limited to the project.
  It still refuses under `rpc`.
- With no `bash` tool active (a `tools` allowlist without it), still no lock: there is no shell to qualify.
- Under the `rpc` runtime, still no lock: the shell is the child's, which may be confined by other means
  pi-outpost cannot see.

## Capabilities

### Modified Capabilities

- `sandbox-defaults`: a turned-off sandbox shows the shell's lock open, and `config --confine` restores it.
- `sandbox-runner-bash`: the lock is said not to judge an RPC child's shell.

## Impact

`shared/src/protocol.ts` (`sandboxOff` on the unconfined verdict), `server/src/index.ts` (`confinementOf`),
`ui/src/components/ConfinementLock.tsx` (the description), `server/src/confineCommand.ts`, the CLI help,
`scripts/mxc-macos/test.sh` (runs the command's tests where `"auto"` has a runner).
