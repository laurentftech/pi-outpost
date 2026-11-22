## Why

A confined command may write anywhere in its root, the repository's metadata included: `.git/config`, `.git/hooks/`, `.git/info/attributes`. Git runs commands that metadata names — on a status, a diff, a commit — and not only in pi-outpost: the user's editor, shell prompt or terminal run git in the same repository, unconfined. pi-outpost's own git no longer runs what a repository's configuration names (GHSA-6w2r-6jpf-5ccr); the user's tools still would.

Codex closes this at the sandbox: in its default mode `.git` (and `.codex`) are read-only to the agent, hooks included. Its agent then cannot commit without an escalation. pi-outpost has what Codex lacks for that cost: grants, asked of the user per command.

## What Changes

- **`.git` is read-only to a confined command**, under every runner, by default: reading, `git status`, `git diff`, `git log` work as before; writing the repository's metadata is refused by the runner.
- **A command that writes `.git` asks the user**, through the grant the agent already has (`run_with_grant`): `git commit`, `git checkout -b`, `git config` name `.git` for write, and the user approves it once or for the session, as any directory grant. The prompt says that a grant on `.git` lets the command change what git will run.
- **Where a repository is a worktree or a submodule**, `.git` is a file naming a directory elsewhere: the file is read-only, and its directory is outside the root already.
- **`sandbox.gitWritable: true`** returns to today's behaviour for those who want it, said in the docs with what it costs.
- The confinement canary checks it: a command trying to write `<root>/.git/config` must be refused, or the shell is not shown as confined.

## Capabilities

### Modified Capabilities

- `sandbox-defaults`: `.git` read-only by default.
- `sandbox-approved-grants`: a grant on `.git` is a directory grant like any, with its own warning.

## Impact

Every runner's policy (`server/src/terminalSandbox.ts`: MXC on Windows, Linux and macOS, landstrip, Seatbelt), the canary (`confinementCanary.ts`), the grant prompt, `docs/sandboxing.md`. The agent's routine commit gains one question per session; nothing changes outside a git repository.

## Measured

Every runner holds a read-only `.git` inside the writable root when it exists (design.md has the table). Held only where it exists, as a missing one stops MXC on Linux.
