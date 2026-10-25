## Purpose

A single-file pi-outpost: the server and the built web interface inside one
executable that carries its own runtime, so a machine with nothing installed can run
it. Covers how one is obtained — built from the installed package, or downloaded
from a release — and what it must contain, refuse, and say for itself.

## Requirements

### Requirement: OneCommandProducesAnExecutable

Building a standalone executable from an installed package SHALL take one command
and no hand-written files. The system SHALL generate the build configuration itself,
including every detail whose absence produces a failure the operator cannot read:
the module format the bundle requires, an encoding the runtime's own parser accepts,
and an output name the platform will execute.

On completion it SHALL print the path of the executable it produced. The executable
SHALL run on the machine that built it without further steps.

#### Scenario: BuildingFromTheInstalledPackage
- **GIVEN** the package installed and a runtime new enough to build one
- **WHEN** the operator runs the build command
- **THEN** an executable is produced, its path is printed, and running it with `--version` prints the package's version

#### Scenario: TheOutputIsNamedForItsPlatform
- **WHEN** an executable is built on a platform whose loader requires a particular file name
- **THEN** the produced file carries it, rather than requiring the operator to know

#### Scenario: NoConfigurationIsWrittenByHand
- **WHEN** an executable is built
- **THEN** the operator writes no build configuration file, and none of the generated file's content is theirs to get right

### Requirement: TheBuildRefusesRatherThanShipBroken

The build SHALL refuse, naming what is wrong and what to do, rather than produce an
artifact that fails later:

- a runtime too old to build one, where it SHALL say which version is needed and
  offer the path that works without it;
- a missing or unbuilt bundle;
- an existing file at the target path, unless overwriting was asked for.

Where the platform requires a signature for a modified binary to launch at all, the
build SHALL apply one. A signature is not optional presentation: without it the
executable is killed on start, and the operating system's message names neither the
signature nor the remedy.

#### Scenario: ARuntimeTooOldToBuild
- **GIVEN** a runtime older than the one the direct build needs
- **WHEN** the operator runs the build command
- **THEN** it either completes by the fallback path or exits non-zero naming the required version — and in neither case leaves a broken executable behind

#### Scenario: RefusingToOverwrite
- **GIVEN** a file already at the target path
- **WHEN** the operator runs the build command without asking for an overwrite
- **THEN** it exits non-zero, leaves the file untouched, and names the option that would replace it

#### Scenario: TheExecutableLaunchesOnAPlatformThatChecksSignatures
- **WHEN** an executable is built on a platform that refuses to launch a binary whose signature no longer matches it
- **THEN** the produced executable launches

### Requirement: ExecutablesAreAttachedToEveryRelease

Every published release SHALL carry a standalone executable for each supported
platform, built for that platform, and named so that which one to download is
legible without reading documentation. An operator SHALL be able to obtain a working
pi-outpost with no runtime installed and no build step.

The release page SHALL therefore be a complete answer for an operator running a
single-file executable, which is what the update path points them at.

#### Scenario: DownloadAndRunWithNothingInstalled
- **GIVEN** a machine with no Node runtime and no pi-outpost installation
- **WHEN** the operator downloads the executable for their platform from a release and runs it
- **THEN** the server starts and serves the web interface

#### Scenario: EveryReleaseCarriesThem
- **WHEN** a release is published
- **THEN** it carries one executable per supported platform, and a release missing them is a failed release rather than a quiet omission

#### Scenario: ThePlatformIsLegibleFromTheName
- **WHEN** an operator looks at a release's files
- **THEN** each executable's name states the operating system and architecture it is for

### Requirement: AnExecutableSaysWhatItCarries

A standalone executable SHALL contain the server and the built web interface, and
SHALL serve the interface from inside itself with nothing beside it on disk.

What it does not carry SHALL be stated rather than discovered: the bundled skills
live on the filesystem and are not embedded, so an executable starts without them
unless it is pointed at a directory holding them. This degrades rather than breaks —
the tools work; what is missing is the instruction that makes a producer's first
attempt valid.

#### Scenario: TheInterfaceIsInside
- **GIVEN** an executable alone in an empty directory
- **WHEN** it is run
- **THEN** it serves the web interface without any other file being present

#### Scenario: SkillsAreAbsentAndSaidToBe
- **WHEN** an executable runs with no skills directory configured
- **THEN** it starts and works, and the documentation states that the bundled skills are not inside it and how to supply them

### Requirement: ADoubleClickedExecutableIsAWholeApplication

Launching a standalone executable the way a person launches an application — from a
file manager, with no terminal — SHALL land them in the interface. The general rule
lives with the command surface (`StartingOpensTheInterface`); what this adds is that
the executable's own default SHALL be to open, since there is no terminal for it to
print an address to that anyone would read.

#### Scenario: LaunchedFromAFileManager
- **WHEN** a person double-clicks the executable on a desktop machine
- **THEN** the browser opens on the interface, served by that executable, with no other step

#### Scenario: TheSameExecutableOnAServer
- **GIVEN** the same executable run over a remote shell with no desktop session
- **THEN** it starts and prints its address, and opens nothing

### Requirement: TheAgentsToolsWorkInsideTheExecutable

Inside the standalone executable, with nothing installed and no file beside it, the agent SHALL read an image and pass it to the model as an image, and SHALL run a codemode script, as it does from an installed package. A build whose bundled SDK no longer loads these the way the build expects SHALL fail rather than produce an executable without them.

#### Scenario: AnImageReadInTheExecutableReachesTheModel
- **GIVEN** the executable's bundle, run from a directory with no `node_modules` and no file beside it
- **WHEN** the agent reads a PNG with `read`
- **THEN** the result holds the image itself, not "[Image omitted …]", and the model's request carries it

#### Scenario: ACodemodeScriptRunsInTheExecutable
- **GIVEN** the executable's bundle, run from a directory with no `node_modules` and no file beside it
- **WHEN** the agent runs the codemode script `return 6 * 7`
- **THEN** the script completes and its output is `42`
