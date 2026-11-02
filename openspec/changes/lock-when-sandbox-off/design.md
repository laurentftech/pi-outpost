## Decisions

### Decided by the tools the agent has, not by the configuration

The lock qualifies the agent's shell, so it is shown only when there is one: the runtime's snapshot lists the
active tools, and a `bash` tool among them is the shell. With `"sandbox": false` the configuration alone cannot
tell — a `tools` allowlist may leave `bash` out.

### Not confined *by pi-outpost*

An extension can register its own `bash`; pi-outpost cannot see whether that one confines anything. The
description therefore says what pi-outpost knows: the sandbox is off, pi-outpost does not confine the shell,
and, unless an extension does, a command runs with the server account's rights.

### No suggestion

The unconfined lock elsewhere suggests `pi-outpost config --confine`; that command refuses a turned-off
sandbox, since restoring it also scopes the file tools. The lock is neutral and suggests nothing.

### Not under `rpc`

The RPC child runs its own shell, possibly in a container or as another user — the configuration refusal for
a sandbox under `rpc` says exactly that. Showing it "not confined" would be a claim pi-outpost cannot make.
