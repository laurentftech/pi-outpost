# Scenario coverage

OpenLore had no analysis index for this branch; targeted inspection of
`confinedEnvironment` (`server/src/terminalSandbox.ts`) and its two callers stood in.
Scenarios enumerated with `rg '^#### Scenario:' openspec/changes/confined-shell-history-outside-root`.

| Scenario | Status | Test file and name |
|---|---|---|
| KeysDoNotReachTheShell | covered | `server/test/terminalSandbox.test.ts`: `keys and other server variables stay out; the shell's own basics are set` — the whole environment by `deepEqual`, now with `HISTFILE` and `ZDOTDIR` in the temp; also `server/test/terminalSandboxWire.test.mjs` (annotated). |
| GitKnowsWhoCommits | covered | `server/test/terminalSandbox.test.ts` (annotated at line 676), unchanged by this change. |
| AClosedTerminalLeavesNoHistoryInTheProject | covered | `server/test/terminalSandboxSeatbelt.test.ts`: `AClosedTerminalLeavesNoHistoryInTheProject: zsh writes its history outside the root on closing` — a line typed, the terminal closed, past the 2 s grace the root holds only `.git`; fails without the fix (`.zsh_history`), run on macOS with `SEATBELT_EXEC`. `server/test/terminalSandboxMxcLinux.test.ts`: `AClosedTerminalLeavesNoHistoryInTheProject: bash writes its history outside the root on closing` — no `.bash_history` in the root; in Docker (`scripts/mxc-linux/test.sh`, CI `mxc-linux`). Without the fix a listing of the root showed `.bash_history` from 50 ms after the close. |
