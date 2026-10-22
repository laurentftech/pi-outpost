## ADDED Requirements

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
