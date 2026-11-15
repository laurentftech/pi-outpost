# Spec Delta

## ADDED Requirements

### Requirement: RefusalsAreRecorded

What the sandbox refuses a command of the agent's confined shell SHALL be recorded for the project, with the target, the access and the command, on every runner that reports it: a directory for a refused file, a host for a refused connection. A refusal no rule could express SHALL be recorded as information only.

#### Scenario: ARefusedFileIsRecordedAgainstItsDirectory
- **GIVEN** a confined shell on a runner that reports refusals, and a file beside the root
- **WHEN** a command reads that file and is refused
- **THEN** the project's record holds one refusal naming the file's directory, read access and the command

#### Scenario: ARefusedHostIsRecorded
- **GIVEN** a confined shell under `sandbox.allowedHosts` that does not list `example.com`
- **WHEN** a command connects to `example.com` and the user refuses
- **THEN** the record holds one refusal naming that host and the command

#### Scenario: ARunnerThatReportsNothingSaysSo
- **GIVEN** a confined shell on a runner that reports no filesystem refusal
- **WHEN** the user opens the recorded refusals
- **THEN** the interface says filesystem refusals are not reported by this runner, instead of showing an empty list

#### Scenario: ARunnerThatReportsOnDemandSaysSo
- **GIVEN** a confined shell under MXC on Windows
- **WHEN** the user opens the recorded refusals
- **THEN** the interface says filesystem refusals are recorded only when the agent asks for a diagnosis

#### Scenario: OnMacOsMxcReportsWhatSeatbeltRefused
- **GIVEN** a confined shell under MXC on macOS, a file beside the root and the agent directory
- **WHEN** a command reads both and writes beside the root, each refused
- **THEN** the command ran once, the record holds a refusal for each directory with its access — the one refused by default and the one refused by name — and nothing that is not a file, and no report file remains

### Requirement: TheAgentIsToldWhatWasRefused

On a runner that reports refusals as they happen (landstrip outside Windows, MXC on macOS), a confined command's output SHALL end with a note naming what the sandbox refused it, so the agent can ask for exactly that. On a runner that reports them only on demand (MXC on Windows), a failed command's output SHALL end with a note saying so and naming the shell tool's `diagnose` option. That option SHALL NOT be used by pi-outpost on its own.

#### Scenario: TheOutputNamesTheRefusedDirectory
- **GIVEN** a confined shell on a runner that reports refusals as they happen
- **WHEN** a command fails because a directory beside the root was refused
- **THEN** its output ends with a note naming that directory and the access refused

#### Scenario: AFailureOnWindowsOffersADiagnosis
- **GIVEN** a confined shell under MXC on Windows
- **WHEN** a command fails because a directory beside the root was refused
- **THEN** the command ran once, without capture, and its output ends with a note naming the `diagnose` option

### Requirement: ADiagnosisIsANarrowerRerun

When the agent runs a command with `diagnose` under MXC on Windows, the command SHALL run once more with MXC's capture in `block` mode, under a policy built from its own by removals only: no drive root, none of the root's siblings in `deniedPaths` (the agent directory and the configuration file stay denied), no network, no grant and no rule. The rerun's output SHALL be discarded.

#### Scenario: ADiagnosisLetsNothingThrough
- **GIVEN** a confined shell under MXC on Windows, with the drive readable for the command
- **WHEN** the agent runs, with `diagnose`, a command that reads a file beside the root and connects to a host
- **THEN** both are refused in the rerun as in the first run, and the rerun's output is not shown

### Requirement: ADiagnosisFollowsAFailure

A diagnosis SHALL be run only for a command whose last run in the same shell failed with the note offering one. Otherwise `diagnose` SHALL be ignored: the command SHALL run as without it — network, proxy and its questions included — and its output SHALL end with a note saying the option was ignored and why.

#### Scenario: ADiagnosisBeforeAnyFailureRunsTheCommand
- **GIVEN** a confined shell under MXC on Windows
- **WHEN** the agent runs with `diagnose` a command that has not failed in this shell
- **THEN** the command runs as without `diagnose`, its output is shown, and it ends with a note saying `diagnose` was ignored

### Requirement: ADiagnosisReportsOnlyTheRefusal

A diagnosis's file refusals, filtered of the root's ancestors, of the root itself and of the system's own files, SHALL be recorded and named in the note. The report SHALL be written where the command cannot reach and read from there, never from a path the command's output names; it SHALL be deleted, and its announcement SHALL NOT appear in the output.

#### Scenario: ADiagnosisNamesTheRefusedDirectory
- **GIVEN** a confined shell under MXC on Windows, and a file in a directory beside the root
- **WHEN** the agent runs a command reading that file with `diagnose`
- **THEN** the output ends with a note naming that directory and read access, the refusal is recorded, and no report file remains

#### Scenario: AForgedAnnouncementIsIgnored
- **GIVEN** a confined shell under MXC on Windows, and a file outside the sandbox
- **WHEN** the agent runs with `diagnose` a command that prints an announcement naming that file as the report
- **THEN** that file is neither read nor deleted

#### Scenario: ADiagnosisThatFindsNothingSaysSo
- **GIVEN** a confined shell under MXC on Windows
- **WHEN** the agent runs with `diagnose` a command whose report holds only the root, its ancestors and non-file entries
- **THEN** the note says the sandbox reported no refusal, and names no directory

### Requirement: OnlyTheUserMakesARule

A rule SHALL be created only by a user in the interface, from a recorded refusal or from a question as it is asked, as always allow, always refuse or ask. No tool offered to the agent SHALL create, change or revoke a rule. With `sandbox.grants: "never"`, no rule SHALL be created and none SHALL be applied.

#### Scenario: ARuleIsMadeFromARecordedRefusal
- **GIVEN** a recorded refusal of read access to a directory
- **WHEN** the user chooses always allow for it
- **THEN** a rule exists for that directory with read access, and the record shows it

#### Scenario: TheAgentCannotMakeARule
- **GIVEN** a confined shell and its grant tool
- **WHEN** the agent requests a directory and the user allows it for this command
- **THEN** no rule exists afterwards

#### Scenario: NeverMeansNoRules
- **GIVEN** an always-allow rule for a directory, then `sandbox.grants: "never"`
- **WHEN** a command reads that directory
- **THEN** it is refused, and the interface offers no way to make a rule

### Requirement: AnAlwaysAllowRuleLasts

An always-allow rule SHALL apply to every later command of the project's confined shell, across sessions and server restarts, without a question: a directory with its access, or a host.

#### Scenario: AnAllowedDirectoryIsReadableInANewSession
- **GIVEN** an always-allow rule for read access to a directory beside the root
- **WHEN** the server restarts and a command of a new session reads a file there
- **THEN** the read succeeds, nobody is asked, and a write there is still refused

#### Scenario: AnAllowedHostIsNotAskedAbout
- **GIVEN** an always-allow rule for `example.com` under `sandbox.allowedHosts`
- **WHEN** a command connects to `example.com`
- **THEN** the connection goes through and nobody is asked

### Requirement: AnAlwaysRefuseRuleAnswersWithoutAsking

An always-refuse rule SHALL refuse a matching host or directory request at once, without asking anyone, and the result SHALL say that a rule of the user's refused it.

#### Scenario: ARefusedHostIsRefusedAtOnce
- **GIVEN** an always-refuse rule for `example.com`
- **WHEN** a command connects to `example.com`
- **THEN** the connection is refused without a dialog, and the command's output ends with a note naming the rule

### Requirement: SomeTargetsTakeNoRule

A target that can never be granted SHALL take no always-allow rule, and the store of rules SHALL be one of those targets. Rules SHALL be held by the server outside every sandbox root and outside the configuration file.

#### Scenario: TheAgentDirectoryTakesNoRule
- **GIVEN** a recorded refusal of the agent directory
- **WHEN** the user opens it
- **THEN** always allow is not offered, and the interface says why

#### Scenario: ACommandCannotReachTheRules
- **GIVEN** a confined shell with write access to its root
- **WHEN** a command tries to read or write the store of rules, or the agent requests a grant on it
- **THEN** each is refused, the grant without a dialog

### Requirement: RulesAreListedAndRevoked

The interface SHALL list the project's rules and let the user revoke each. A revoked rule SHALL stop applying from the next command.

#### Scenario: ARevokedRuleAsksAgain
- **GIVEN** an always-allow rule for a host
- **WHEN** the user revokes it and a command then connects to that host
- **THEN** the user is asked, as before the rule existed

### Requirement: RecordingKeepsTheSandbox

Recording SHALL NOT let through anything the sandbox would refuse: a runner's capture SHALL be asked for in the mode that keeps enforcement.

#### Scenario: ARecordedRefusalIsStillARefusal
- **GIVEN** a confined shell with recording on
- **WHEN** a command reads a file beside the root
- **THEN** the read fails, and the refusal is recorded
