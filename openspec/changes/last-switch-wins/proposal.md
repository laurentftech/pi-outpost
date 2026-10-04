# Proposal

## Why

Colleagues on Windows saw the Files tree not follow a project switch, or follow it very late. A switch
waits for its target to start, and a cold project starts far slower than a warm one. A cold project is
one opened but never watched, or retired after its idle period. On Windows, each process its start
spawns costs more.

Two quick clicks — a cold project, then back to a warm one — bound the browser to the warm one, and then
again to the cold one when its start finished. Reproduced on a real server: the user was left on the
project they had just left, its file tree with it.

The menu also never sent a click on the project already shown. So coming back while a switch away was
in flight could not reach the server at all.

## What Changes

- **The server binds the latest ask only.** Each switch, open or side-session request from a browser
  takes a ticket. A target that finishes starting binds that browser only if its ticket is still the
  latest; otherwise it stays started, ready for later. An abandoned switch's error is not sent either.
- **Coming back reaches the server.** The project menu passes every click on. `switchWorkspace`
  ignores the project already shown only when no switch is in flight.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `multi-project-workspaces`: switching honours the latest request.

## Impact

- `server/src/index.ts`: `askToBind` tickets in `switch_workspace`, `handleOpenProject` and
  `handleOpenSideSession`.
- `ui/src/useAgent.ts`, `ui/src/components/ProjectMenu.tsx`.
- Tests:
  - `server/test/workspaceSwitchOrder.test.mjs`, which reproduces the race;
  - `ui/src/useAgent.test.ts`;
  - `ui/src/components/ProjectMenu.test.tsx`.
- Not in scope: making a cold start faster, or showing a project's files before its agent has started.
  These are discussed separately.
