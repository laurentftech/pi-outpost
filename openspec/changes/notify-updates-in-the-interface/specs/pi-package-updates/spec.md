## Purpose

Lets a user see which pi packages the agent loads, whether a newer version of each is published, and update one from Settings — so extensions such as a permission system or OpenLore stay current without a terminal.

## ADDED Requirements

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
