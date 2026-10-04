# Scenario coverage — last-switch-wins

## multi-project-workspaces

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| TheLastSwitchWins | covered | `server/test/workspaceSwitchOrder.test.mjs` — "TheLastSwitchWins": with beta's first readiness probe delayed 2.5 s, the server-project click wins, no `workspace_switched` ever names beta, the root listing is the server project's, and beta switches afterwards. Failed before the change (beta rebound the browser). `ui/src/useAgent.test.ts` — "asks to come back to the bound project while a switch away is still in flight"; `ui/src/components/ProjectMenu.test.tsx` — "switches to the project that was clicked, the current one included". Also driven in the running app (real embedded server, cold beta). |
| FilesBeforeTheAgent | covered | `server/test/workspaceFilesBeforeAgent.test.mjs` — "FilesBeforeTheAgent": with beta's first readiness probe delayed 3 s:<br>- `workspace_starting` arrives in under 2 s, naming beta, with `agentStarting` and no items;<br>- the root listing (beta.md) is answered before any `workspace_switched` for beta;<br>- a `list_sessions` sent meanwhile is answered after it;<br>- the following `workspace_switched` has no `agentStarting` and has a session.<br>`ui/src/useAgent.test.ts` — "shows a project's files while its agent starts, and keeps them when the agent arrives" and "drops the tree as before when the next project is another one". Also driven in the running app (see tasks 3.3). |
| AFailedStartTakesTheBrowserBack | covered | Same server file — "AFailedStartTakesTheBrowserBack": beta's directory removed, the switch yields a "Could not start" `workspace_error`, then `workspace_switched` for the server's project, which answers `list_sessions`. |
