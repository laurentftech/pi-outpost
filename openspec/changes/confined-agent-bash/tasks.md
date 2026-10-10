# Tasks

## 1. Configuration

- [x] 1.1 Parse `sandbox.bashRunner` and `sandbox.bashShell` (paths resolved against the config file), refuse them together with `bashFrom`; config tests for BashRunnerAndBashFromAreExclusive and TheRunnerPathIsResolved (`path.join` expectations).
- [x] 1.2 Carry both fields over when Settings apply a sandbox change; server test for ApplyingSettingsKeepsTheRunner.

## 2. Confined operations

- [x] 2.1 `confinedBashOperations` in `server/src/confinedBash.ts`: private dir, script file, policy (landstrip or MXC), minimal environment, spawn with pipes, exit status, pi's timeout/abort semantics, tree kill, cleanup; unit tests against a fake runner (OutputAndExitStatusComeBack, KeysDoNotReachTheAgentsCommands, CancellingACommandEndsIt, AMissingRunnerRefusesTheCommand, AFailedSelfCheckRefusesTheCommand).
- [x] 2.2 `createSandboxedTools` builds pi's `bash` with those operations when `bashRunner` is set; test that the registered `bash` runs through the runner.

## 3. Real confinement (Windows, MXC)

- [x] 3.1 Real test through `wxc-exec.exe` and busybox where `MXC_EXEC` and `MXC_SHELL` are set: ACommandCannotReadOutsideTheRoot, ACommandWritesOnlyInTheWritableZone, OutputAndExitStatusComeBack, CancellingACommandEndsIt, KeysDoNotReachTheAgentsCommands.

## 4. Documentation and verification

- [x] 4.1 `docs/sandboxing.md`: `bashRunner`/`bashShell`, the Windows 11 recipe (MXC tier 1, busybox-w32), the limits (read-only folders, deny list read at launch, ash not bash).
- [x] 4.2 Running app: an agent session on Windows asked to read outside the root and to run git; read the transcript (scripted model: the real ones were rate-limited or out of credit; see scenario-coverage.md).
- [x] 4.3 `scenario-coverage.md`; `npm run check:scenarios` and `openspec validate --strict`.
