# Npm Install Security Specification

## Purpose

Keeps npm 12 installations secure while allowing the reviewed native scripts pi-outpost needs for its terminal and sandbox to build and run.

## Requirements

### Requirement: ReviewedRepositoryScriptPolicy
The repository SHALL use pinned npm 12.2.2 and explicitly review dependency lifecycle scripts.
An unreviewed script SHALL fail repository installation before execution.

#### Scenario: UnreviewedRepositoryScriptsFailClosed
- **GIVEN** a strict npm project and a package with an unreviewed postinstall script
- **WHEN** npm installs the package
- **THEN** it fails with ESTRICTALLOWSCRIPTS and the script does not execute
### Requirement: ConsumerNativeInstallations
Documented global and npx installations SHALL authorize the terminal and sandbox native scripts
without permitting unrelated dependency lifecycle code.

#### Scenario: ConsumerInstallsKeepTheirTerminal
- **GIVEN** a freshly packed CLI and empty global/npx caches
- **WHEN** each documented installation mode installs the package with selective script approval
- **THEN** the installed CLI reports its version and its native PTY executes a command successfully

#### Scenario: UnapprovedDependencyScriptsStayBlocked
- **GIVEN** a package with a postinstall script installed alongside the CLI
- **WHEN** global or npx installation approves only node-pty and koffi
- **THEN** the unrelated script does not execute
### Requirement: NativePermissionsSurviveGlobalUpdates
The global updater SHALL preserve selective native script approval and existing registry isolation.

#### Scenario: WindowsUpdatesKeepRegistryDataOutOfTheShell
- **GIVEN** a global Windows installation and a custom registry containing shell metacharacters
- **WHEN** an update is requested
- **THEN** the fixed npm command approves only node-pty and koffi and passes the registry through the environment
