## Context

`config.sandbox` is the server's sandbox, anchored on the project it booted with. Other projects inherit it with their own directory as root and no writable root (`workspaceOptions`). Settings showed `config.sandbox` everywhere and Apply rebuilt the current project with `config.sandbox` itself — the first project's root. `persistEditableSettings` always writes `sandbox.root` on purpose: an accepted Settings root must outrank `--cwd` and `PI_OUTPOST_CWD` at the next start (`ConfigPrecedence`).

## Decisions

- **The server's own project is the booted one** (`serverProject`). Roots are editable only from it (`rootEditableFrom`) — moving them leaves every other project in its own directory, so it needs no other condition, and an embedded widget in `settings` mode keeps the root control its spec promises; otherwise the request's roots are replaced by the current ones before anything else, so a stale or forged root cannot move them.
- **Rebuilds go through `sandboxFor(project)`**: the configured sandbox for the server's project; for another, the configured permissions with the project's own root and writable root. The rollback path uses it too.
- **Skip, not suppress, the root write.** The precedence reason for always writing `root` still holds for a real sandbox change, so it is kept. What changes is that an unchanged sandbox is no longer a change: the server skips persisting and reapplying it (defence against any client) and the panel stops sending it (Apply disabled until a field differs).
- **Permissions stay server-wide.** Applying from a project rebuilds that project; other open projects keep their tools until they are rebuilt, and projects opened later inherit the new permissions. The panel says so rather than replacing sessions the user is not looking at.

## Risks / Trade-offs

- [The server's project closed while others stay open] → no project can edit the roots until it is reopened; acceptable, and the panel still shows each project's own directory.
