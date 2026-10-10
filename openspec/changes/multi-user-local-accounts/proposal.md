# Proposal

## Why

pi-outpost is meant to run as one shared container used by several people at the office (issue #4),
but every authenticated connection is the same person: any client can bind to any open project, sees
every project's activity, browses the whole host filesystem, sets the provider keys everyone uses and
can restart the server under the others. Multi-project workspaces already gave each project its own
agent, sandbox, scoped broadcast and idle retirement; what is missing is the *person* — an account
that owns a set of projects, and a split between what one user may do and what only an administrator
may do. Local accounts come first because they work in any container with no identity infrastructure;
OIDC follows as a separate change on the same account registry.

## What Changes

- An opt-in **multi-user mode** (`accounts` in the configuration). Without it pi-outpost is unchanged:
  one user, the optional shared token.
- A **registry of accounts** kept by pi-outpost: id, display name, role (`admin` or `user`), personal
  root `<accounts.root>/<id>/`, enabled or disabled, and a password hash.
- **Local sign-in**: a sign-in screen replaces the token screen; a successful sign-in yields a session
  token carried exactly where the shared token is carried today (WebSocket query, `Authorization`
  header, `/files/raw` query). Passwords are hashed with scrypt; repeated failures are throttled;
  an account whose password was set by an administrator must choose its own before doing anything else.
- **Bootstrap of the first administrator** from the command line (`pi-outpost user add <id> --admin`),
  since no administrator exists yet to create one. A multi-user server with no administrator refuses
  to start and names that command.
- **Per-account isolation**: a connection belongs to one account and only ever sees and binds that
  account's projects; projects can only be opened inside its root; directory browsing is confined to
  it; the set of open projects, project activity and attention are per account. An account's default
  project is its root.
- **Administration reserved to `admin`**: managing accounts (create with an initial password, reset a
  password, disable, re-enable, delete), server configuration, provider credentials (shared by all
  accounts), pi packages and agent-resource repositories, server restart and update notices.
- **No unconfined shell**: the web terminal runs only inside an OS sandbox that confines it to the
  account's root (landstrip: Landlock + seccomp, which works under Docker's default security profile);
  without a usable sandbox there is no terminal. `bash` for the agent must be delegated to a confining
  extension (`sandbox.bashFrom`). Provider keys may not sit in the server's environment, which a
  sandboxed process can read.
- **Disabling or deleting an account** ends its connections and sessions at once and retires its
  projects; deleting keeps its files on disk.

## Capabilities

### New Capabilities

- `multi-user-accounts`: the opt-in mode, the account registry, local sign-in and password rules,
  first-administrator bootstrap, the administrator/user permission split, per-account isolation of
  projects, activity and browsing, the confined terminal, account lifecycle, and the configurations the
  mode refuses.

### Modified Capabilities

- `server-path-selection`: in multi-user mode the directory picker is confined to the account's root
  instead of the whole host filesystem.
- `multi-project-workspaces`: the set of open projects becomes per account, and project activity
  reaches only the clients of the account that owns the project.

## Impact

- **Server**: `server/src/config.ts` (the `accounts` block and the configurations it refuses), a new
  account store and password module, `server/src/index.ts` (sign-in route, session tokens in the
  existing token checks, account on each connection, per-account filtering of workspaces, activity and
  open projects, permission check in `handleClientMessage`, account lifecycle), `server/src/sandbox.ts`
  and the directory browser (confinement to the account root).
- **Protocol**: `shared/src/protocol.ts` gains account management messages, the account and role in
  the snapshot, and the "must change password" state.
- **UI**: a sign-in screen in place of the token screen, a password-change screen, an account
  administration panel for administrators, and administration controls hidden from plain users.
- **CLI**: `pi-outpost user add|reset|list` against the configured registry.
- **Embed**: the widget's `token` option carries a session token in multi-user mode.
- **Depends on** `confined-terminal` (the terminal under landstrip); this change makes it mandatory in
  multi-user mode with the account as its root.
- **Out of scope**: OIDC sign-in (next change), per-account provider keys, per-account quotas, and
  running each account as its own OS user (a later change).
- **Compatibility**: none broken. A configuration without `accounts` behaves exactly as today.
