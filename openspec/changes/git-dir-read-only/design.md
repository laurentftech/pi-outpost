# Design

## Context

Each runner is given a policy built in `server/src/terminalSandbox.ts`: a writable root (`allowWrite`, `readwritePaths`), read-only paths, denied paths. Grants add directories for one command or the session (`sandbox-approved-grants`), and the user's durable rules make them last (`durable-sandbox-rules`). Today nothing inside the writable root is held read-only; the POSIX MXC builders even drop a read-only path that lies under a writable one.

## Decisions

### Read-only by the runner, not by pi-outpost's tools

The file tools already refuse `.pi`; `.git` joins them there, but the boundary that matters is the runner's: a shell command is what writes `.git` in practice.

### Per runner: measured, before any code

A read-only `.git` inside a read-write root, through each runner's real executor (MXC on Windows locally;
MXC on Linux, MXC on macOS, Seatbelt and landstrip in CI), every outcome read back from the disk:

| | MXC Windows | MXC Linux | MXC macOS | Seatbelt | landstrip |
| --- | --- | --- | --- | --- | --- |
| write in the root | yes | yes | yes | yes | yes |
| write `.git/config`, create a hook | refused | refused | refused | refused | refused (`denyWrite`) |
| read and list `.git` | yes | yes | yes | yes | yes |
| `git status` | works | works | works | works | works |
| `git commit` | refused | refused | refused | refused | refused |
| a read-only path **absent** when the command starts | created and written | **the command does not start** (`bwrap: Can't find source path`) | refused | refused | refused |

Each runner is given it in its own words: MXC `readonlyPaths` (the POSIX builders no longer drop a
read-only path under a writable one when it is held on purpose), Seatbelt a `deny file-write*` after
the allows, landstrip `denyWrite`.

### Held only where it exists

The last row decides it: a `.git` named before it exists would stop every command under MXC on Linux in
a folder that is no repository, and refuse the agent's own `git init` under macOS and landstrip. So it
is held only when it exists, the same on every runner: the command that creates it — the agent's
`git init` — writes it, and the next command finds it held.

### Only the root's `.git`

Repositories nested in the project (another `.git` below the root) are not held: the agent's commands
may write them. pi-outpost's own git runs nothing their configuration names (GHSA-6w2r-6jpf-5ccr).

### The agent's shell only

A terminal is the user's own hand: its commits are not asked about.

### The commit asks

`git commit` writes `.git`: refused, the agent sees the refusal and the existing note that it may ask with `run_with_grant`. The grant names `<root>/.git` for write; the dialog adds one sentence for it: "A command with this grant can change what git runs (hooks, configuration) — for you too, later." "For this session" covers a working session's commits; an always rule is offered as for any directory, so a user who commits often decides once.

### Escape

`sandbox.gitWritable: true` (file only, never from Settings, like `bashRunner`) restores today's writable `.git`.

## Risks

- One more question in the commonest workflow. Mitigated by the session grant and the always rule.
- Tools that write under `.git` for caching (`git status` with `core.untrackedCache`, `index` refresh) fail quietly when read-only: `GIT_OPTIONAL_LOCKS=0` in the confined environment keeps a status from trying.
