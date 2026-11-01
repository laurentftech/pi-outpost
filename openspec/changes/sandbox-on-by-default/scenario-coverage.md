# Scenario coverage — sandbox-on-by-default

Inventory: `rg '^#### Scenario:' openspec/changes/sandbox-on-by-default` lists every scenario below: the new
`sandbox-defaults` capability, and the two requirements of `sandbox-runner-bash` this change modifies (whose
earlier scenarios carry over and still pass unchanged). A scenario is `covered` only when an assertion at the
boundary it describes would fail if the contract broke.

Running app (CLAUDE.md): a Playwright run against the real server and the built UI read the lock's
`data-state`, `data-nudge` and tooltip from the DOM, and the agent's tool results from the scripted provider's
log, for the default sandbox (MXC verified, then after a reload), a legacy unconfined section (nudge, the
command runs unconfined, the startup log suggests `config --confine`) and an `"auto"` with no runner (lock
unavailable, the command refused with the reason). `pi-outpost -p` drove a real turn under the default
sandbox: the command ran confined in PowerShell, and reading beside the project was denied. `pi-outpost config
--confine` ran for real against MXC, wrote `"bashRunner": "auto"` keeping CRLF, then reported a no-op.

## sandbox-defaults

| Scenario | Status | Tests and assertions |
|---|---|---|
| NoSandboxSectionGetsTheDefault | covered | `server/test/config.test.ts` "NoSandboxSectionGetsTheDefault: …" asserts the root is the project, writing on, `allowBash` on, an automatic runner (a path when the platform has one), PowerShell on Windows. "the default follows a workspace moved by --cwd …" asserts the moved root. `server/test/autoRunnerReal.test.ts` runs a command through the tools built from an empty configuration. |
| RpcModeGetsNoDefault | covered | `server/test/config.test.ts` "RpcModeGetsNoDefault: …" asserts no sandbox under `rpc` without a section, and the rpc refusal still for an explicit one. |
| SandboxFalseRestoresTheOldBehaviour | covered | `server/test/config.test.ts` "SandboxFalseRestoresTheOldBehaviour: …" asserts no sandbox is loaded, so the server builds pi's unscoped tools (its existing no-sandbox path) and no shell lock (`confinementOf` returns none without a sandbox). |
| AutoOnACapableWindowsBuild | covered | `server/test/autoRunnerReal.test.ts` "AutoOnACapableWindowsBuild / AutoOnMacOs: …" (`AUTO_REAL=1`, run on Windows 11 26100.9711) asserts the label MXC, a `powershell` tool whose command output comes back, and a `verified` verdict. |
| AutoOnMacOs | covered | `server/test/autoRunnerReal.test.ts` same test, unconditional on macOS: label Seatbelt, a `bash` tool, output back, `verified`. `server/test/autoRunner.test.ts` "macOS takes Seatbelt, on every Mac" asserts the choice on Intel too. |
| AnOldWindowsBuildRefusesTheShell | covered | `server/test/terminalSandbox.test.ts` "AnOldWindowsBuildRefusesTheShell: …" asserts the probe's refusal names build 26100.8000, 26100.9278 and KB5120998 (and Windows 11 24H2 for 22631). `server/test/autoRunner.test.ts` "the shell tool is registered, refuses every command with the reason …" asserts the tool fails with the build and `"bashRunner": "none"`, the command's marker file is never written, and the other tools remain. |
| ACanaryLeakRefusesTheShell | covered | `server/test/autoRunner.test.ts` "ACanaryLeakRefusesTheShell: …" asserts the refusal names the agent directory and `"none"`, and "a refused gate runs nothing, confined or not" asserts the exec rejects with it while the runner is never started and its self-check never asked. |
| TheInterfaceShowsWhyTheShellIsUnavailable | covered | `ui/src/components/ConfinementLock.test.tsx` "TheInterfaceShowsWhyTheShellIsUnavailable: …" asserts `data-state="unavailable"`, "⛔ shell unavailable" and the tool's reason in the tooltip. The running-app run read the same from the DOM. |
| APromptBeforeTheChoiceIsAnswered | covered | `server/test/autoRunner.test.ts` "APromptBeforeTheChoiceIsAnswered: …" holds the gate, asserts nothing ran and no self-check was asked after 300 ms, then releases it and asserts the command ran once with its output. The `-p` run issued its command while the canary ran, and it ran confined. |
| TheInterfaceShowsTheChoiceInProgress | covered | `ui/src/components/ConfinementLock.test.tsx` "TheInterfaceShowsTheChoiceInProgress: …" asserts `data-state="checking"`, "checking confinement" and no closed lock. |
| NoneUnlocksTheShellOnAnOldBuild | covered | `server/test/config.test.ts` "AutoAndNoneAreNotPaths: …" asserts `"none"` loads with no runner and no automatic choice, so the existing unconfined shell is built (`sandboxRunnerBash.test.mjs`'s unconfined path). `ui/src/components/ConfinementLock.test.tsx` "AnIncapableMachineIsNotNudged: …" asserts the open lock. The running-app legacy run asserted the command ran unconfined. |
| SettingsCannotSelectNone | covered | `server/test/sandboxSettingsWire.test.mjs` "SettingsCannotSelectNone: …" sends `update_config` naming `"none"` to a real server, asserts an error saying the runner is the file's, and the file still names `"auto"`. |
| LegacyAllowBashStaysUnconfined | covered | `server/test/config.test.ts` "LegacyAllowBashStaysUnconfined: …" asserts no runner and no automatic choice, and `allowBash` off when omitted. `server/test/config-persist.test.ts` asserts a Settings write keeps it unconfined, and that a Settings write to the default writes `"auto"`. |
| ACapableMachineIsNudged | covered | `server/test/autoRunner.test.ts` "ACapableMachineIsNudged: …" asserts the verdict names MXC, the log line names it with `pi-outpost config --confine`, and `doctor` warns with that remedy. `ui/src/components/ConfinementLock.test.tsx` "ACapableMachineIsNudged: …" asserts the highlighted open lock and the tooltip. The running-app legacy run read `data-nudge="true"` and the suggestion in the startup log. |
| TheSuggestionNamesTheCommand | covered | The same three tests assert `pi-outpost config --confine` in the lock's tooltip, the log line and `doctor`'s remedy. |
| AnIncapableMachineIsNotNudged | covered | `server/test/autoRunner.test.ts` "AnIncapableMachineIsNotNudged: …" asserts the reason, no suggestion, and `doctor` ok without `--confine`. `ui/src/components/ConfinementLock.test.tsx` "AnIncapableMachineIsNotNudged: …" asserts the neutral lock, the reason, no `data-nudge`, no `--confine`. |
| ConfineOnACapableMachine | covered | `server/test/confineCommand.test.ts` "ConfineOnACapableMachine: …" compares the CRLF, four-space file byte for byte with the original plus one key, asserts the printed change and no leftover rehearsal file. Run for real against MXC as well. |
| ConfineRefusesOnAnIncapableMachine | covered | `server/test/confineCommand.test.ts` "ConfineRefusesOnAnIncapableMachine: …" asserts exit 1, the file byte for byte unchanged, the build and `"none"` printed. |
| ConfineRefusesWhenTheCanaryLeaks | covered | `server/test/confineCommand.test.ts` "ConfineRefusesWhenTheCanaryLeaks: …" asserts exit 1, unchanged, the agent directory named. |
| AlreadyConfinedIsANoOp | covered | `server/test/confineCommand.test.ts` "AlreadyConfinedIsANoOp: …" asserts exit 0, unchanged, the runner named, and no canary run, for `"auto"`, `"mxc"` and a path. |
| NoShellNothingToConfine | covered | `server/test/confineCommand.test.ts` "NoShellNothingToConfine: …" asserts unchanged and the message, for no `allowBash`, `allowBash` false and `bashFrom`. |
| SandboxFalseIsNotOverridden | covered | `server/test/confineCommand.test.ts` "SandboxFalseIsNotOverridden: …" asserts exit 1, unchanged, and "by hand". |
| NoFileUsesTheDefault | covered | `server/test/confineCommand.test.ts` "NoFileUsesTheDefault: …" asserts no file is created and the default explained, and a file without a section left unchanged. |
| AWriteToTheConfigurationIsRefused | covered | `server/test/configProtection.test.ts` "write and edit refuse it, under any spelling of its path …" asserts the refusal for a relative, a `..`-detoured, an absolute and (Windows) an upper-cased path, an edit refused too, the file byte for byte unchanged, and another file of the project still written. "a document tool's destination is refused the same way" asserts `assertWritableDestination`, which every document tool writes through, refuses it and admits another path. |
| AStarterConfigurationIsTheDefault | covered | `server/test/cli.test.ts` "writes a starter config in the target directory" asserts `allowWrite`, `allowBash` true and `bashRunner` `"auto"`. |

## sandbox-runner-bash (modified)

| Scenario | Status | Tests and assertions |
|---|---|---|
| BashRunnerAndBashFromAreExclusive | covered | Unchanged, `server/test/config.test.ts`. "\"auto\" holds the network …" adds `"none"` with `bashFrom`, refused. |
| TheRunnerPathIsResolved | covered | Unchanged, `server/test/config.test.ts` "bash's runner and shell are absent until configured …". |
| AutoAndNoneAreNotPaths | covered | `server/test/config.test.ts` "AutoAndNoneAreNotPaths: …" asserts `"auto"` is not resolved to `<dir>/auto` and `"none"` to no runner. |
| AVerifiedRunnerEarnsTheLock | covered | Unchanged, `ui/src/components/ConfinementLock.test.tsx`. |
| ALeakOpensTheLockAndSaysWhat | covered | Unchanged, `ui/src/components/ConfinementLock.test.tsx`; a configured (not `"auto"`) runner keeps this verdict, `autoShown` only converts an `"auto"` one. |
| NoRunnerNoLock | covered | `ui/src/components/ConfinementLock.test.tsx` "NoRunnerNoLock: …" asserts no lock without a verdict; `server/test/autoRunner.test.ts` asserts `shellIsUnconfined` is false with `allowBash` off or `bashFrom`, so the server sends no shell verdict for them. |
| AnUnconfinedShellIsMarked | covered | `ui/src/components/ConfinementLock.test.tsx` "ACapableMachineIsNudged: …" and "AnIncapableMachineIsNotNudged: …" assert the open lock saying the shell is not confined; `server/test/autoRunner.test.ts` asserts which configurations count as unconfined. |
