# Scenario coverage — install-pi-packages-from-settings

Four levels. `server/test/piPackagesInstall.test.ts` runs lookup, install, removal and restore
over a real npm and a registry of the test's own (`server/test/fakePiPackages.mjs`), reading the
settings files and `node_modules` back from disk; failures are provoked through the SDK's
`npmCommand` setting and a registry that withholds the tarball. `server/test/piPackagesInstallWire.test.mjs`
drives the same operations over a real server's WebSocket, including a restart, a running turn,
`extensionLock` and two confirmations sent together; `server/test/piPackagesWire.test.mjs` keeps
the update and restart scenarios. `ui/src/components/PiPackages.test.tsx` and
`ui/src/useAgent.test.ts` pin the section and its state. `e2e/pi-packages.spec.ts` drives the
built app in Chromium against a real server, real npm and the fake registry, reading the settings
files back and measuring the layout. The monkey pass (`scripts/probes/pi-packages-monkey*.mts`,
`pi-packages-deleted-underneath.mts`) found two defects, fixed and pinned: the project scope
carried over to the next add, and a stale refusal stayed under a settled row.

## Capability: `pi-package-updates` (27 scenarios in the delta)

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| AnInstalledPackageIsListed | covered | `server/test/piPackages.test.ts` — "an installed package is listed with its name and installed version" (deep-equals the listing); `ui/src/components/PiPackages.test.tsx` — "say their version, a newer one…" |
| APinnedPackageIsSaidToBePinned | covered | `server/test/piPackages.test.ts` — "a pinned package says so…"; `ui/src/components/PiPackages.test.tsx` — "say their version…": status "1.0.0, pinned" and exactly one Update button |
| AProjectPackageIsSaidToBeThisProjects | covered | `ui/src/components/PiPackages.test.tsx` — "AProjectPackageIsSaidToBeThisProjects, and a removed one…": row reads "this project · …"; `e2e/pi-packages.spec.ts`: the project install's row matches `/this project ·/` with "1.1.0 installed — restart to use it"; `server/test/piPackagesInstall.test.ts` lists it with `scope: "project"` |
| AnEmptyListOffersToAddAPackage | covered | `ui/src/components/PiPackages.test.tsx` — "AnEmptyListOffersToAddAPackage": "No packages installed", an "Add a package" button, no check button; `server/test/piPackagesInstallWire.test.mjs` — after the restart the server lists `[]` (not absent) |
| ARestartLoadsTheUpdatedPackage | covered | `server/test/piPackagesWire.test.mjs` — "a newer version is offered and installed, then a restart loads it": the fresh hello's tools are 1.1.0's, not 1.0.0's |
| ARestartWaitsForRunningTurns | covered | `server/test/piPackagesWire.test.mjs` — "a restart waits for a running turn": refusal text, no `server_restarting` |
| AWidgetCannotRestartTheServer | covered | `server/test/piPackagesWire.test.mjs` — "a widget's connection cannot restart the server"; `ui/src/components/RestartNeeded.test.tsx` (interface half) |
| TheRestartNoticeNamesEachPackageOnce | covered | `server/test/piPackagesInstallWire.test.mjs` — "a removed package stays listed…": a `restart_needed` naming "pi-fake-ext removed", then after the restore one naming nothing of it; `e2e/pi-packages.spec.ts`: notice shows "pi-fake-ext removed", and after Undo `restart-needed` has count 0 |
| ARestartUnloadsARemovedPackage | covered | `server/test/piPackagesInstallWire.test.mjs` — same test: after the restart the hello has no `fake_ext_*` tool and the listing is `[]` |
| AnUnknownPackageIsRefusedInPlace | covered | `server/test/piPackagesInstall.test.ts` — "AnUnknownPackageIsRefusedInPlace…" (missing name and missing version); `server/test/piPackagesInstallWire.test.mjs` — "an unknown package is refused at the lookup…": refused, install refused, settings unchanged; `ui/src/components/PiPackages.test.tsx` — field keeps "nope-xyz", alert text; `e2e/pi-packages.spec.ts`: alert text, field value kept |
| AConfiguredPackageIsNotAddedTwice | covered | `server/test/piPackagesInstall.test.ts` — "AConfiguredPackageIsNotAddedTwice…": refused with no registry request; `server/test/piPackagesInstallWire.test.mjs` — lookup after restore refused "already in the agent's settings"; `e2e/pi-packages.spec.ts`: same alert in the browser |
| ALookupUsesTheInstallationsRegistry | covered | `server/test/piPackagesInstall.test.ts` — "ALookupUsesTheInstallationsRegistry…": registry only in a user `.npmrc`, real `npm view` answers found / missing from it and its request count rises |
| AConfirmedInstallIsListedAndAsksForARestart | covered | `server/test/piPackagesInstall.test.ts` — "AConfirmedInstallIsListedAndAsksForARestart…": agent settings hold `npm:pi-fake-ext`, 1.0.0 installed; `server/test/piPackagesInstallWire.test.mjs` — "an install into this project…": listed with `restartNeeded: true`; `e2e/pi-packages.spec.ts`: row "1.1.0 installed — restart to use it" and the notice names "pi-fake-ext 1.1.0" |
| AProjectInstallGoesToTheProjectsSettings | covered | `server/test/piPackagesInstall.test.ts` — project settings hold the source, agent settings untouched; `server/test/piPackagesInstallWire.test.mjs` and `e2e/pi-packages.spec.ts` read both files back |
| AVersionGivenIsPinned | covered | `server/test/piPackagesInstall.test.ts`: listing deep-equals `{ installed: "1.1.0", pinned: "1.1.0" }`; `server/test/piPackagesInstallWire.test.mjs`: settings `npm:pi-fake-ext@1.1.0`, listed pinned |
| NoInstallWithoutConfirmation | covered | `ui/src/components/PiPackages.test.tsx` — "NoInstallWithoutConfirmation…": Cancel calls `onCloseLookup` and never `onInstall`; `e2e/pi-packages.spec.ts`: after Cancel the project settings file is empty |
| AFailedInstallLeavesTheSettingsAlone | covered | `server/test/piPackagesInstall.test.ts` — "AFailedInstallLeavesTheSettingsAlone…": failed, project settings empty, nothing listed in the project scope; "AFailedRemovalChangesNothing…": an install through a broken npm fails and configures nothing; `ui/src/components/PiPackages.test.tsx` — "AFailedInstallLeavesTheSettingsAlone…": the reason is the alert |
| AConfirmedRemovalIsListedUntilARestart | covered | `server/test/piPackagesInstall.test.ts`: removed, settings empty, nothing installed; `server/test/piPackagesInstallWire.test.mjs`: list deep-equals the removed entry with `loaded: "1.0.0"`; `e2e/pi-packages.spec.ts`: row text and settings file |
| NoRemovalWithoutConfirmation | covered | `ui/src/components/PiPackages.test.tsx` — "NoRemovalWithoutConfirmation…": Cancel never calls `onRemove`; the confirmation names "the pi-outpost project's settings" |
| AFailedRemovalChangesNothing | covered | `server/test/piPackagesInstall.test.ts` — "AFailedRemovalChangesNothing…": still configured and installed at 1.0.0; `ui/src/components/PiPackages.test.tsx` — "a failed removal is said in the package's status line" |
| UndoRestoresWhatIsRunning | covered | `server/test/piPackagesInstall.test.ts`: restored at 1.0.0 although 1.1.0 is latest, source unpinned as before; `server/test/piPackagesInstallWire.test.mjs`: listed installed 1.0.0 with no `restartNeeded`, one entry; `e2e/pi-packages.spec.ts`: row "1.0.0 — 1.1.0 available", settings restored |
| AddingARemovedPackagePointsAtUndo | covered | `server/test/piPackagesInstall.test.ts` — refused with no registry request; `server/test/piPackagesInstallWire.test.mjs` — over the wire; `e2e/pi-packages.spec.ts`: alert "undo the removal" |
| LockedExtensionsOfferNoInstallOrRemoval | covered | `server/test/piPackagesInstallWire.test.mjs` — "locked extensions refuse a lookup, an install, a removal and a restore": four refusals, settings unchanged; `ui/src/components/PiPackages.test.tsx` — no Add, Remove, Undo or Update button |
| AnInstallWaitsForARunningTurn | covered | `server/test/piPackagesInstallWire.test.mjs` — "an install waits for a running turn…": refusal names the working project, project settings unchanged |
| ADoubleConfirmationInstallsOnce | covered | `server/test/piPackagesInstallWire.test.mjs` — two `install_pi_package` sent back to back: one installed, one refused, one settings entry, one listed project entry; `e2e/pi-packages.spec.ts`: double click on Install, one row; `ui/src/components/PiPackages.test.tsx` — confirmation replaced by progress |
| AnUpdateInProgressMovesNothing | covered | `e2e/pi-packages.spec.ts`: bounding boxes of the name, Remove and Add a package equal before, during ("updating to 1.1.0…") and after the update; also across remove and undo; every text in the section measures 12px sans |
| ARefusalDoesNotMoveTheForm | covered | `e2e/pi-packages.spec.ts`: field and Install… boxes equal before and after the refusal; `ui/src/components/PiPackages.test.tsx`: the alert follows the Install… button in the document |
