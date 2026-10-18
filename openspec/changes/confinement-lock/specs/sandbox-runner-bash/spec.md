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
