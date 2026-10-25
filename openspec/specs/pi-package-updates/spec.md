# Pi Package Updates Specification

## Purpose

Lets a user see which pi packages the agent loads, whether a newer version of each is published, and update one from Settings — so extensions such as a permission system or OpenLore stay current without a terminal.

## Requirements

### Requirement: TheLoadedPackagesAreListedWithTheirVersions

Settings SHALL list every npm pi package configured for the agent — in the agent directory's settings and in the project's — with its name, its installed version, and whether its version is pinned. A configured package that is not installed SHALL be listed as not installed.

#### Scenario: AnInstalledPackageIsListed
- **GIVEN** the agent directory's settings configure `npm:@gotgenes/pi-permission-system`, installed at 33.0.1
- **WHEN** Settings is opened
- **THEN** it lists `@gotgenes/pi-permission-system` at 33.0.1

#### Scenario: APinnedPackageIsSaidToBePinned
- **GIVEN** a package configured at an exact version
- **WHEN** Settings is opened
- **THEN** it is listed as pinned at that version, and no update is offered for it

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

A package whose installed version differs from the version the server loaded when it started SHALL be listed as needing a restart, whether it was updated from Settings or from a terminal. When any package needs a restart, the standalone interface SHALL offer to restart pi-outpost, with a confirmation saying that every connected client reconnects and conversations are kept. A restart SHALL be refused while any agent is running a turn, naming it. Once confirmed, the server SHALL stop, start again with the same command, arguments and environment in the same terminal, and the interface SHALL reconnect by itself, with the updated packages loaded. An embedded widget SHALL NOT offer it, and the server SHALL refuse a restart requested from a widget's connection.

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
