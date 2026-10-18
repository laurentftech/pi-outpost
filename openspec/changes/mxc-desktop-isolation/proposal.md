# A confined command cannot reach the user's desktop

## Why

An agent once wrote a Perl program, built it and ran it to drive the mouse: with the mouse and
the keyboard, a program can do whatever the user can. Under MXC's process container a confined
program is already refused all of it — measured with a compiled probe: `SetCursorPos` and
`OpenClipboard` fail with access denied, `SendInput` is dropped (it answers 1, the cursor stays),
no window of the user's is visible. Unconfined, the same probe moves the cursor, sees 19 windows
and reads the clipboard.

That protection comes from MXC's defaults: pi-outpost asks only `ui: { disable: false }`, which
Win32k needs. MXC's schema has explicit fields for the rest — `clipboard` and `injection` — and a
default may change.

## What Changes

- The MXC request for the terminal and for the agent's confined shell (`mxcTerminalConfig`) asks
  for no clipboard (`clipboard: "none"`) and no input injection (`injection: false`), beside
  `disable: false`.
- A test under the real executor runs a compiled program in the agent's `powershell` and checks
  that it can neither inject input, move the cursor, see the user's windows nor open the
  clipboard.

## Impact

`server/src/terminalSandbox.ts`. MXC accepts the fields, and PowerShell, git and the terminal
work as before (the real MXC suites pass). Whether the explicit fields, rather than the defaults,
are what refuses today was not measured: opening them to compare was not done. The WSLC backend
is unaffected — a Linux container has no Windows desktop at all.
