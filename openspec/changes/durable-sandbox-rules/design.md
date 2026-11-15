# Design

## Context

Three sources already know what a confined command was refused, each in its own shape:

| Source | What it knows | When |
|---|---|---|
| MXC on Windows (`processContainer.captureDenials`, contract `1.0.0`) | files, capabilities, UI, network | a JSON report after the command |
| MXC on macOS (`seatbelt.captureDenials`, contract `1.1.0-alpha`) | files, network, Mach services | a JSON report after the command |
| landstrip | one JSON line per refusal | on stderr, as it happens |
| the egress proxy | hosts it refused | as it happens |
| MXC on Linux (Bubblewrap) | nothing for files | — |

Grants today (`sandbox-approved-grants`): a host question when a command connects to an unlisted host, a directory request by the agent's tool, each for one command or one session, and a list of targets nobody can grant.

## Decisions

### One record, whatever the source

Each source is translated to the same record — kind (`directory` or `host`), target, access (`read` or `write` for a directory), the command — and anything a rule could not express (a Mach service, a Windows capability, a UI access) is recorded as informational only: shown, never offered as a rule. A file refusal is recorded against its directory, since that is what a grant and a rule widen.

### Rules are about resources, not commands

A rule names a directory with an access, or a host pattern as `sandbox.allowedHosts` writes them. It applies to every command of the project's confined shell. "Always allow this command" is not offered: a command line is trivially varied, and what confinement protects is the resource.

### Per project, held by the server, outside every sandbox

Rules are kept per project root in the server's own state directory, beside its other per-project state, never in the project tree and never in the configuration file: the first would let a confined command rewrite its own rules, the second belongs to the operator. The store is added to what can never be granted. *To confirm with the maintainer: per project rather than server-wide.*

### Order of consultation

For a host or a directory request: the never-grantable list first, then an always-refuse rule, then an always-allow rule, then a session grant, then the question. An always-allow directory rule is applied when a command starts, without the agent asking; an always-allow host rule answers the proxy's question.

### `sandbox.grants: "never"` switches rules off

Where the operator forbids grants, no rule is created and none is applied: a rule is a grant that lasts.

### Recording never loosens

MXC's capture is asked for in `block` mode only. Its `allow` mode lets through what the policy refuses in order to record it, which with an agent at the keyboard is the sandbox switched off.

## Risks / Trade-offs

- The macOS report needs a contract upstream calls development: it can change. The macOS path is isolated behind the same translation, and its absence degrades to "this runner reports nothing".
- The Windows report costs something per command (an ETW trace decoded after the run): unmeasured. If it is heavy, recording becomes opt-in per session rather than always on.
- An always-allow rule is a standing widening of the sandbox. The interface lists rules where the sandbox's state is shown, and a rule is revoked in one click.
- Linux under MXC records hosts only; the interface says that filesystem refusals are not reported there, rather than showing an empty list that reads as "nothing was refused".
