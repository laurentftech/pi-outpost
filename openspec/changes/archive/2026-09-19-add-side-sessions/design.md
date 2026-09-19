## Context

See proposal.md for the motivation. What shapes the approach:

- A `Workspace` (`server/src/workspace.ts`) owns everything rooted at one project: roots,
  repositories, watcher, sandboxed toolset, renderer, and **one** runtime with its
  per-conversation state (Work Plan, pending dialogs, document-tool ageing,
  `replacingSession`, activity).
- Its identity is its resolved root: `WorkspaceRegistry` is keyed by root, and so are
  `starting`, `resourceReloadSyncs` and the other maps in `index.ts`; on the wire,
  `WorkspaceInfo.root` is the identity (`switch_workspace`, `close_project`).
- Parallel agents already exist between projects: activity, attention, background
  output and retirement are per workspace, and clients bind to one workspace.
- Session history is per directory (`SessionManager` keyed by cwd), so two workspaces
  on one directory see the same history.
- A workspace starts on a fresh conversation (`SessionManager.create`), including when
  it is rebuilt after retirement.

## Goals / Non-Goals

**Goals:**
- A side session behaves, for every existing mechanism, like an open project — the
  work is in naming it, not in re-implementing concurrency.
- Old clients keep working: a client that only knows `root` sees and drives the
  project's main session.

**Non-Goals:**
- Isolating edits (git worktree per session). The user chose a shared directory; a
  later change could add worktrees as an option on the same identity.
- Restoring side sessions across restarts, or configuring them in `openProjects`.
- A limit on the number of side sessions: each costs one runtime, as a project does,
  and the same retirement sweep bounds idle ones.

## Decisions

### A side session is a second `Workspace` on the same root

Each side session is a full `Workspace` built by the same path as a project
(`buildResources` + `buildRuntimeFor`), registered with an id distinct from its root.
Every per-workspace mechanism — event routing, activity, attention, background output,
the dialog store, Work Plan, `replacingSession` — then applies unchanged.

*Alternative: split `Workspace` into a project (resources) and lanes (runtimes).* It is
the cleaner model and shares one watcher and one repository scan, but every
`workspace.agent` access and every per-conversation field in `index.ts` would take a
lane parameter — the largest function in the server (`handleClientMessage`) changes
throughout, to save a watcher per side session. Not worth it for small side actions;
the id introduced here is the same one a later split would need.

### Identity: an `id`, equal to the root for a main session

`Workspace` gains `id`. A project's main session keeps `id === root`; a side session
gets `<root>#side-<n>`, `n` counting up per project for the life of the server. The
registry is keyed by id; `default`, "last open project" and the project count consider
main sessions only. Maps keyed by `workspace.root` are re-keyed by `id` where they hold
per-conversation state (`starting`, `resourceReloadSyncs`, …) and stay by root where
they are genuinely per directory.

On the wire, `WorkspaceInfo` gains `id` and, for a side session, `sideOf` (the project
root) and `label`. `switch_workspace` and `close_project` accept `id` alongside `root`;
the server resolves `id ?? root`. A new `open_side_session { root }` starts one on an
open project. A client that sends only `root` addresses the main session, as it always
has — additive, no version bump.

*Alternative: overload `root` with the side id.* Rejected: `root` is displayed and used
as a path by clients; a value that is not a path would reach both.

### Shared resources are rebuilt for every session of a project

Settings (`handleUpdateConfig`) and resource changes compute the new settings once,
check that no *other* session of the project is running a turn (refusing with its
label otherwise), then rebuild resources and tools of each, in turn. Rebuilding tools
starts a fresh session (`rebuildTools` → `newSession`) — which is what "Apply & restart
session" has always done to the session Settings are applied from. The other sessions
did not ask for a restart, so each is switched back onto the conversation file it was
showing once rebuilt (`rebuildSibling`), when that file exists. `sandboxFor` and `rootEditableFrom` compare
`target.root` with the server project's root rather than identity, so a side session of
the server's own project is confined like it; roots stay editable only from the main
session.

### A conversation is live in one session

`switchSession`, fork and prompt-edit replacement check the requested file against the
live `sessionFile` of every other session with the same root, and refuse with that
session's label. `sessionList` marks such entries (`liveIn: label`). Two writers on one
session file is the failure this prevents — the same reason `starting` exists.

### Side sessions are closed, not retired

Retirement rebuilds a workspace onto a *fresh* conversation, which for a side session
would leave an empty entry in the selector. The sweep closes an idle side session
instead, under the retirement conditions (no client, no turn, not ready for review).
Its conversation is already on disk.

### The control lives on the project's row

The project list (`ProjectMenu`) gains a `+` on each main entry, next to the close
button, always visible — the close button is hover-only, which a touch screen cannot
reach and a user cannot discover. It sends `open_side_session` for that row's root, so
any open project can get a side session without being switched to first. Side entries
are indented under their project and carry only the close button.

*Alternative: a "New side session" item at the foot of the menu, or a button next to
the header's new-session button.* Both act on the current project only, and put the
action away from where its result appears.

### Tab title

`App.tsx` already sets `document.title` outside embeds. It becomes
`<project name>[ · <side label>] — <extension title ?? branded title ?? "pi">`, with the
project part omitted when the snapshot carries no workspace (single unnamed workspace).

## Risks / Trade-offs

- [Two agents edit the same file] → accepted by design; documented in `docs/how-to.md`.
  The file watcher already refreshes the open viewer when a file changes underneath.
- [Duplicate watcher and repository scan per side session] → one watcher per session on
  the same tree. Acceptable at the handful of side sessions this is for; a lane split
  later would remove it.
- [A settings apply refused because a side session is busy] → the error names it; the
  user can wait or abort it. Rebuilding a session mid-turn would lose its output.
- [RPC runtime] → each side session spawns its own child, like a project; best effort,
  the SDK runtime is the priority.
- [Old embed widgets in `projects` mode] → they see side sessions as extra entries
  labelled by `name` and can switch to them by `root`… which addresses the main
  session. Mitigation: `name` of a side entry carries the label, and switching by
  `root` to a side entry is harmless (lands on the main session).

## Migration Plan

None: additive protocol, no configuration, no persisted state. Rollback is a revert.
