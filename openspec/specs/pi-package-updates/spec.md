# Pi Package Updates Specification

## Purpose

Lets a user see which pi packages the agent loads, whether a newer version of each is published, and update one from Settings — so extensions such as a permission system or OpenLore stay current without a terminal.

## Requirements

### Requirement: TheLoadedPackagesAreListedWithTheirVersions

Settings SHALL list every npm pi package configured for the agent — in the agent directory's settings and in the project's — with its name, its installed version, whether its version is pinned, and, for a package in the project's settings, that it belongs to this project. A configured package that is not installed SHALL be listed as not installed. With no package configured, Settings SHALL say so and still offer to add one.

#### Scenario: AnInstalledPackageIsListed
- **GIVEN** the agent directory's settings configure `npm:@gotgenes/pi-permission-system`, installed at 33.0.1
- **WHEN** Settings is opened
- **THEN** it lists `@gotgenes/pi-permission-system` at 33.0.1

#### Scenario: APinnedPackageIsSaidToBePinned
- **GIVEN** a package configured at an exact version
- **WHEN** Settings is opened
- **THEN** it is listed as pinned at that version, and no update is offered for it

#### Scenario: AProjectPackageIsSaidToBeThisProjects
- **GIVEN** a package configured in the project's settings
- **WHEN** Settings is opened
- **THEN** it is listed as belonging to this project

#### Scenario: AnEmptyListOffersToAddAPackage
- **GIVEN** no npm pi package configured in either settings
- **WHEN** Settings is opened
- **THEN** the packages section says no package is installed and offers to add one

### Requirement: ANewerVersionIsFoundOrTheCheckSaysWhyNot

The system SHALL look up the newest published version of each listed unpinned package from the package registry the installation uses, after startup without delaying it, reusing a recent answer, and again when the user asks. A package with a newer published version SHALL show that version. A package whose newest version could not be looked up SHALL be shown as not checked, with the reason, and SHALL NOT be shown as up to date. The same settings that govern the pi-outpost check SHALL govern this one: with `updateCheck` off or `offline`, nothing is looked up and the list says so.

#### Scenario: ANewerVersionIsShown
- **GIVEN** an installed package at 33.0.1 and a published 33.1.0
- **WHEN** the check completes
- **THEN** the package shows 33.1.0 as available

#### Scenario: AFailedCheckIsNotUpToDate
- **GIVEN** a registry that cannot be reached
- **WHEN** the check runs
- **THEN** each package is shown as not checked with the reason, and none is shown as up to date

#### Scenario: CheckingOffLooksUpNothing
- **GIVEN** `updateCheck` set to false
- **WHEN** Settings is opened and the user asks to check
- **THEN** no registry is contacted, and the list says checking is off

### Requirement: UpdatingAPackageFromSettings

Updating a package SHALL require an explicit confirmation stating that code running with the agent's privileges changes, from the installed version to the newer one. It SHALL be refused while any started session that loads the package is running a turn or replacing its session, naming it, and nothing SHALL change. Once confirmed, the system SHALL install the newer version. A running server cannot load an extension's new code in place, so the package SHALL then be listed with its new installed version and as needing a restart to take effect, and the system SHALL NOT claim that the new version is running. An install that fails, or that installs nothing, SHALL leave the installed version in place and say why. When extension changes are locked by configuration, no update SHALL be offered, and the server SHALL refuse one.

#### Scenario: AConfirmedUpdateIsInstalledAndAsksForARestart
- **GIVEN** a package with a newer published version
- **WHEN** the user updates it and confirms
- **THEN** the newer version is installed, the list shows it as installed and needing a restart, and the result does not claim it is running

#### Scenario: NothingIsSentWithoutConfirmation
- **WHEN** the user starts an update and cancels the confirmation
- **THEN** no update request reaches the server

#### Scenario: AnUpdateWaitsForARunningTurn
- **GIVEN** a session that loads the package and is running a turn
- **WHEN** the update is requested
- **THEN** it is refused naming that session, and the installed version is unchanged

#### Scenario: AFailedInstallChangesNothing
- **WHEN** installing the newer version fails
- **THEN** the installed version is unchanged and the reason is shown

#### Scenario: LockedExtensionsOfferNoUpdate
- **GIVEN** extension changes locked by configuration
- **WHEN** Settings is opened, and when an update request arrives anyway
- **THEN** no update is offered, and the request is refused

### Requirement: RestartingTheServerLoadsWhatWasUpdated

A package whose installed version differs from the version the server loaded when it started SHALL be listed as needing a restart, whether it was updated from Settings or from a terminal; a package installed since the server started, or removed since, SHALL be too. The restart notice SHALL name each such package once, by its latest change, and SHALL drop a package whose state again matches what the server loaded. When any package needs a restart, the standalone interface SHALL offer to restart pi-outpost, with a confirmation saying that every connected client reconnects and conversations are kept. A restart SHALL be refused while any agent is running a turn, naming it. Once confirmed, the server SHALL stop, start again with the same command, arguments and environment in the same terminal, and the interface SHALL reconnect by itself, with the updated packages loaded. An embedded widget SHALL NOT offer it, and the server SHALL refuse a restart requested from a widget's connection.

#### Scenario: ARestartLoadsTheUpdatedPackage
- **GIVEN** a package updated from Settings and listed as needing a restart
- **WHEN** the user restarts pi-outpost and confirms
- **THEN** the interface reconnects, the agent's tools are the new version's, and the package no longer needs a restart

#### Scenario: ARestartWaitsForRunningTurns
- **GIVEN** an agent running a turn
- **WHEN** a restart is requested
- **THEN** it is refused naming that agent's project, and nothing stops

#### Scenario: AWidgetCannotRestartTheServer
- **GIVEN** an embedded widget connected from a host page
- **WHEN** it is shown, and when a restart request arrives from its connection anyway
- **THEN** it offers no restart, and the server refuses the request

#### Scenario: TheRestartNoticeNamesEachPackageOnce
- **GIVEN** a package removed from Settings, then restored before a restart
- **WHEN** the restart notice is shown
- **THEN** it does not name that package, since what runs is again what is configured

#### Scenario: ARestartUnloadsARemovedPackage
- **GIVEN** a package removed from Settings and listed as removed
- **WHEN** the user restarts pi-outpost and confirms
- **THEN** the interface reconnects, the agent no longer has the package's tools, and the package is no longer listed

### Requirement: TheTerminalUpdatesThePackages

The update command SHALL accept `--extensions`, which updates the agent's npm pi packages instead of pi-outpost, and `--all`, which updates both; no other command SHALL accept them. The packages SHALL be the agent directory's the server uses and the current directory's project. With `--check`, it SHALL report each package's installed and newest published version, and install nothing.

#### Scenario: TheCheckListsThePackagesAndInstallsNothing
- **GIVEN** a package installed at 1.0.0 with 1.1.0 published, and a package pinned at 2.0.0
- **WHEN** the operator runs `pi-outpost update --extensions --check`
- **THEN** it reports the first at 1.0.0 with 1.1.0 available and the second as pinned, and the installed versions are unchanged

#### Scenario: TheExtensionFlagsBelongToUpdate
- **WHEN** `--extensions` or `--all` is passed to another command
- **THEN** the command line is refused, naming `pi-outpost update` as their owner

### Requirement: TheTerminalInstallsWhatItReports

Without `--check`, the command SHALL install the newest version of each unpinned package that has one, and SHALL report a package as updated only when its installed version changed. It SHALL then say that the new versions run when pi-outpost restarts, and SHALL NOT claim that they are running.

#### Scenario: TheExtensionsAreUpdatedFromTheTerminal
- **GIVEN** a package installed at 1.0.0 in the agent directory named by `--agent-dir`, with 1.1.0 published
- **WHEN** the operator runs `pi-outpost update --extensions`
- **THEN** 1.1.0 is installed in that agent directory, the command reports the package updated to 1.1.0 and that it runs after a restart, and exits zero

#### Scenario: AnInstallThatInstallsNothingIsAFailure
- **GIVEN** a package with a newer version, and a package manager that returns without installing it
- **WHEN** the operator runs `pi-outpost update --extensions`
- **THEN** the command reports that the package is still at its installed version, and exits non-zero

### Requirement: TheTerminalKeepsSettingsRules

A pinned package SHALL be reported as pinned and left alone. A failed lookup SHALL be reported with its reason, never as up to date. Under `extensionLock` the command SHALL install nothing; with update checking off it SHALL look nothing up; either way it SHALL name the setting. It SHALL exit non-zero whenever something asked for was not done.

#### Scenario: AFailedLookupIsNotUpToDateInTheTerminal
- **GIVEN** a registry that cannot be reached
- **WHEN** the operator runs `pi-outpost update --extensions`
- **THEN** each package is reported as not checked with the reason, none as up to date, nothing is installed, and the command exits non-zero

#### Scenario: LockedExtensionsAreNotUpdatedFromTheTerminal
- **GIVEN** extension changes locked by configuration, and a package with a newer version
- **WHEN** the operator runs `pi-outpost update --extensions`
- **THEN** it installs nothing, says that `extensionLock` refused, and exits non-zero

#### Scenario: CheckingOffLooksUpNoPackage
- **GIVEN** update checking turned off by configuration
- **WHEN** the operator runs `pi-outpost update --extensions`
- **THEN** no registry is contacted, the command says which setting turned checking off, and exits non-zero

### Requirement: ThePackagesDoNotDependOnHowPiOutpostWasInstalled

Updating the packages SHALL NOT depend on how pi-outpost itself was installed. A plain update, which updates pi-outpost alone, SHALL name the packages that have a newer version and the command that updates them, and SHALL install none.

#### Scenario: AllUpdatesTheExtensionsEvenWhenPiOutpostIsRefused
- **GIVEN** pi-outpost running from a copy the update command cannot upgrade, and a package with a newer version
- **WHEN** the operator runs `pi-outpost update --all`
- **THEN** it says why pi-outpost was not upgraded, installs the newer package, and exits non-zero

#### Scenario: APlainUpdateNamesTheExtensionsBehind
- **GIVEN** a package with a newer published version
- **WHEN** the operator runs `pi-outpost update` without `--extensions` or `--all`
- **THEN** after its verdict on pi-outpost it names that package and `pi-outpost update --extensions`, and installs no package

### Requirement: APackageIsLookedUpBeforeItIsInstalled

Adding a package SHALL take an npm package name, optionally with a version, and SHALL look it up on the package registry the installation uses before offering to install it. A name the registry does not know, a name that is not a valid npm package name, or a package already configured in the chosen settings SHALL be refused with the reason, keeping what the user typed. Nothing SHALL be installed by the lookup.

#### Scenario: AnUnknownPackageIsRefusedInPlace
- **GIVEN** a registry that does not know `nope-xyz`
- **WHEN** the user asks to add `nope-xyz`
- **THEN** it is refused saying the registry does not know it, the field still holds `nope-xyz`, and nothing is installed

#### Scenario: AConfiguredPackageIsNotAddedTwice
- **GIVEN** `@gotgenes/pi-permission-system` configured in the agent's settings
- **WHEN** the user asks to add it to the agent's settings
- **THEN** it is refused saying it is already installed, and the list is unchanged

#### Scenario: ALookupUsesTheInstallationsRegistry
- **GIVEN** an installation whose npm configuration names a private registry
- **WHEN** the user asks to add a package
- **THEN** the lookup asks that registry, not the public one

### Requirement: AddingAPackageFromSettings

Installing a looked-up package SHALL require an explicit confirmation naming the package, the version to install and the settings it goes to, and saying that code running with the agent's privileges is added and takes effect on a restart. Once confirmed, the system SHALL install it and record it in those settings — the agent's by default, the project's when chosen — pinned when the user gave a version. The package SHALL then be listed as installed and needing a restart.

#### Scenario: AConfirmedInstallIsListedAndAsksForARestart
- **GIVEN** `openlore` published at 2.4.1 and not configured
- **WHEN** the user adds `openlore`, keeps the agent's settings, and confirms
- **THEN** the agent's settings configure `npm:openlore`, 2.4.1 is installed, and the list shows it as installed and needing a restart

#### Scenario: AProjectInstallGoesToTheProjectsSettings
- **WHEN** the user adds a package, chooses this project, and confirms
- **THEN** the project's settings configure it, the agent's settings do not, and it is listed as this project's

#### Scenario: AVersionGivenIsPinned
- **WHEN** the user adds `openlore@2.3.0` and confirms
- **THEN** 2.3.0 is installed and the package is listed as pinned at 2.3.0

#### Scenario: NoInstallWithoutConfirmation
- **WHEN** the user looks a package up and cancels the confirmation
- **THEN** no install request reaches the server, and the settings are unchanged

#### Scenario: AFailedInstallLeavesTheSettingsAlone
- **WHEN** installing the package fails, or installs nothing
- **THEN** the settings do not configure it, the reason is shown, and nothing is said to need a restart

### Requirement: RemovingAPackageFromSettings

Removing a package SHALL require an explicit confirmation naming the package and the settings it is removed from, and saying that the agent keeps running it until pi-outpost restarts. Once confirmed, the system SHALL remove it from those settings and uninstall it. A running server cannot unload an extension, so the package SHALL stay listed as removed and still running until a restart, and SHALL NOT be offered for update while removed.

#### Scenario: AConfirmedRemovalIsListedUntilARestart
- **GIVEN** `pi-landstrip` configured in the project's settings
- **WHEN** the user removes it and confirms
- **THEN** the project's settings no longer configure it, it is uninstalled, and the list shows it as removed and still running until a restart

#### Scenario: NoRemovalWithoutConfirmation
- **WHEN** the user starts a removal and cancels the confirmation
- **THEN** no removal request reaches the server, and the package is unchanged

#### Scenario: AFailedRemovalChangesNothing
- **WHEN** removing the package fails
- **THEN** the package is still configured and installed, and the reason is shown

### Requirement: ARemovedPackageCanBeRestoredBeforeARestart

Until pi-outpost restarts, a removed package SHALL offer to undo the removal, which SHALL configure it again in the same settings at the version the server loaded, without a second confirmation since the code is already running. Asking to add a package that is listed as removed SHALL be refused, pointing at the undo.

#### Scenario: UndoRestoresWhatIsRunning
- **GIVEN** `pi-landstrip` 0.9.0 removed from the project's settings, no restart since
- **WHEN** the user undoes the removal
- **THEN** the project's settings configure it again, 0.9.0 is installed, and it is listed as up to date with nothing waiting on a restart for it

#### Scenario: AddingARemovedPackagePointsAtUndo
- **GIVEN** a package listed as removed
- **WHEN** the user asks to add the same package
- **THEN** it is refused saying it was removed and still runs, pointing at undo, and no second entry appears

### Requirement: PackageChangesFollowTheUpdatesRules

Installing, removing and restoring a package SHALL be refused, with nothing changed, when extension changes are locked by configuration — and no such action SHALL be offered — and while a started session that loads that settings scope (every session for the agent's settings, the project's sessions for the project's) is running a turn or replacing its session, naming it. Only one change to a given package SHALL run at a time; a second request for it while one runs SHALL be refused.

#### Scenario: LockedExtensionsOfferNoInstallOrRemoval
- **GIVEN** extension changes locked by configuration
- **WHEN** Settings is opened, and when install, remove or restore requests arrive anyway
- **THEN** no add, remove or undo action is offered, and each request is refused

#### Scenario: AnInstallWaitsForARunningTurn
- **GIVEN** a session running a turn
- **WHEN** an install to the agent's settings is requested
- **THEN** it is refused naming that session, and the settings are unchanged

#### Scenario: ADoubleConfirmationInstallsOnce
- **WHEN** the user confirms an install twice in quick succession
- **THEN** one install runs, the package is configured once, and the list shows one entry for it

### Requirement: ThePackagesSectionStaysStill

The packages section SHALL use one text size, and its actions SHALL keep their labels and places while they run and after they end: progress and outcomes SHALL be shown in the package's status line, and a refusal while adding SHALL appear without moving the field or its buttons.

#### Scenario: AnUpdateInProgressMovesNothing
- **GIVEN** two listed packages, the first with a newer version
- **WHEN** the user updates the first, and when the update completes
- **THEN** the first package's name, the remove actions and the add action keep their positions, and the first package's status line shows the progress and then the outcome

#### Scenario: ARefusalDoesNotMoveTheForm
- **WHEN** adding a package is refused
- **THEN** the field and its buttons keep their positions, and the reason is shown below them
