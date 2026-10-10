## ADDED Requirements

### Requirement: TheSandboxMayNameARunnerForBash

The configuration's `sandbox` MAY declare `bashRunner`, the path of a sandbox runner (resolved against
the configuration file), and `bashShell`, the shell its commands run in. `bashRunner` SHALL apply only
while `allowBash` is on. Declaring both `bashRunner` and `bashFrom` SHALL be refused when the
configuration loads.

#### Scenario: BashRunnerAndBashFromAreExclusive
- **WHEN** the configuration declares `sandbox.bashRunner` and `sandbox.bashFrom` together
- **THEN** it is refused, naming both settings

#### Scenario: TheRunnerPathIsResolved
- **WHEN** the configuration declares a relative `sandbox.bashRunner` and `sandbox.bashShell`
- **THEN** both load as absolute paths, resolved against the configuration file's directory

### Requirement: EveryBashCommandRunsInsideTheRunner

While `allowBash` is on and `bashRunner` is set, every command the agent runs with `bash` SHALL run
inside the runner, in `bashShell`, with the policy of a confined terminal in the same workspace: reading
limited to the sandbox root (and what the runner needs to run the shell), writing limited to the writable
zone and a private temporary directory, the agent directory and the configuration unreadable. The
command's output, exit status, timeout and cancellation SHALL behave as for an unconfined `bash`.

#### Scenario: ACommandCannotReadOutsideTheRoot
- **GIVEN** `bash` confined by a runner, in a workspace whose sandbox root is `app`
- **WHEN** the agent runs a command reading a sibling project's file, then the agent directory's `auth.json`
- **THEN** both reads are refused, and neither file's content reaches the agent

#### Scenario: ACommandWritesOnlyInTheWritableZone
- **GIVEN** `bash` confined by a runner, with sandbox root `app` and writable zone `app/out`
- **WHEN** the agent writes a file in `app/out`, then in `app`
- **THEN** the first file exists and the second write is refused

#### Scenario: OutputAndExitStatusComeBack
- **GIVEN** `bash` confined by a runner
- **WHEN** the agent runs a command that prints to standard output and to standard error, then exits with status 3
- **THEN** the agent receives both outputs and the command is reported as failed with status 3

#### Scenario: CancellingACommandEndsIt
- **GIVEN** `bash` confined by a runner, running a command that sleeps for a minute
- **WHEN** the call is aborted or its timeout expires
- **THEN** the call ends promptly and the confined command no longer runs

### Requirement: AConfinedCommandGetsAMinimalEnvironment

A command run by a confined `bash` SHALL receive the environment of a confined terminal — search path,
locale, terminal type, shell, a home inside the sandbox root, a private temporary directory, and on
Windows the system's locations — and SHALL NOT receive the server's other variables, provider keys
included.

#### Scenario: KeysDoNotReachTheAgentsCommands
- **GIVEN** the server started with `OPENAI_API_KEY` in its environment and `bash` confined by a runner
- **WHEN** the agent lists its command's environment
- **THEN** `OPENAI_API_KEY` is absent

### Requirement: AnUnusableRunnerRefusesEveryCommand

When `bashRunner` is set but the runner is missing, fails its self-check, or (on Windows) no `bashShell`
is named, every `bash` call SHALL be refused with the reason, and no command SHALL run, confined or not.
The session SHALL start and its other tools SHALL keep working.

#### Scenario: AMissingRunnerRefusesTheCommand
- **GIVEN** `sandbox.bashRunner` pointing at a path that does not exist
- **WHEN** the agent calls `bash`
- **THEN** the call fails with a reason naming that path, and the command did not run

#### Scenario: AFailedSelfCheckRefusesTheCommand
- **GIVEN** `sandbox.bashRunner` pointing at a runner whose self-check fails
- **WHEN** the agent calls `bash`
- **THEN** the call fails with the runner's reason, and the command did not run

### Requirement: SettingsPreserveTheRunner

Applying sandbox settings from the browser SHALL keep `bashRunner` and `bashShell`, which Settings do not
edit.

#### Scenario: ApplyingSettingsKeepsTheRunner
- **GIVEN** `sandbox.bashRunner` and `sandbox.bashShell` in the configuration
- **WHEN** the browser applies a sandbox change (turning `allowWrite` off)
- **THEN** the running configuration still names the same runner and shell, and `bash` is still confined
