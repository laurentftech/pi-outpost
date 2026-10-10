# Proposal

## Why

The web terminal is the one part of pi-outpost that ignores the sandbox: once enabled, it is a shell
with every right of the server's operating-system user. It can read outside `sandbox.root`, write outside
the writable zone, and read the agent directory where provider keys live, as well as the keys in its own
environment. That is acceptable on one's own laptop, but not for a widget embedded in someone else's page,
a locked-down office deployment, or the multi-user server planned in `multi-user-local-accounts`.
landstrip, already the agent's `bash` sandbox through `pi-landstrip`, confines processes with
Landlock + seccomp. A container test showed that it runs under Docker's default security profile, keeps
an interactive shell working, and refuses reads outside an allowed tree, `/proc/<pid>/root` escapes and
signals to the server.

## What Changes

- New optional `terminal.sandbox`, the path of a landstrip runner. When set, every terminal runs inside
  it, with a policy derived from the workspace's sandbox:
  - read: the sandbox root (the project root when no sandbox is configured), the system directories,
    and a private temporary directory;
  - write: the writable zone and that temporary directory;
  - never: the agent directory, the configuration file, and the user's home outside the root.
- A confined terminal receives a minimal environment (path, locale, terminal type, a home inside the
  root), never the server's provider keys.
- When the runner is configured but missing or fails its self-check, the terminal is unavailable, with
  the reason shown. It never falls back to an unconfined shell, and the rest of the server keeps
  working.
- Moving the agent to the terminal's directory ("Sync") stays bound by the same project and sandbox
  rules and locks as the directory picker, so a confined terminal widens nothing.
- Without `terminal.sandbox`, nothing changes.
- Linux (including WSL) is the supported platform for confinement. On Windows reads and writes are
  confined as well, but landstrip's AppContainer cannot start programs that load `user32.dll` (git,
  PowerShell, most tools), so the terminal is little more than `cmd`: use WSL there. macOS is untested;
  a runner that fails its self-check disables the terminal, as above.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal`: adds the confined mode — running under a sandbox runner, the derived policy, the minimal
  environment, refusing rather than falling back when the runner is unusable, and Sync staying within
  the existing rules.

## Impact

- **Server**: `server/src/config.ts` (`terminal.sandbox`, validated path),
  `server/src/terminalManager.ts` (spawn through the runner with a generated policy file and a minimal
  environment; self-check once at start), `server/src/index.ts` (reporting terminal availability and
  its reason in the snapshot).
- **UI**: the terminal panel shows why the terminal is unavailable, and marks a confined terminal as
  such.
- **Dependency**: landstrip's runner binary (`@landstrip/landstrip-<platform>`), not bundled; the
  deployment installs it and points `terminal.sandbox` at it. Documented next to the `pi-landstrip`
  agent-bash setup in `docs/sandboxing.md`.
- **Tests**: a Linux container test that drives a real confined PTY. CI runs it on the Linux job only.
- **Compatibility**: none broken; opt-in.
- **Follow-on**: `multi-user-local-accounts` makes this mode mandatory in multi-user deployments, with
  a policy per account.
