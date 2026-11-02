## MODIFIED Requirements

### Requirement: TheDefaultSandboxMayBeTurnedOff

`"sandbox": false` in the configuration file SHALL restore the unsandboxed behaviour: unscoped file tools,
and a shell that is not confined. While a `bash` tool is active, the shell's lock SHALL be shown open, saying
that the sandbox is turned off; where this machine's runner passes its self-check, it SHALL be highlighted
and offer `pi-outpost config --confine`. With no `bash` tool, no lock SHALL be shown.

#### Scenario: SandboxFalseRestoresTheOldBehaviour
- **GIVEN** `"sandbox": false` in the configuration, on a machine whose runner does not pass its self-check
- **WHEN** the agent writes a file outside the working directory
- **THEN** the write succeeds, and the shell's lock is shown open and neutral, its description saying the sandbox is turned off, with no suggestion to confine the shell

#### Scenario: SandboxFalseIsNudgedWhereItCanBeConfined
- **GIVEN** `"sandbox": false`, and a machine whose runner passes its self-check
- **WHEN** the interface shows the agent's shell
- **THEN** the open lock is highlighted, and its description names the runner, `pi-outpost config --confine`, and that turning the sandbox back on also limits the file tools to the project

#### Scenario: SandboxFalseWithoutAShellShowsNoLock
- **GIVEN** `"sandbox": false` and a `tools` allowlist without `bash`
- **WHEN** the interface shows the agent's shell
- **THEN** no lock is shown

### Requirement: ConfineCommandChangesNothingElse

`pi-outpost config --confine` SHALL only confine a shell that is on and unconfined, or restore a sandbox that
is `false`. It SHALL write nothing, and SHALL say why, when the shell is already confined or off, or when
there is no configuration file.

#### Scenario: AlreadyConfinedIsANoOp
- **GIVEN** a configuration whose `sandbox.bashRunner` is `"auto"`, `"mxc"` or a path
- **WHEN** the user runs `pi-outpost config --confine`
- **THEN** the file is unchanged, the output says the shell is already confined by that runner, and the exit status is 0

#### Scenario: NoShellNothingToConfine
- **GIVEN** a `sandbox` section without `allowBash`, or with `bashFrom`
- **WHEN** the user runs `pi-outpost config --confine`
- **THEN** the file is unchanged, and the output says that pi-outpost's own shell is not in use

#### Scenario: SandboxFalseIsNotOverridden
- **GIVEN** `"sandbox": false`, and a runner that fails its check or the canary
- **WHEN** the user runs `pi-outpost config --confine`
- **THEN** the file is unchanged, the reason is given, and the exit status is 1

#### Scenario: NoFileUsesTheDefault
- **GIVEN** no configuration file
- **WHEN** the user runs `pi-outpost config --confine`
- **THEN** no file is created, and the output says the default sandbox already chooses a runner automatically

## ADDED Requirements

### Requirement: ConfineCommandRestoresATurnedOffSandbox

With `"sandbox": false`, `pi-outpost config --confine` SHALL replace it with the default sandbox — writing
allowed, `allowBash` on, `"bashRunner": "auto"` — only after the runner passes its self-check and the canary,
and SHALL say that the agent's file tools are now limited to the project. Under the `rpc` runtime it SHALL
write nothing, since a sandbox cannot be enforced there.

#### Scenario: SandboxFalseIsRestoredAsTheDefault
- **GIVEN** `"sandbox": false` among other keys, on a machine whose runner passes its self-check and the canary
- **WHEN** the user runs `pi-outpost config --confine`
- **THEN** the file's `sandbox` is the default sandbox, the other keys are unchanged, and the output says the file tools are now limited to the project

#### Scenario: SandboxFalseUnderRpcIsNotRestored
- **GIVEN** `"sandbox": false` and the `rpc` agent runtime
- **WHEN** the user runs `pi-outpost config --confine`
- **THEN** the file is unchanged, no canary runs, and the output says a sandbox cannot be enforced for an RPC child
