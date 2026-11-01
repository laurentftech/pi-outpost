# Proposal

## Why

A confined shell is all or nothing today. When a command needs one thing the policy refuses, such as a
host that `sandbox.allowedHosts` does not list or a directory beside the root, the only way through is
to edit the configuration or the project's Settings. That widens the sandbox for every later command,
often for good, to unblock one. The agent already ends a refused command with "Ask the user to add it
there", and the usual answer is a broader allowlist than anyone wanted. Claude Code and Codex solve
this with a narrow, user-approved escalation. pi-outpost can do the same: every confined command
starts its own runner with its own policy, so one launch can carry a grant that no other launch sees.

## What Changes

- **Hosts are asked about when a command connects.** Under `sandbox.allowedHosts`, each command of the
  agent's shell gets a proxy of its own. A connection to a host the list does not name waits there
  while the user is asked, with the host and the running command in front of them. The agent plays no
  part, so a question exists only once a command has really connected. This is how Codex CLI, which
  also runs on MXC, approves network access.
- **Directories are asked for by the agent.** A file access cannot wait the way a connection does, so
  the agent's confined shell gets a companion tool. With it, the agent asks to run **one command** with
  one or more directories (read or read-write) beyond the sandbox, and a reason.
- **The user answers in the interface:** allow for this command, allow for this session, or refuse.
  Only a click in the interface grants. Nothing the model writes does, and no answer means refused.
  A grant for one command reaches that command alone; a directory grant is bound to the exact command
  text. A session grant applies to every later command of that session, until the session ends or is
  replaced, the sandbox settings change, or the server restarts. It is never written to the
  configuration. A grant widens the sandbox and never takes a command out of it.
- **Some targets can never be granted**, whatever the user clicks: the agent directory, the
  configuration file, anything holding or inside them, a `.pi` directory, a drive's root, the home
  directory itself, and, for hosts, IP literals and loopback names. They are refused before anyone is
  asked.
- **Every grant is audited.** The server logs it, and the command's result records it: the grant it
  ran with, or the user's answer about each host it connected to. While session grants are active, the
  confinement badge says so and lists them; the verdict itself is unchanged.
- **The operator can turn the mechanism off** (`sandbox.grants: "never"`). Then nobody is asked, and the
  list alone decides, as before. With no interface connected to answer, a request is refused at once,
  with the reason.
- **Out of scope:** the terminal panel (the user types those commands), the file tools (`edit`, `write`:
  path checks, not a runner), bash handed to an extension (`bashFrom`), and WSLC-confined bash, where
  mounts are fixed when the container starts and a directory grant is refused with that reason. Hosts
  are asked about only on MXC Windows until the other runners are shown to keep a command off other
  commands' proxies.

## Capabilities

### New Capabilities
- `sandbox-approved-grants`: user-approved, narrowly scoped grants of hosts and directories to the
  agent's confined shell. Covers how they are requested, approved, bounded, applied by each runner,
  forbidden, audited and shown.

### Modified Capabilities
- `sandbox-runner-bash`: an unlisted host is refused unless the user, asked on connection, allows it
  (`AnUnnamedHostIsRefusedAndNothingBypassesTheProxy`); a confined PowerShell command gives back all of
  its output (`AConfinedPowerShellCommandRunsAsAScript`).

## Impact

- **Server**: `server/src/confinedBash.ts` (a per-launch grant added to the policy inputs, and the
  refusal note), `server/src/terminalSandbox.ts` (`terminalPolicy`, `mxcTerminalConfig` with its
  sibling deny list, `mxcPosixConfig`, `seatbeltPolicy`: additional read and read-write directories),
  `server/src/egressProxy.ts` (the hosts of a grant, without widening the shared per-list proxy for
  other sessions), `server/src/sandbox.ts` (registering the tool beside `bash`/`powershell`),
  `server/src/index.ts` (the approval round trip, session grant state, snapshot), and
  `server/src/config.ts` (`sandbox.grants`).
- **Protocol**: `shared/src/protocol.ts` gets a grant request sent to clients, its answer, and the
  active session grants in the snapshot.
- **UI**: an approval dialog showing the command, the grant and the reason; the confinement badge in
  `ui/src/components/ConfinementLock.tsx` and `ModelBar.tsx`.
- **Docs**: `docs/sandboxing.md`, README's sandboxing summary, and the config reference.
- **Related work**: `multi-user-local-accounts` (in progress) will need to decide who may approve; this
  change lets any client of the workspace answer.
