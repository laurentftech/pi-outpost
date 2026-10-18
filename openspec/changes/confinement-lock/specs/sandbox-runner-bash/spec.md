## ADDED Requirements

### Requirement: ConfinementIsVerifiedBeforeItIsShown

When `sandbox.bashRunner` is set and its self-check passes, the server SHALL run a canary through that
runner, with the agent shell's policy, attempting what confinement must refuse (see design: the agent
directory, beside the root, a signal, the server's environment, an unlisted host). It SHALL run again
when the sandbox settings change; its verdict SHALL be sent to clients.

#### Scenario: AVerifiedRunnerEarnsTheLock
- **GIVEN** a configured runner that refuses every attempt of the canary
- **WHEN** the interface shows the agent's shell
- **THEN** a closed lock is shown, and its description names the runner, when it was checked, and each refusal

#### Scenario: ALeakOpensTheLockAndSaysWhat
- **GIVEN** a configured runner whose policy lets the canary read the agent directory
- **WHEN** the canary runs
- **THEN** the lock is shown open and marked as a failure, naming the agent directory as readable, and the configuration is left as it was

#### Scenario: NoRunnerNoLock
- **GIVEN** no `sandbox.bashRunner`
- **WHEN** the interface shows the agent's shell
- **THEN** no lock is shown

### Requirement: DoctorRunsTheCanary

`pi-outpost doctor` SHALL run the canary for each runner the configuration names and report, per
attempt, whether it was refused; any attempt that succeeded SHALL be a failed check.

#### Scenario: DoctorReportsWhatGotThrough
- **GIVEN** a configuration whose runner lets a write beside the root succeed
- **WHEN** `pi-outpost doctor` runs
- **THEN** its report holds a failed check naming the write beside the root, and its exit status is non-zero

### Requirement: AReadableServerEnvironmentIsJudgedByWhatItHolds

When the only attempt that got through is reading the server's process environment (the known gap of
landstrip on Linux), the verdict SHALL depend on what that environment holds: with no secret-looking
variable, the lock SHALL be shown closed and say the environment is readable but holds no secret; with
some, it SHALL be shown partly confined, naming those variables and never their values.

#### Scenario: AReadableEnvironmentWithoutSecretsKeepsTheLock
- **GIVEN** a runner under which a command can read the server's process environment, and a server environment with no key, token, secret or password
- **WHEN** the canary runs
- **THEN** the lock is closed, and its description says the server's environment is readable and holds no secret

#### Scenario: SecretsInAReadableEnvironmentAreNamed
- **GIVEN** the same runner, and a server started with `OPENAI_API_KEY` in its environment
- **WHEN** the canary runs
- **THEN** the lock is shown partly confined, naming `OPENAI_API_KEY` and not its value, and `doctor` reports it as a warning
