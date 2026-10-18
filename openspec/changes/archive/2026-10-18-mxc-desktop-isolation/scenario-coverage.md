# Scenario coverage

`orient` pointed at `server/src/terminalSandbox.ts` (`mxcTerminalConfig`, used by the terminal
and, through `confinedBashOperations`, by the agent's confined shell). Scenarios enumerated with
`rg '^#### Scenario:' openspec/changes/mxc-desktop-isolation`.

| Scenario | Status | Test file and name |
|---|---|---|
| TheRequestKeepsTheDesktopOutOfReach | covered | `server/test/terminalSandbox.test.ts`: `TheRequestKeepsTheDesktopOutOfReach: no clipboard and no input injection are asked for, in every case` — builds the request with writes allowed, refused and zoned, and asserts the whole `ui` object equals `{ disable: false, clipboard: "none", injection: false }`. |
| AConfinedProgramCannotDriveTheDesktop | covered | `server/test/confinedPowerShellMxc.test.ts`: `AConfinedProgramCannotDriveTheDesktop: no injected input, no cursor, no windows, no clipboard` — compiles `server/test/fixtures/desktop-probe.cs` with .NET Framework's `csc.exe`, runs it through the real `wxc-exec.exe`, and asserts the cursor is not at the injected `0,0` nor the set `1,1`, `SetCursorPos=False`, `visibleWindows=0` and `OpenClipboard=False`. Unconfined, the same probe gives `SetCursorPos=True`, visible windows and an open clipboard, so each assertion would fail without the boundary. Runs where `MXC_EXEC` is set (no CI runner has MXC tier 1). |
