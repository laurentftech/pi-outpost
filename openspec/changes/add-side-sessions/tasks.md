## 1. Workspace identity

- [x] 1.1 Give `Workspace` an `id` (`root` for a main session, `<root>#side-<n>` for a side session) and a `sideOf`/`label`; key `WorkspaceRegistry` by id, with `default`, count and "last project" over main sessions only; verify with unit tests in `server/test/workspaceRegistry.test.ts`
- [x] 1.2 Re-key per-conversation maps in `server/src/index.ts` (`starting`, `resourceReloadSyncs`, …) by `id`; verify the multi-project server suites still pass (`npm test -w server`)
- [x] 1.3 Add `id`, `sideOf`, `label` to `WorkspaceInfo`, `id` to `switch_workspace`/`close_project`, and `open_side_session` to `shared/src/protocol.ts`; resolve `id ?? root` on the server; verify with `npm run typecheck` and a server test that a root-only client still drives the main session

## 2. Side session lifecycle (server)

- [x] 2.1 Handle `open_side_session`: build a workspace on the project's root through the same path as a project, fresh conversation, bind the requesting client, announce it; refuse under `workspaceLock`; verify `ASideSessionStartsWhileTheProjectWorks`, `BothSessionsWorkAtTheSameTime`, `ASideSessionWorksInTheProjectDirectory`, `ALockedServerRefusesSideSessions` in `server/test/sideSessions.test.mjs`
- [x] 2.2 List side sessions with their project, labelled by conversation name once named; verify `ASideSessionIsListedUnderItsProject`, `ASideSessionIsLabelledByItsConversation`, `SwitchingAwayLeavesTheSideSessionRunning`, `AWaitingSideSessionAsksForAttention`
- [x] 2.3 Enforce one live place per conversation in `switchSession`, fork and prompt-edit replacement, and mark `liveIn` in `sessionList`; verify `OpeningAConversationLiveElsewhereIsRefused`, `TheListShowsWhereAConversationIsLive`, `ASideConversationIsKeptInHistory`
- [x] 2.4 Close side sessions (refused mid-turn), close a project's side sessions with it (refused while one works), close instead of retire in the sweep, and do not persist them; verify `ClosingASideSessionMovesItsClientsToTheProject`, `ClosingAWorkingSideSessionIsRefused`, `ClosingAProjectClosesItsSideSessions`, `AProjectWithAWorkingSideSessionCannotBeClosed`, `AnIdleSideSessionIsClosedNotRetired`, `SideSessionsDoNotSurviveARestart`
- [x] 2.5 Fan Settings and resource changes out to every session of the project, refusing while another one runs a turn; make `sandboxFor`/`rootEditableFrom` compare roots; verify `APermissionChangeReachesTheSideSession`, `SettingsWaitForAWorkingSideSession`, and that `server/test/multiProjectSandboxSettings.test.mjs` still passes

## 3. Interface

- [x] 3.1 Show side sessions indented under their project in `ProjectMenu`, switch and close them by `id`, and add an always-visible `+` on each main entry that starts a side session on that project; verify in `ui/src/components/ProjectMenu.test.tsx` and `ui/src/App.test.tsx` for `TheProjectControlsOfferASideSession`, `TheProjectRowStartsASideSession` and `AWidgetBoundToOneProjectOffersNoSideSession`
- [x] 3.2 Mark a conversation live in another session in the session menu, and show the refusal; verify in `ui/src/components/Header.test.tsx`
- [x] 3.3 Set the tab title to `<project>[ · <side label>] — <title>` in the standalone app only; verify `TheTabNamesTheProject`, `TheTabFollowsTheProject`, `TheTabNamesTheSideSession`, `AnExtensionTitleKeepsTheProjectName`, `TheWidgetLeavesTheHostTitleAlone` in `ui/src/App.test.tsx`

## 4. Running app, docs, coverage

- [x] 4.1 Drive it in the running app with Playwright (rebuild `web`, embed, e2e host first): start a side session while the main agent streams, prompt both, switch back and forth, close; then monkey-test — close mid-turn, open the main's live conversation from the side, apply Settings while the side streams, spam new side sessions, switch projects mid-request; add an e2e spec for the start/switch/close path
- [x] 4.2 Update `README.md` and `docs/how-to.md` (several projects; side sessions share the directory and nothing isolates their edits); verify links and anchors
- [x] 4.3 Write `scenario-coverage.md` with every scenario of both deltas `covered`; run `npm run check:scenarios` and `openspec validate add-side-sessions --strict`
