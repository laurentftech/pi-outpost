# Tasks

## 1. Server

- [x] 1.1 Give each binding request a ticket (`askToBind`), and bind on completion only if it is still the latest — switch, open, side session; verify *TheLastSwitchWins* in `server/test/workspaceSwitchOrder.test.mjs`, which fails without the change

## 2. Interface

- [x] 2.1 Pass every project-menu click on; let `switchWorkspace` send a click on the bound project while a switch is in flight; verify in `ui/src/useAgent.test.ts` and `ui/src/components/ProjectMenu.test.tsx`
- [x] 2.2 Drive it in the running app: a real server with a cold project, quick clicks there and back, and three rapid alternating sequences; the shown project and its file tree are the last clicked

## 3. A project's files before its agent

- [x] 3.1 Server: bind with `workspace_starting` once resources are ready, serve files/git/terminal/switching, queue the rest, announce `workspace_switched` when the agent is ready, and take clients back on a failed start; verify *FilesBeforeTheAgent* and *AFailedStartTakesTheBrowserBack* in `server/test/workspaceFilesBeforeAgent.test.mjs`, with the existing multi-project, side-session and settings suites unchanged
- [x] 3.2 Interface: `agentStarting`, the starting notice, tree and open file kept on the follow-up switch; verify in `ui/src/useAgent.test.ts`
- [x] 3.3 Running app:
  - a cold project's tree in 220 ms against 4.8 s for its agent;
  - a file opened while starting stays open;
  - a message sent while starting is handled after;
  - switching away mid-start holds;
  - coming back is immediate.

## 4. Checks

- [x] 4.1 Write `scenario-coverage.md`; run lint, typecheck, server and UI suites, `openspec validate last-switch-wins --strict`
