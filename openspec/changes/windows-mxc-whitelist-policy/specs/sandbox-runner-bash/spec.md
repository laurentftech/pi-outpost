# Spec Delta

## ADDED Requirements

### Requirement: TheWindowsMxcPolicyIsAWhitelist

Under MXC on Windows, the agent shell's policy SHALL make readable or writable only what a command opens
(root, temporary directory, shell's folder, tools, a junction's target, grants) and Windows' own folders,
never a drive root. Each such path's drive root, and every folder above a tool or a grant, SHALL be
enumerable, never readable. Only the agent directory and the configuration file SHALL be denied.

#### Scenario: TheWindowsMxcPolicyIsAWhitelist
- **GIVEN** the project root on `L:\Python\app`, the system temporary directory `C:\Users\me\AppData\Local\Temp`, scoop on `L:\WRK\Scoop` with `apps\nodejs\current` a junction to `apps\nodejs\<version>`, and a Python installation under `C:\Users\me\AppData\Local\Programs\Python`, both on `PATH`
- **WHEN** the policy is built for a command of the confined shell at enumeration level 0
- **THEN** neither `C:\` nor `L:\` is in `readonlyPaths`; both are in `enumeratePaths`, each once whatever its case, with `C:\Users`, `C:\Users\me`, `…\AppData`, `…\AppData\Local`, `L:\WRK` and `L:\WRK\Scoop`, none of which is in `readonlyPaths`; no readable path holds a folder beside the temporary directory; the junction's target is readable and the junction is not enumerated; `deniedPaths` holds exactly the agent directory and the configuration file

#### Scenario: ToolsFoundWithoutPathStillRun
- **GIVEN** the agent's PowerShell confined by MXC on Windows 11 tier 1, rustup's toolchain on `PATH` and MSVC installed under `Program Files`
- **WHEN** a command creates a crate with a registry dependency and runs `cargo test`
- **THEN** rustc finds MSVC's `link.exe` and the tests pass: `Windows`, `Program Files` and `ProgramData` are readable, as they were under the drive-readable policy

#### Scenario: ALevelLowerDropsOnlyTheGrantsWayDown
- **GIVEN** the policy for a root on `L:\Python\app` with a write grant `C:\Users\me\AppData\Local\pi-outpost\sandbox-cache`
- **WHEN** it is built at enumeration level 0, 1 and 2
- **THEN** level 0 enumerates `…\AppData\Local\pi-outpost`; level 1 does not, but still enumerates `C:\` and `L:\`; level 2 asks for no enumeration at all

#### Scenario: NothingBesideTheWayDownIsReadable
- **GIVEN** the agent's PowerShell confined by MXC on Windows 11 tier 1 under that policy, the root on another drive than the profile, and a file in a fresh folder beside the command's temporary directory under `%TEMP%`
- **WHEN** a command reads that file, then runs `node` on a file in the root, `npm --version` and `git status`
- **THEN** the read is refused; `node`, `npm` and `git` run, and Node resolves its real path

### Requirement: AHostWithoutEnumerationHasNoMxcShell

Under MXC on Windows, when Windows refuses to build the process security environment for the policy at
enumeration level 1 — or the host is known to take no enumeration at all — the agent's shell SHALL be
unavailable with the reason, rather than run under a policy with nothing enumerable or with a deny list.
A refusal at level 0 SHALL step to level 1 once, as before, and once level 1 has run on a host, no policy
built afterwards on that host SHALL ask past it.

#### Scenario: AHostWithoutEnumerationHasNoMxcShell
- **GIVEN** the agent's shell confined by MXC on Windows, and a host where `CreateProcessSecurityEnvironment` fails with `0x80070005` on the level-0 policy and on the level-1 policy
- **WHEN** a command runs
- **THEN** it is replayed once at level 1, then reported as refused with the reason (`sandbox.bashRunner`), nothing having run unconfined; no policy without `enumeratePaths` and no pruned deny list is sent

#### Scenario: AHostKnownWithoutEnumerationSendsNothing
- **GIVEN** the agent's shell confined by MXC on Windows, on a host already known to take no enumeration (level 2)
- **WHEN** a command runs, or the confinement canary checks the shell
- **THEN** nothing is sent to MXC: the command is refused with the reason, and the canary reports it instead of a verdict

## REMOVED Requirements

### Requirement: ARefusedSecurityEnvironmentStepsEnumerationDown

**Reason**: Level 2 (no enumeration) cannot run a tool beside the root under a whitelist; it is replaced
by the shell being unavailable (`AHostWithoutEnumerationHasNoMxcShell`).

**Migration**: none — a host that needed level 2 gets the reason at startup and can set
`sandbox.bashRunner: "none"`.

### Requirement: AToolOnAnotherDriveThanTheRootsResolves

**Reason**: The way down a foreign drive was readable, which opened everything beside it once nothing was
denied. It is enumerable under `TheWindowsMxcPolicyIsAWhitelist`, measured to resolve the tools.

**Migration**: none.

### Requirement: AToolBesideTheRootResolves

**Reason**: Folded into `TheWindowsMxcPolicyIsAWhitelist`: the way down is enumerable on every drive, and
nothing in an enumerated folder is denied by name any more.

**Migration**: none.

### Requirement: AToolBehindALinkOnTheWayDownResolves

**Reason**: Folded into `TheWindowsMxcPolicyIsAWhitelist` (the junction's target readable, the junction not
enumerated); the beside-the-way denies it described are gone.

**Migration**: none.

### Requirement: StrictDeniesKeepOnlyOpenableEntries

**Reason**: There is no deny list to prune. Added by the unarchived change
`windows-strict-denies-on-security-environment-refusal`, archived before this one.

**Migration**: none.

### Requirement: ForeignWayDownDeniedWithoutEnumeration

**Reason**: The foreign way down is no longer readable, so nothing beside it needs denying. Added by
`windows-foreign-drive-denied-at-every-level`, archived before this one.

**Migration**: none.

### Requirement: BesideTheForeignWayDownStaysDenied

**Reason**: As above. Added by `windows-foreign-drive-beside-denied`, archived before this one.

**Migration**: none.
