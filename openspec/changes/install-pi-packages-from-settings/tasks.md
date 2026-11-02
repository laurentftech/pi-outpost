# Tasks

## 1. Protocol

- [x] 1.1 Add `lookup_pi_package`, `install_pi_package`, `remove_pi_package`, `restore_pi_package` client messages and the `pi_package_lookup_result` / `pi_package_change_result` server messages (request id, outcome, message, resolved version) to `shared/src/protocol.ts`; add optional `removed?: true` to `PiPackageInfo`; verify `npx tsc -p shared --noEmit` passes

## 2. Server: lookup, install, remove, restore

- [x] 2.1 Add an npm package-name validator and a `lookupPiPackage(name, version?)` in `server/src/piPackages.ts` built on `npmViewInvocation` (empty answer for a versioned spec = not found); verify unit tests for invalid names, unknown names, unknown versions and a private registry from `.npmrc` (scenarios `AnUnknownPackageIsRefusedInPlace`, `ALookupUsesTheInstallationsRegistry`)
- [x] 2.2 Add `installPiPackage` / `removePiPackage` / `restorePiPackage` in `server/src/piPackages.ts` over `installAndPersist` / `removeAndPersist` (`local` for project scope), judged by a fresh listing, with the settings entry removed again after a failed install; verify unit tests against a fixture agent dir with an isolated `npm_config_prefix` (scenarios `AConfirmedInstallIsListedAndAsksForARestart`, `AProjectInstallGoesToTheProjectsSettings`, `AVersionGivenIsPinned`, `AFailedInstallLeavesTheSettingsAlone`, `AConfirmedRemovalIsListedUntilARestart`, `AFailedRemovalChangesNothing`)
- [x] 2.3 Extract the update handler's guards (`extensionLock`, one change per package, busy affected sessions by scope) into one function in `server/src/index.ts` and route update, install, remove and restore through it; verify the existing update wire tests still pass and new wire tests cover `LockedExtensionsOfferNoInstallOrRemoval`, `AnInstallWaitsForARunningTurn`, `ADoubleConfirmationInstallsOnce`
- [x] 2.4 Wire the four handlers in `handleClientMessage`, refusing an already configured package and a removed one (pointing at restore) at lookup and again at install; verify wire tests for `AConfiguredPackageIsNotAddedTwice` and `AddingARemovedPackagePointsAtUndo`
- [x] 2.5 List removed packages from the startup record and recompute `restartReasons` after every listing, broadcasting only on change; verify server tests for `TheRestartNoticeNamesEachPackageOnce`, `UndoRestoresWhatIsRunning`, and that `ARestartLoadsTheUpdatedPackage` still passes

## 3. UI

- [x] 3.1 Extend `ui/src/useAgent.ts` with lookup / install / remove / restore actions and their pending and result state keyed by source and scope; verify `useAgent` unit tests for each result message
- [x] 3.2 Rework `ui/src/components/PiPackages.tsx` per design §5: empty state, add form (field, scope radios naming the project, message line below the buttons), confirmations, Remove / Undo in fixed slots, status line carrying progress and outcomes, one text size, project marker in the status line; verify component tests for `AnEmptyListOffersToAddAPackage`, `AProjectPackageIsSaidToBeThisProjects`, `NoInstallWithoutConfirmation`, `NoRemovalWithoutConfirmation`, locked state, and that a refused lookup keeps the typed text
- [x] 3.3 Pass the new callbacks through `SettingsMenu.tsx` and `App.tsx`; verify `SettingsMenu` tests still pass
- [x] 3.4 Add an e2e spec driving add (refused then accepted), remove, undo and the restart notice against the running app, plus a layout test measuring that names, actions and the form do not move across update, refusal and removal (`AnUpdateInProgressMovesNothing`, `ARefusalDoesNotMoveTheForm`); verify `npm run test:e2e -- pi-packages` passes after rebuilding web and embed
- [x] 3.5 Update `docs/features.md` (Settings → extensions) to describe adding and removing packages and the restart rule; verify the text matches the UI labels

## 4. Integration

- [x] 4.1 Drive the feature in the running app with a real registry (bench), then a monkey pass: double clicks, removing during an update of another package, two clients on one package, switching project with the add form open, removing the package's directory underneath; record what broke and fix it
- [ ] 4.2 Write `openspec/changes/install-pi-packages-from-settings/scenario-coverage.md` covering every scenario in the delta spec; verify `npm run check:scenarios` and `openspec validate install-pi-packages-from-settings --strict` pass

## Workflow follow-up

- Archive the change from `main` after the PR merges, never from the feature branch.
