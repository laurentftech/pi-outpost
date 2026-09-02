## Why

Skills and extensions can come from several local directories backed by different Git repositories, but the application currently exposes only path and inventory controls. Operators must leave the application to identify each repository, understand whether it is safe to update, pull it, and then reload affected runtimes. This is especially opaque when one repository supplies both skills and executable extensions or when several configured roots resolve to the same repository.

## What Changes

- Add a dedicated, repository-first **Agent resources** dialog based on prototype A, with search, filters, attention summaries, and separate skill and extension inventories for the selected repository.
- Attribute loaded or configured skill and extension paths to their canonical Git repository, supporting multiple repositories, nested repositories, mixed skill/extension repositories, deduplication, and honest unavailable-provenance states.
- Check remote state and update eligible repositories on their current tracked branch using fetch plus fast-forward-only integration.
- Block updates for dirty, detached, ahead, diverged, untracked, unavailable, or otherwise unsafe repositories and direct users to resolve local changes in an external terminal.
- Require explicit confirmation before updating a repository that supplies extensions, and make `extensionLock` block any interface-driven update that could change extension code, including mixed repositories.
- Revalidate eligibility immediately before mutation, serialize operations per repository, constrain Git execution to server-derived repository roots and fixed arguments, and disable repository hooks during integration.
- Rebuild every affected started and idle runtime after a successful update; refuse the update while an affected workspace is busy, and report disk-update/reload failures without claiming rollback or success.
- Keep this feature updater-only: it does not commit, stash, discard, rebase, merge non-fast-forward histories, push, switch branches, or edit repository contents directly.
- Preserve the existing read-only workspace Git integration as a distinct concern; resource repository updates use a separate service and authorization boundary.

## Capabilities

### New Capabilities

- `agent-resource-management`: Discover agent-resource provenance, group skills and extensions by Git repository, assess update eligibility, perform guarded fast-forward updates, and reload affected runtimes.

### Modified Capabilities

- `components`: Add the repository-first Agent resources dialog and its inventory, status, filtering, confirmation, blocked-state, and refresh interactions.
- `git`: Clarify that the existing read-only command restriction applies to workspace Git browsing, while the separate resource updater may run its narrowly specified update command set against trusted resource repositories.
- `config`: Extend `extensionLock` so it also prevents UI-triggered repository updates that could modify extension code.

## Impact

- Shared protocol and runtime snapshots gain resource provenance, repository state, check, update, and reload-result data.
- Embedded and RPC runtime adapters must expose provenance when available and explicitly report unsupported inventory rather than infer it.
- The server gains a dedicated resource-repository discovery and Git update service plus per-repository coordination and affected-workspace rebuild orchestration.
- Settings and application UI gain the Agent resources entry point and split-pane dialog while retaining existing path configuration controls.
- Tests cover repository attribution, all eligibility states, command confinement, extension confirmation and locking, concurrent requests, busy workspaces, reload outcomes, and running-app UI behavior.
- User and developer documentation must explain the updater-only boundary, security implications of extension updates, supported runtime provenance, and external handling of local changes.
