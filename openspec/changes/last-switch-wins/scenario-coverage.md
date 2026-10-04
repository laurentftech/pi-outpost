# Scenario coverage — last-switch-wins

## multi-project-workspaces

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| TheLastSwitchWins | covered | `server/test/workspaceSwitchOrder.test.mjs` — "TheLastSwitchWins": with beta's first readiness probe delayed 2.5 s, the server-project click wins, no `workspace_switched` ever names beta, the root listing is the server project's, and beta switches afterwards. Failed before the change (beta rebound the browser). `ui/src/useAgent.test.ts` — "asks to come back to the bound project while a switch away is still in flight"; `ui/src/components/ProjectMenu.test.tsx` — "switches to the project that was clicked, the current one included". Also driven in the running app (real embedded server, cold beta). |
