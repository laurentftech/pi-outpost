## MODIFIED Requirements

### Requirement: ConfinementIsVerifiedBeforeItIsShown

When `sandbox.bashRunner` is set and its self-check passes, the server SHALL run a canary through that
runner, with the agent shell's policy, attempting what confinement must refuse (see design: the agent
directory, beside the root, a signal, the server's environment, an unlisted host). It SHALL run again
when the sandbox settings change; its verdict SHALL be sent to clients. An unconfined shell (`"none"`,
or `allowBash` without a runner in an explicit section) SHALL be shown with an open lock. An RPC child's
shell SHALL NOT be judged.

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

#### Scenario: AnRpcChildsShellIsNotJudged
- **GIVEN** the `rpc` agent runtime
- **WHEN** the interface shows the agent's shell
- **THEN** no lock is shown
