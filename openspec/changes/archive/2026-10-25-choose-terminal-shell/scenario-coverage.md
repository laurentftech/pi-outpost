# Scenario coverage

OpenLore orient ran before inspection. Graph/coverage tools were unavailable; CLI orient plus targeted rg and assertion review supplied the fallback. Scenario enumeration: `rg '^#### Scenario:' openspec/` (full inventory captured locally), then relevant terminal main/delta specs.

## Required delta scenarios

| Scenario | Status | Test file and test name | Assertions |
| --- | --- | --- | --- |
| InstalledShellsOnly | covered | `server/test/terminalShells.test.ts`: InstalledShellsOnly (both tests); `server/test/terminalWire.test.mjs`: InstalledShellsOnly: removing an advertised executable refuses a stale choice | Resolver excludes missing/directory entries and duplicates; live server refuses a formerly advertised executable after unlink. |
| PowerShellByDefault | covered | `server/test/terminalShells.test.ts`: PowerShellByDefault; `scripts/probes/terminal-shells.mjs`: DEFAULT_Desktop | Windows host resolves PowerShell despite installed Git Bash; actual widget executes PSVersionTable. |
| ConfiguredShellWins | covered | `server/test/terminalShells.test.ts`: ConfiguredShellWins; `server/test/terminalManager.test.ts`: getDefaultShell respects explicit shell and shellArgs options | Exact configured executable and argument array asserted. |
| ChooseShellPerTab | covered | `ui/src/components/TerminalPanel.test.tsx`: ChooseShellPerTab; `scripts/probes/terminal-shells.mjs` | Selection does not reopen original tab. All four installed Windows shells execute their native command; original session remains usable. |
| ShellListChanges | covered | `ui/src/components/TerminalPanel.test.tsx`: ShellListChanges | Removed option resets selection to default and new open omits a stale ID. |
| UnknownShellIsRefused | covered | `server/test/terminalWire.test.mjs`: UnknownShellIsRefused | Unadvertised path-like ID gets error; subsequent input produces no terminal data. |
| ConfinedChoicesStayConfined | covered | `server/test/terminalShells.test.ts`: ConfinedChoicesStayConfined; `server/test/terminalManager.test.ts`: a confined terminal on Windows opens PowerShell, not Git Bash | Production discovery inventory excludes Git Bash in confinement and native arguments preserve progress handling. Existing runner pipeline retained. |
| CopySelectionOrInterrupt | covered | `ui/src/components/terminalKeyboard.test.ts`: Ctrl+C copies a selection and otherwise remains a shell interrupt; `scripts/probes/terminal-shells.mjs` | Actual selection copied and read back. After deselection Ctrl+C interrupts 30-second sleep and next PowerShell command succeeds. |
| PasteIntoTheShell | covered | `ui/src/components/terminalKeyboard.test.ts`: Ctrl+V and Ctrl+Shift+V allow native paste without sending control characters; `scripts/probes/terminal-shells.mjs` | Actual Chromium clipboard paste through both shortcuts executes the expected PowerShell expressions. |
| ClipboardRefusalIsReported | covered | `ui/src/components/terminalKeyboard.test.ts`: a clipboard refusal is reported without throwing or interrupting the shell; `scripts/probes/terminal-shells.mjs` | Actual clipboard-write permission revoked via CDP; buffer message copied/read after restoring permissions; shell remains usable. |
| TerminalRecoversAfterReconnect | covered | `ui/src/useAgent.test.ts`: TerminalRecoversAfterReconnect; `scripts/probes/terminal-reconnect.mjs` | Real WebSocket close/reconnect reproduced failure before fix and now succeeds. Unit assertions check shell/cwd/size, no duplicate reopens, closed/exited tabs excluded. |

## Main-spec impact

The existing multi-tab scenario is applicable: covered by `TerminalPanel.test.tsx` `adds a new tab when clicking + button`, renaming tests, and `terminal-shells.mjs` real multiple sessions and original-session preservation. `OnWindowsTheConfinedShellIsPowerShell` is applicable: covered by `terminalManager.test.ts` `a confined terminal on Windows opens PowerShell, not Git Bash`, with explicit shell/args assertions. Remaining requirements describe unchanged runner boundaries, toggle/PWD behavior and badges; they are inventory below, not new completion requirements. Existing runner suites are regression evidence, not a claim of new Linux/macOS execution on this Windows host.

| Main scenario | Classification | Applicable to change | Evidence |
| --- | --- | --- | --- |
| Header button and keyboard shortcut toggle | partial | no — unchanged requirement | Existing terminal suites retained; no new claim of full scenario verification in this change |
| Multi-tab management and inline renaming | covered | yes | Tests and assertions described above |
| PWD synchronization to workspace root | partial | no — unchanged requirement | Existing terminal suites retained; no new claim of full scenario verification in this change |
| ReadsStayInsideTheRoot | partial | no — unchanged requirement | Existing terminal suites retained; no new claim of full scenario verification in this change |
| WritesStayInsideTheWritableZone | partial | no — unchanged requirement | Existing terminal suites retained; no new claim of full scenario verification in this change |
| TheConfinedTerminalStaysInteractive | partial | no — unchanged requirement | Existing terminal suites retained; no new claim of full scenario verification in this change |
| TheServerCannotBeSignalled | partial | no — unchanged requirement | Existing terminal suites retained; no new claim of full scenario verification in this change |
| NoRunnerConfiguredKeepsTodaysTerminal | partial | no — unchanged requirement | Existing terminal suites retained; no new claim of full scenario verification in this change |
| OnWindowsTheConfinedShellIsPowerShell | covered | yes | Tests and assertions described above |
| AnMxcRunnerBelowTier1MeansNoTerminal | partial | no — unchanged requirement | Existing terminal suites retained; no new claim of full scenario verification in this change |
| OnWindowsWithMxcGitRunsConfined | partial | no — unchanged requirement | Existing terminal suites retained; no new claim of full scenario verification in this change |
| KeysDoNotReachTheShell | partial | no — unchanged requirement | Existing terminal suites retained; no new claim of full scenario verification in this change |
| GitKnowsWhoCommits | partial | no — unchanged requirement | Existing terminal suites retained; no new claim of full scenario verification in this change |
| ARunnerThatFailsItsSelfCheck | partial | no — unchanged requirement | Existing terminal suites retained; no new claim of full scenario verification in this change |
| AMissingRunner | partial | no — unchanged requirement | Existing terminal suites retained; no new claim of full scenario verification in this change |
| SyncUnderALockedSandbox | partial | no — unchanged requirement | Existing terminal suites retained; no new claim of full scenario verification in this change |
| OnLinuxWithMxcGitRunsInTheTerminal | partial | no — unchanged requirement | Existing terminal suites retained; no new claim of full scenario verification in this change |
| OnMacOsWithMxcGitRunsInTheTerminal | partial | no — unchanged requirement | Existing terminal suites retained; no new claim of full scenario verification in this change |
| OnMacOsTheConfinedTerminalBehavesAsATerminal | partial | no — unchanged requirement | Existing terminal suites retained; no new claim of full scenario verification in this change |
| TheRequestKeepsTheDesktopOutOfReach | partial | no — unchanged requirement | Existing terminal suites retained; no new claim of full scenario verification in this change |
| AConfinedProgramCannotDriveTheDesktop | partial | no — unchanged requirement | Existing terminal suites retained; no new claim of full scenario verification in this change |
| UnderSeatbeltGitRunsInTheTerminal | partial | no — unchanged requirement | Existing terminal suites retained; no new claim of full scenario verification in this change |
| UnderSeatbeltTheConfinedTerminalBehavesAsATerminal | partial | no — unchanged requirement | Existing terminal suites retained; no new claim of full scenario verification in this change |
| GitAppliesTheGlobalIgnoreQuietly | partial | no — unchanged requirement | Existing terminal suites retained; no new claim of full scenario verification in this change |
| AnUnverifiedTerminalIsNotCalledConfined | partial | no — unchanged requirement | Existing terminal suites retained; no new claim of full scenario verification in this change |
| ALeakingTerminalSaysSo | partial | no — unchanged requirement | Existing terminal suites retained; no new claim of full scenario verification in this change |

## Executed checks

- 246 UI tests pass: TerminalPanel, terminalKeyboard, useAgent.
- Terminal discovery: 5 pass on Windows.
- Terminal wire + sandbox policy: 54 pass, one Unix FIFO test skipped on Windows.
- Terminal manager/listeners/wire earlier pass: 20 pass, one POSIX signal test skipped.
- Server TypeScript check and embed production build pass.
- Real Chromium widget: Windows PowerShell default, PowerShell 7, cmd, Git Bash; actual clipboard copy/paste, clipboard denial, interruption, rapid tab interactions. PowerShell 7 startup crash was reproduced and avoided with -NoLogo.
- Real reconnect: Git Bash unresponsive after reconnect before fix, command output after reconnect with fix.
- Strict OpenSpec validation passes.

## Documentation impact

`README.md` updates default shell selection, per-tab shell UI, clipboard shortcuts and restart semantics. Existing shell config names remain unchanged.
