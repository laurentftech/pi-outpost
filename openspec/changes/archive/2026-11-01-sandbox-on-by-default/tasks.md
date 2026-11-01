# Tasks

## 1. Configuration

- [x] 1.1 In `loadConfig`, accept `"sandbox": false`, and apply the default sandbox (root = cwd, `allowWrite`, `allowBash`, `bashRunner: "auto"`) when the section is absent and the runtime is not `rpc`. Verify with config tests for NoSandboxSectionGetsTheDefault, RpcModeGetsNoDefault and SandboxFalseRestoresTheOldBehaviour.
- [x] 1.2 Make `resolveRunner` keep `"auto"` and `"none"` as keywords, and treat an explicit section's `allowBash` without a runner as `"none"`. Verify with AutoAndNoneAreNotPaths, LegacyAllowBashStaysUnconfined and the existing `bashFrom`, `bashImage` and `allowedHosts` exclusivity tests (`"auto"` counts as MXC/Seatbelt for `allowedHosts`).
- [x] 1.3 Refuse a Settings update that names a runner. Verify with SettingsCannotSelectNone, plus ApplyingSettingsKeepsTheRunner, which still passes.

## 2. Automatic runner choice

- [x] 2.1 Add the `"auto"` resolution (platform candidate → self-check → canary → runner or reason), shared per sandbox configuration and restarted when settings change. Verify with unit tests driving fake self-checks and canaries: pass, failed self-check, canary leak.
- [x] 2.2 Make the confined shell's `exec` await the resolution and refuse with its reason. On Windows, register `powershell` with PowerShell as the shell. Verify with AutoOnACapableWindowsBuild (Windows CI), AutoOnMacOs, ACanaryLeakRefusesTheShell and APromptBeforeTheChoiceIsAnswered.
- [x] 2.3 Word the Windows refusal: read `CurrentBuild` and `UBR` from the registry and name the build and the update (KB) it needs, plus `"bashRunner": "none"`. Verify with AnOldWindowsBuildRefusesTheShell, using a stubbed probe and a stubbed registry.

## 3. Interface and nudge

- [x] 3.1 Add the `unconfined` and `unavailable` states to `ConfinementVerdict`, and send "checking" while `"auto"` is choosing. Render them in `ConfinementLock`: open highlighted, open neutral, unavailable. Verify with TheInterfaceShowsTheChoiceInProgress, TheInterfaceShowsWhyTheShellIsUnavailable and AnUnconfinedShellIsMarked, in `ConfinementLock.test.tsx` and in the running app (Playwright, bench).
- [x] 3.2 For an unconfined shell, run the platform self-check and send `unconfined`, with `available.runner` when it passes. Log the suggestion at startup and report it as a `doctor` warning. Verify with ACapableMachineIsNudged and AnIncapableMachineIsNotNudged, and do a monkey pass in the running app: change the settings while the check runs, switch projects.

## 4. Documentation and integration

- [x] 4.1 Update `docs/sandboxing.md` (the default, `"auto"`, `"none"`, Older Windows with the build table and the escape hatch, the nudge) and `README.md` (the "not confined" note, the examples, `"sandbox": false`). Verify the links and the fenced JSON.
- [x] 4.2 Make `pi-outpost init` write the new defaults, and make `doctor` report the chosen runner. Verify with the CLI tests.
- [x] 4.2b Refuse writes of the configuration file by every writing tool of the agent. Verify with AWriteToTheConfigurationIsRefused.
- [x] 4.3 Implement `pi-outpost config --confine`: resolve the configuration file, apply the guards (already confined, no shell, `"sandbox": false`, no file), run the `"auto"` resolution, then do an atomic in-place write that preserves key order, indentation and line endings. Add it to the help and to the `cli` spec's command list. Verify with the CLI tests for ConfineOnACapableMachine, ConfineRefusesOnAnIncapableMachine, ConfineRefusesWhenTheCanaryLeaks, AlreadyConfinedIsANoOp, NoShellNothingToConfine, SandboxFalseIsNotOverridden and NoFileUsesTheDefault. Use a CRLF fixture, and compare files as bytes.
- [x] 4.4 Point the lock's suggestion, the startup log and `doctor` to `pi-outpost config --confine`, and document the command in `docs/sandboxing.md`. Verify with TheSuggestionNamesTheCommand.
- [x] 4.5 Write `scenario-coverage.md`, then run `npm run check:scenarios`, `openspec validate sandbox-on-by-default --strict` and the full server and UI suites on Windows and Linux.

## Workflow follow-up

- Exercise the feature on a Windows build below 9278 (the office machine): the shell is refused with the reason, then `"none"` unlocks it.
- Archive the change after review.
