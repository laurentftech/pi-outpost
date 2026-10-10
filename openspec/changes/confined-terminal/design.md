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
- Confinement on macOS (untested). On Windows it works, with known limits (see Risks).
- Network policy beyond allowing it: the terminal keeps network access, as the user's shell does today.
- Confining the agent's `bash` (that is `sandbox.bashFrom` with `pi-landstrip`, unchanged).
- Bundling landstrip.

## Decisions

### D1. Spawn the runner, not the shell

With `terminal.sandbox` set, the PTY spawns `<runner> run -p <policyFile> -- <shell> <args>`. node-pty
is unchanged, and the runner execs the shell, which inherits the PTY. Job control works because nothing
calls `setsid` in between (bubblewrap's `--new-session` did, and broke it).

### D2. The policy is a read allowlist, derived from the workspace's sandbox

`terminalPolicy({ root, writableRoot, allowWrite, agentDir, configFile, tmp, searchPath })` returns:
- `denyRead`: `/`, the agent directory and the configuration file. Denied by name, these stay
  unreadable even under an allowed tree; the test confirmed a nested deny holds;
- `allowRead`: the system trees (`/usr`, `/etc`, `/lib*`, `/bin`, `/sbin`, `/dev`, `/proc`, `/sys`,
  `/run/systemd/resolve`), the installations on the shell's `PATH` (`…/bin` brings its parent, so
  `/opt/node/bin` brings `/opt/node`), `root` and `tmp`;
- `allowWrite`: `writableRoot` (or `root` when writing is allowed and no writable zone is set), `tmp`,
  `/dev/null`, `/dev/tty` and `/dev/pts`;
- `network.allowNetwork`: true.

`root` is the sandbox root, or the project root without a sandbox. With `allowWrite: false`, only `tmp`
and the tty devices are writable. The policy is written `0600` into a per-terminal temporary
directory, which is removed when the terminal closes.

*Why `/` is denied:* the runner reads the whole host by default, and a denylist of known trees left
`/opt` and `/var` readable. Denying `/` and re-allowing what a shell needs made those unreadable, while
git, node, python and a login shell kept working in the container test.

**On Windows** (`windowsTerminalPolicy`) the same allowlist uses landstrip's Windows conventions:
- paths are written with `/`;
- every drive the policy names is denied as a whole (without one, the runner refuses the policy with
  `POLICY_UNRESTRICTED_READ`);
- `%SystemRoot%`, the `PATH` entries themselves, the root and `tmp` are allowed;
- `appContainerMode: "standard"`, because `lpac` refused git even when allowed.

The `PATH` entries are allowed as they are, not their whole installations: AppContainer grants access
to every allowed tree at each launch, and whole installations made a terminal take eleven seconds to
appear.

### D3. A minimal environment, built rather than filtered

The confined shell gets `PATH`, `LANG`/`LC_*`, `TERM`, `SHELL`, `HOME=<root>` and `TMPDIR=<tmp>`, and
nothing else from the server. On Windows it also gets the system's locations (`SystemRoot`,
`ProgramData`, `LOCALAPPDATA`, `ComSpec`, `PATHEXT`…), with `USERPROFILE`, `TEMP` and `TMP` pointing
into the root and `tmp`. Without `ProgramData` and `LOCALAPPDATA` the runner cannot create its
AppContainer. Filtering out "secret-looking" names would miss the next provider's
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

- [Windows: Git Bash cannot start in an AppContainer (MSYS2's global named objects), the root's parent
  stays listable, and the server must run in the interactive session (over SSH or as a service, the
  containers get no window station: `0xC0000142`)] → Documented. In an interactive session `cmd`,
  PowerShell, git and busybox run confined.
- [Windows: the agent's `bash` through `pi-landstrip` (not this change) does not work out of the box as
  of 0.19.11] → Measured in an interactive session: a read permission question for Git's `bash.exe`, then
  `os error 203` (its launcher lacks `LOCALAPPDATA` and `SystemRoot`), then Git Bash cannot start. With
  the launcher fix, busybox as pi's shell and a standard AppContainer it works and confines. Reported
  upstream; documented.

## Migration Plan

Opt-in: install landstrip's runner, set `terminal.sandbox` and restart. Removing the setting restores
today's terminal.
