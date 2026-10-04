# Tasks

## 1. Server

- [x] 1.1 Give each binding request a ticket (`askToBind`), and bind on completion only if it is still the latest — switch, open, side session; verify *TheLastSwitchWins* in `server/test/workspaceSwitchOrder.test.mjs`, which fails without the change

## 2. Interface

- [x] 2.1 Pass every project-menu click on; let `switchWorkspace` send a click on the bound project while a switch is in flight; verify in `ui/src/useAgent.test.ts` and `ui/src/components/ProjectMenu.test.tsx`
- [x] 2.2 Drive it in the running app: a real server with a cold project, quick clicks there and back, and three rapid alternating sequences; the shown project and its file tree are the last clicked

## 3. Checks

- [x] 3.1 Write `scenario-coverage.md`; run lint, typecheck, server and UI suites, `openspec validate last-switch-wins --strict`
