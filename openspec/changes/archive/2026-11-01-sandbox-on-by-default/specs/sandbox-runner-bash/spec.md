# Spec Delta

## MODIFIED Requirements

### Requirement: TheSandboxMayNameARunnerForBash

The configuration's `sandbox` MAY declare `bashRunner`, the path of a sandbox runner (resolved against
the configuration file), and `bashShell`, the shell its commands run in. `bashRunner` SHALL apply only
while `allowBash` is on. Declaring both `bashRunner` and `bashFrom` SHALL be refused when the
configuration loads. The values `"auto"` and `"none"` SHALL NOT be resolved as paths: `"auto"` asks
the server to choose a runner (see `sandbox-defaults`), and `"none"` runs the shell unconfined.

#### Scenario: BashRunnerAndBashFromAreExclusive
- **WHEN** the configuration declares `sandbox.bashRunner` and `sandbox.bashFrom` together
- **THEN** it is refused, naming both settings

#### Scenario: TheRunnerPathIsResolved
- **WHEN** the configuration declares a relative `sandbox.bashRunner` and `sandbox.bashShell`
- **THEN** both load as absolute paths, resolved against the configuration file's directory

#### Scenario: AutoAndNoneAreNotPaths
- **WHEN** the configuration declares `sandbox.bashRunner` as `"auto"`, then as `"none"`
- **THEN** each loads as that keyword, not as a path under the configuration file's directory

### Requirement: ConfinementIsVerifiedBeforeItIsShown

When `sandbox.bashRunner` is set and its self-check passes, the server SHALL run a canary through that
runner, with the agent shell's policy, attempting what confinement must refuse (see design: the agent
directory, beside the root, a signal, the server's environment, an unlisted host). It SHALL run again
when the sandbox settings change; its verdict SHALL be sent to clients. An unconfined shell (`"none"`,
or `allowBash` without a runner in an explicit section) SHALL be shown with an open lock.

#### Scenario: AVerifiedRunnerEarnsTheLock
- **GIVEN** a configured runner that refuses every attempt of the canary
- **WHEN** the interface shows the agent's shell
- **THEN** a closed lock is shown, and its description names the runner, when it was checked, and each refusal

#### Scenario: ALeakOpensTheLockAndSaysWhat
- **GIVEN** a configured runner whose policy lets the canary read the agent directory
- **WHEN** the canary runs
- **THEN** the lock is shown open and marked as a failure, naming the agent directory as readable, and the configuration is left as it was

#### Scenario: NoRunnerNoLock
- **GIVEN** a runner but `allowBash` off, or bash handed to an extension (`bashFrom`)
- **WHEN** the interface shows the agent's shell
- **THEN** no lock is shown

#### Scenario: AnUnconfinedShellIsMarked
- **GIVEN** `allowBash` on and `bashRunner: "none"`, or `allowBash` on with no `bashRunner` in an explicit `sandbox` section
- **WHEN** the interface shows the agent's shell
- **THEN** an open lock is shown, and its description says that the shell is not confined
