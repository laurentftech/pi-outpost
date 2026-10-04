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

- **A project's files come before its agent.** Starting the agent is the slow part of a switch, and the
  file tree never needed it. A switch or open now binds the browser as soon as the project's files can be
  served:
  - `workspace_starting` carries the project and `agentStarting: true`;
  - the files, git and terminal answer at once, and other requests wait for the agent, in order;
  - `workspace_switched` follows when the agent is ready, keeping the tree and the open file.

  A client that ignores the new message sees what it saw before. A failed start takes the browser back
  to the server's project.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `multi-project-workspaces`: switching honours the latest request, and shows a project's files before its agent.

## Impact

- `server/src/index.ts`: `askToBind` tickets in `switch_workspace`, `handleOpenProject` and
  `handleOpenSideSession`.
- `ui/src/useAgent.ts`, `ui/src/components/ProjectMenu.tsx`.
- Tests:
  - `server/test/workspaceSwitchOrder.test.mjs`, which reproduces the race;
  - `ui/src/useAgent.test.ts`;
  - `ui/src/components/ProjectMenu.test.tsx`.
- Server: `projectFields`/`startingSnapshot`, `SERVED_WHILE_STARTING` and `startQueues`, two-phase
  `ensureStarted` (`whenResourcesReady`, `announceAgentStarted`, `abandonStart`).
- Protocol: `workspace_starting`, `SessionSnapshot.agentStarting`.
- Interface: `agentStarting` state, "Starting the agent…" in the conversation, tree and open file kept on
  the follow-up `workspace_switched`.
- Docs: README (projects) and how-to (idle timeout).
