## Why

A project runs one agent at a time: opening or starting another session replaces the one
that is working, and is refused while it runs a turn. A small side action — a question
about the code, a quick fix, a lookup — therefore waits for the long task to finish, or
goes to another project, or to another tool. Several projects can already work in
parallel; two conversations in one project cannot.

With several conversations on one project, the browser tab is also where a user tells
them apart, and today every tab reads the same brand title.

## What Changes

- **Side sessions.** From an open project, the user can start a *side session*: a
  second agent on the same project, running at the same time as the first, in a fresh
  conversation. It appears in the project selector under its project, labelled by its
  session name, with the same activity and attention reporting as any open project.
- **Same directory, same rules.** A side session works in the project's own directory,
  with the project's sandbox, tools, skills and extensions — like a second terminal on
  the same repository. Nothing isolates the two agents' edits from each other; that is
  the user's to manage, and the documentation says so.
- **Shared history.** A side session's conversation is saved in the project's session
  history like any other. A conversation can be live in only one place at a time:
  opening, in one session, a conversation that is live in another of the same project
  is refused, and the session list says where it is live.
- **Closing.** A side session is closed like a project: refused while its agent runs a
  turn, its conversation kept in history. Closing a project closes its side sessions,
  and is refused while any of them runs a turn. Side sessions are not reopened when the
  server restarts.
- **Settings stay per project.** Settings applied from any session of a project apply to
  the project, and rebuild every one of its sessions. They are refused while another
  session of the project is running a turn, saying which.
- **Where it is offered.** Wherever the project controls are: the standalone app, and an
  embedded widget in `projects` mode. Not in a widget bound to one project (`settings`,
  `root`), and not on a server pinned by `workspaceLock`.
- **Browser tab title.** The standalone app's tab title names the project being shown,
  and the side session when it is one — for example `pi-outpost — pi` and
  `pi-outpost · fix typo — pi`. An embedded widget still leaves the host page's title
  alone.

## Capabilities

### New Capabilities
- `side-sessions`: starting, showing, switching to and closing a second concurrent agent
  session on an open project; the rule that a conversation is live in one place only;
  how Settings and project closing treat a project's side sessions; where the
  affordance is offered.

### Modified Capabilities
- `multi-project-workspaces`: adds that the standalone app names the project, and the
  side session, in the browser tab title (next to `AlwaysNameTheProjectOnScreen`).

## Impact

- `server/src/workspace.ts`, `server/src/workspaceRegistry.ts`: a workspace gains an
  identity distinct from its root, so two can share one directory.
- `server/src/index.ts`: open/close/switch of side sessions, the live-conversation rule
  in `switchSession`/fork/list, Settings fanning out to a project's sessions,
  `sandboxFor` and `rootEditableFrom` recognising the server project's side sessions,
  maps keyed by `workspace.root`.
- `shared/src/protocol.ts`: `WorkspaceInfo` gains an `id` and side-session fields;
  `switch_workspace`/`close_project` accept an `id`; a new `open_side_session` message.
  Additive: a client that only knows `root` keeps working against the main session.
- `ui/src/components/ProjectMenu.tsx`, `ui/src/useAgent.ts`, `ui/src/App.tsx`: the
  selector entries and the new action; the tab title.
- Docs: `README.md` and `docs/how-to.md` (working on several projects), which describe
  one agent per project.
