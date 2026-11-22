# Design

## Context

Each runner is given a policy built in `server/src/terminalSandbox.ts`: a writable root (`allowWrite`, `readwritePaths`), read-only paths, denied paths. Grants add directories for one command or the session (`sandbox-approved-grants`), and the user's durable rules make them last (`durable-sandbox-rules`). Today nothing inside the writable root is held read-only; the POSIX MXC builders even drop a read-only path that lies under a writable one.

## Decisions

### Read-only by the runner, not by pi-outpost's tools

The file tools already refuse `.pi`; `.git` joins them there, but the boundary that matters is the runner's: a shell command is what writes `.git` in practice.

### Per runner, by what it can express

| Runner | Read-only `.git` inside the writable root |
| --- | --- |
| Seatbelt, MXC on macOS | a `deny file-write*` subpath after the root's allow (SBPL: the last matching rule wins) — to verify for MXC's generated profile |
| Bubblewrap (MXC on Linux), landstrip | a read-only bind of `<root>/.git` after the root's read-write bind; landstrip: a deny-write rule if it has one, else the same bind |
| MXC on Windows | an ACL-based policy: to probe whether `readonlyPaths` under a `readwritePaths` entry holds |

A runner that cannot hold it says so at its check, and the shell keeps today's behaviour with a line in the startup log and the lock's tooltip — never a silent difference.

### A `.git` that appears during the session

A path that does not exist cannot be bound read-only. The policy is built per command, so a `.git` created by one command (`git init`) is read-only from the next. The first command, the one that creates it, is the agent's own `git init`, which writes nothing git will run later that a user did not ask for.

### The commit asks

`git commit` writes `.git`: refused, the agent sees the refusal and the existing note that it may ask with `run_with_grant`. The grant names `<root>/.git` for write; the dialog adds one sentence for it: "A command with this grant can change what git runs (hooks, configuration) — for you too, later." "For this session" covers a working session's commits; an always rule is offered as for any directory, so a user who commits often decides once.

### Escape

`sandbox.gitWritable: true` (file only, never from Settings, like `bashRunner`) restores today's writable `.git`.

## Risks

- One more question in the commonest workflow. Mitigated by the session grant and the always rule.
- Tools that write under `.git` for caching (`git status` with `core.untrackedCache`, `index` refresh) fail quietly when read-only: `GIT_OPTIONAL_LOCKS=0` in the confined environment keeps a status from trying.
