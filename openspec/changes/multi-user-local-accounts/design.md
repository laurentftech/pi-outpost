# Design

## Context

See proposal.md for why. The relevant state of the server today:

- **Projects are already isolated from each other.** Each project is a `Workspace` in a
  `WorkspaceRegistry` keyed by root (or side-session id). It has its own runtime, sandbox, watcher, git
  repositories and work plan. `clients: Map<WebSocket, Workspace>` binds a socket to one workspace.
  `broadcast(workspace, …)` reaches only that workspace's sockets. `sweepIdleWorkspaces` retires idle
  projects, but never the default one.
- **Identity is a single shared secret.** `tokenValid()` guards the WebSocket (`?token=`), `/branding`
  and `/files/docx-template` (Bearer) and `/files/raw` (Bearer or `?token=`). The UI has a token screen,
  shown on close code 4401. `@fastify/rate-limit` is already registered.
- **Some state is server-wide.** `config.openProjects` (persisted through the editable settings), the
  agent directory holding `auth.json` (provider keys), installed pi packages, and seven
  `broadcastServerWide` messages (activity, update, restart, errors).
- **Some operations reach beyond a project.** `browse_server_directory` walks the whole host.
  `open_native` / `reveal_native` launch applications on the server's desktop. The terminal and an
  undelegated `bash` run as the server's OS user (both off by default).

## Goals / Non-Goals

**Goals:**
- One code path for "who is this request": the single-user mode becomes the special case of a principal
  that may do everything, rather than a parallel branch.
- Every existing authenticated surface gets account checking by changing the one function they share.
- Isolation enforced at lookup: a workspace that belongs to someone else is indistinguishable from one
  that does not exist.

**Non-Goals:**
- OIDC (next change; it adds a second way to obtain the same session token).
- Running each account as its own OS user (a later change). This one confines shells with landstrip
  instead.
- Persisting signed-in sessions across a server restart.
- Per-account provider keys, quotas or usage accounting.

## Decisions

### D1. A `Principal` replaces the boolean token check

`tokenValid(candidate): boolean` becomes `authenticate(candidate): Principal | undefined`. In single-user
mode it returns the one principal `{ kind: "single" }` when the shared token matches, or when no token is
configured. In multi-user mode it looks the candidate up among session tokens and returns
`{ kind: "account", account }`. Every current call site keeps its shape, but now receives *who* as well
as *whether*. A socket's principal is recorded beside its workspace binding (`principals:
Map<WebSocket, Principal>`).

*Alternative:* a separate middleware for multi-user mode. Rejected: there would be two checks to keep in
step on four surfaces, and the next surface added would get only one of them.

### D2. Ownership on the workspace, filtering at lookup

`Workspace` gains `owner?: string` (an account id; undefined in single-user mode). All lookups that start
from client input go through one function, `workspaceFor(principal, idOrRoot)`. It returns undefined
both for an unknown workspace and for one owned by another account, so every caller already produces the
"no open project" answer. Listings (`workspaceInfos`), activity and attention filter by owner. The
seven `broadcastServerWide` sends split in two:
- activity goes to the owner's sockets only;
- update, restart and other server notices go to administrators' sockets (all sockets in single-user
  mode).

*Alternative:* one registry per account. Rejected: side sessions, retirement and `ensureStarted` all work
against the single registry, and duplicating it duplicates their invariants.

### D3. The registry is a JSON file; signed-in sessions live in memory

`accounts.json` (default beside the configuration file, mode `0600`, written via temp file + rename)
holds, per account: id, display name, role, enabled flag, password hash, `mustChangePassword`, and the
account's own `openProjects`. Session tokens are 32 random bytes, handed to the client once. The server
keeps only their SHA-256 in memory, with account id and last use; idle expiry defaults to 12 hours
(`accounts.sessionIdleHours`). A restart signs everyone out.

The CLI (`pi-outpost user …`) edits the same file. The server watches the file and reloads it, so an
account added or reset from the command line works without a restart. A disable or delete then acts as
if done from the UI: sessions end and sockets close.

*Alternative:* SQLite. Rejected for now: tens of accounts, a native dependency on every platform we ship
an executable for, and nothing that needs queries.

### D4. Passwords: scrypt from `node:crypto`

Stored as `scrypt$N$r$p$salt$hash`, with N=2^15, r=8, p=1, a 16-byte salt and a 64-byte key. The
parameters are stored so they can be raised later. Comparison uses `timingSafeEqual`. An unknown id is
checked against a fixed dummy hash, so a missing account costs the same time as a wrong password.
Minimum length is 8 characters, with no composition rules.

### D5. Sign-in over HTTP, everything else over the socket

- `POST /auth/login {id, password}` → `{token, mustChangePassword}`;
- `POST /auth/logout` (Bearer);
- the password change, which needs the current password, and all account administration are WebSocket
  messages, covered by the same permission check as the rest.

Throttling is in memory, keyed by account id and by address separately. After 5 failures it waits
2^(n−5) seconds, capped at 15 minutes, and a success clears the account's counter. `/health` and
`/branding` tell the client `signIn: "local"` in multi-user mode, so it shows the sign-in screen
instead of the token screen. The close code stays 4401.

### D6. One permission table at the top of `handleClientMessage`

A `const ADMIN_ONLY: ReadonlySet<ClientMessage["type"]>` lists:
- `update_config`, `set_credential`, `declare_provider`;
- `update_pi_package`, `check_pi_packages`, `restart_server`;
- every `*_agent_resource_*` message;
- the account-management messages.

`open_native` and `reveal_native` are refused to everyone in multi-user mode. A connection whose account
must change its password may only send that change. The check runs before the switch, so a new message
type is permitted to users unless it is added to the table. That direction is deliberate, and the
spec-coverage task includes a test that enumerates `ClientMessage` against the table, so each new type is
a conscious choice.

### D7. Confinement reuses the sandbox's path resolution

Browsing, `open_project`, `?workspace=` and `switch_workspace` resolve the requested path with the same
symlink-safe `realResolve` / `isWithin` the sandbox uses, against the account's root. An account's
projects are therefore exactly the open projects inside its root. A per-project sandbox `root` set by an
administrator still applies inside it, but can never point outside it: `update_config` refuses that in
multi-user mode.

### D8. Refused configurations fail at load and at apply

`config.ts` rejects, in multi-user mode: a shared token, `sandbox.allowBash` without `sandbox.bashFrom`,
and any provider key variable in the server's environment. Each error names the setting or variable. The
settings-apply path runs the same validation, so the UI cannot switch them on later.

### D9. The default project is retirable in multi-user mode

`sweepIdleWorkspaces` never retires the default project, because an unnamed connection lands on it. In
multi-user mode there is no single default: each account's root is its own default, and it is retired
like any other project once no client of that account is bound to it.

### D10. The terminal is the confined terminal, with the account as its root

Confinement itself (the runner, the self-check, policy generation, the minimal environment) is the
`confined-terminal` change, which this one depends on. Multi-user mode adds two things:
- `terminalPolicy()` receives the account root as `root`, and `denyRead` also covers `<accounts.root>`,
  so sibling accounts are unreadable even when a project is nested deep in the root;
- the server never spawns an unconfined terminal when `accounts` is set, whatever `terminal.sandbox`
  says.

The evidence for landstrip over bubblewrap is in `confined-terminal`'s design: it runs under Docker's
default profile, whereas bubblewrap needed `seccomp=unconfined` and `systempaths=unconfined`.

## Risks / Trade-offs

- [A new client message type is user-accessible by default] → The enumeration test in D6 fails until the
  type is classified.
- [Landlock depends on the host kernel (≥ 5.13) and on the container runtime's seccomp filter allowing its system calls] → `landstrip doctor` at start; when it fails the terminal is unavailable with the reason, and the documentation tells the administrator to run it in the target container first.
- [The agent's `pi-landstrip` reads the whole host by default (`shell.readAccess: "host"`)] → The multi-user documentation prescribes `readAccess: "policy"` with a read denial on the accounts root. A task verifies that this policy keeps one account's agent out of another's root.
- [The agent's file tools rely on the sandbox for confinement, not on the OS] → Unconfined shells are
  refused (D8), and file tools already go through `resolveConfined`. A pi extension installed by an
  administrator still runs in-process with the server's rights: installing extensions is admin-only, and
  the documentation will say extensions are trusted code.
- [CLI and server writing `accounts.json` at the same time] → Atomic rename means neither corrupts the
  file, but the later write wins. Account edits are rare and human-paced; the CLI warns when the server
  is running.
- [A restart signs everyone out] → Accepted for v1. Restarts are admin-initiated and announced.
- [Session tokens in localStorage are readable by script on the page] → Same exposure as today's shared
  token. The widget is same-origin with the server or explicitly embedded, and expiry limits the window.

## Migration Plan

Opt-in: nothing changes until `accounts` is added to the configuration. To enable:
1. add `accounts.root`;
2. run `pi-outpost user add <id> --admin`;
3. restart.

Existing projects under `cwd` are not migrated into account roots; an administrator moves them on disk
if wanted. Rollback is removing `accounts`: account roots remain ordinary directories, and
`accounts.json` is ignored.
