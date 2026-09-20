## 1. Server

- [x] 1.1 Let `fetchLatestVersion` and its HTTP fallback take a package name, defaulting to pi-outpost; verify the existing update tests still pass and a new one looks up another package
- [x] 1.2 Keep the startup check's answer and the channel's instruction in memory; put it in the snapshot when newer, for the standalone client; verify `ANewerVersionIsAnnouncedInTheInterface` (server half) and `NoNoticeWithoutANewerVersion` in a server test
- [x] 1.3 List configured npm pi packages with installed version and pinned flag through the SDK's package manager; verify `AnInstalledPackageIsListed`, `APinnedPackageIsSaidToBePinned` over a fixture agent directory
- [x] 1.4 Check each unpinned package after startup (not awaited, cached) and on request; carry results in the snapshot and a server-wide message; verify `ANewerVersionIsShown`, `AFailedCheckIsNotUpToDate`, `CheckingOffLooksUpNothing` with a stubbed lookup
- [x] 1.5 Handle an update request: refuse under `extensionLock`, refuse while an affected session is busy, install through `update(source)`, verify the installed version changed, report install failures; verify `AConfirmedUpdateIsInstalledAndAsksForARestart`, `AnUpdateWaitsForARunningTurn`, `AFailedInstallChangesNothing`, `LockedExtensionsOfferNoUpdate` (server half)
- [x] 1.6 Record installed versions at startup and mark packages whose version changed as needing a restart; verify with the wire test after an update and after a version changed behind the server's back
- [x] 1.7 Restart: refuse while an agent works and from a widget connection; close the listener and workspaces, re-run the same command with inherited stdio, forward signals, exit with the child's code; verify `ARestartWaitsForRunningTurns`, `AWidgetCannotRestartTheServer` (server half) and `ARestartLoadsTheUpdatedPackage` with a real restart in a wire test

## 2. Interface

- [x] 2.1 Show the pi-outpost notice in the standalone header with a copy control, dismissible per version; none in a widget; verify `ANewerVersionIsAnnouncedInTheInterface`, `ADismissedNoticeStaysDismissedForThatVersion`, `AWidgetShowsNoNotice` in component tests
- [x] 2.2 List the packages in Settings with versions, availability, "not checked" and its reason, pinned and not installed; a "check now" control; verify in component tests
- [x] 2.3 Offer Update with an executable-code confirmation naming both versions, nothing sent on cancel, nothing offered when locked; show the outcome and "restart needed"; verify `NothingIsSentWithoutConfirmation`, `LockedExtensionsOfferNoUpdate`
- [x] 2.4 Offer "Restart pi-outpost" in the standalone app when a package needs a restart, with a confirmation; none in a widget; verify `AWidgetCannotRestartTheServer` (interface half) and the reconnect in the running app

## 2b. Extension repositories

- [x] 2b.1 Report a repository update that carries extensions as `restart-required` per runtime, name it in what waits on a restart, and say so in the resource manager; verify `AnUpdatedExtensionRepositoryAsksForARestart` and `ASkillsOnlyRepositoryIsReallyReloaded` in `server/test/extensionRepositoryReload.test.mjs`
- [x] 2b.2 Move the restart control out of the package list into one panel shared by packages and repositories; verify in `ui/src/components/RestartNeeded.test.tsx`

## 3. Running app, docs, coverage

- [x] 3.1 Drive it in the running app: a real pi package behind a published version (install an older version of a small package), see it offered, update it, see it current; the pi-outpost notice with a faked newer version; then break it — registry unreachable, update while a turn runs, double-click Update
- [x] 3.2 Update the README (updating) and `scripts/team-install/README.md`
- [x] 3.3 Write `scenario-coverage.md` with every scenario covered; run `npm run check:scenarios` and `openspec validate notify-updates-in-the-interface --strict`
