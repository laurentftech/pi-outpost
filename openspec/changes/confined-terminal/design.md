# Design

## Context

See proposal.md for why. Today `TerminalManager` spawns `getDefaultShell()` directly with node-pty. Its
environment is the server's own, with `envOverrides` putting `PI_CODING_AGENT_DIR` back as the user
started it, and its working directory comes from the request. "Sync" in the panel calls `openProject`
(standalone) or `updateConfig({ sandbox: { root } })`. Both are server paths that already honour
`workspaceLock` and the sandbox locks.

landstrip 0.19.8 ships a runner per platform (`@landstrip/landstrip-<os>-<arch>`, binary
`bin/landstrip`):
- `landstrip doctor` prints `{"ok":true,"implementation":"landlock+seccomp"}` on a usable Linux host;
- `landstrip run -p <policy.json> -- <program…>` runs a program under a JSON policy
  (`filesystem.denyRead/allowRead/allowWrite/denyWrite`, `network.allowNetwork`).

The tests behind this design ran in a Linux container under Docker's default profile, with the server
as a non-root user:
- refused: reads outside the allowed tree, `/proc/<pid>/root` escapes, writes outside the writable
  paths, and killing a sibling process;
- working: an interactive bash in a PTY (with background jobs), git, node and python.

## Goals / Non-Goals

**Goals:**
- The terminal can never do more than the agent's sandbox allows.
- Failing closed: a misconfigured runner yields no terminal, never an unconfined one.
- Policy generation is a pure function, so it can be unit-tested on every platform even where the
  runner cannot run.

**Non-Goals:**
- Confinement on macOS and Windows. A runner may work there, but it is not tested or promised.
- Network policy beyond allowing it: the terminal keeps network access, as the user's shell does today.
- Confining the agent's `bash` (that is `sandbox.bashFrom` with `pi-landstrip`, unchanged).
- Bundling landstrip.

## Decisions

### D1. Spawn the runner, not the shell

With `terminal.sandbox` set, the PTY spawns `<runner> run -p <policyFile> -- <shell> <args>`. node-pty
is unchanged, and the runner execs the shell, which inherits the PTY. Job control works because nothing
calls `setsid` in between (bubblewrap's `--new-session` did, and broke it).

### D2. The policy is derived from the workspace's sandbox, generated per terminal

`terminalPolicy({ root, writableRoot, agentDir, configFile, home, tmp })` returns:
- `denyRead`: the agent directory, the configuration file, `/home`, `/root` and the parent of `root`;
- `allowRead`: `root` and `tmp`;
- `allowWrite`: `writableRoot` (or `root` when writing is allowed and no writable zone is set), `tmp`,
  `/dev/null`, `/dev/tty` and `/dev/pts`;
- `network.allowNetwork`: true.

`root` is the sandbox root, or the project root without a sandbox. With `allowWrite: false`, only `tmp`
and the tty devices are writable.

The function writes the policy to a `0600` file in a per-terminal temporary directory, removed when the
terminal closes.

*Why denyRead plus nested allowRead:* the runner's default reads the whole host (the test proved it).
Reading is narrowed only by denying broad trees and re-allowing the root inside them. The parent of the
root is denied so that sibling projects are not readable.

### D3. A minimal environment, built rather than filtered

The confined shell gets `PATH`, `LANG`/`LC_*`, `TERM`, `SHELL`, `HOME=<root>` and `TMPDIR=<tmp>`, and
nothing else from the server. Filtering out "secret-looking" names would miss the next provider's
variable; building the list cannot.

### D4. One self-check at start, reported in the snapshot

At start the server runs `<runner> doctor` (5 s timeout) and parses `ok`. The result, and the reason when
it fails, is kept and reported to clients as terminal availability. A terminal open request while it is
unavailable is answered with that reason. Re-checking happens only on restart: a runner that later
disappears makes the spawn fail, and that failure is reported the same way.

### D5. Sync needs no new check, only a test

Sync already goes through `open_project` / `update_config`, which enforce the locks. That is exactly what
the requirement asks, so the design adds a server test that drives Sync with a locked sandbox, rather
than a new code path.

## Risks / Trade-offs

- [`/proc/<pid>/environ` of the server stays readable from the sandbox: same user, no PID namespace] →
  The confined shell itself gets no secrets (D3). Keys in the *server's* environment remain readable,
  so the documentation says to store keys as credentials. Multi-user mode refuses keys in the
  environment outright.
- [The Landlock kernel requirement, ≥ 5.13 and enabled] → `doctor` at start, and a clear reason in the
  UI. The documentation gives the one-line check to run in the target container.
- [The runner's reads are denylist-based outside the root] → The policy denies every tree that holds
  secrets pi-outpost knows about. Secrets elsewhere on the host (e.g. `/etc/…` credentials) stay readable,
  as they are to the agent's `pi-landstrip` with `readAccess: "host"`; the documentation lists them.

## Migration Plan

Opt-in: install landstrip's runner, set `terminal.sandbox` and restart. Removing the setting restores
today's terminal.
