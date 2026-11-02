## Decisions

### Decided by the tools the agent has, not by the configuration

The lock qualifies the agent's shell, so it is shown only when there is one: the runtime's snapshot lists the
active tools, and a `bash` tool among them is the shell. With `"sandbox": false` the configuration alone cannot
tell — a `tools` allowlist may leave `bash` out.

### Not confined *by pi-outpost*

An extension can register its own `bash`; pi-outpost cannot see whether that one confines anything. The
description therefore says what pi-outpost knows: the sandbox is off, pi-outpost does not confine the shell,
and, unless an extension does, a command runs with the server account's rights.

### `config --confine` restores the sandbox, and says what that changes

`config --confine` used to refuse `"sandbox": false`, because turning the sandbox back on also scopes the
file tools. It now restores the default sandbox — the same section `init` writes, without `root`, so it
follows the working directory as the implicit default does — after the same self-check and canary, and
prints that the file tools are limited to the project from now on. A command named "confine" that
confines the agent, files included, stays within its name; a separate command would be one more to know.
Under `rpc` it still refuses: a sandbox cannot be enforced for a child that builds its own tools.

The lock follows: neutral where this machine's runner fails its self-check, highlighted with the command
where it passes — the same check, cached, as for an unconfined shell inside a sandbox. Its description says
the file tools would be scoped too, so the suggestion does not hide its cost.

### Not under `rpc`

The RPC child runs its own shell, possibly in a container or as another user — the configuration refusal for
a sandbox under `rpc` says exactly that. Showing it "not confined" would be a claim pi-outpost cannot make.
