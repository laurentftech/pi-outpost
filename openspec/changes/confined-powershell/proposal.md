# Proposal

## Why

On Windows 11 the agent's shell can be confined by MXC's executor, but only with busybox-w32 as the
shell: Git Bash cannot start in a Windows sandbox (microsoft/mxc#1061), and pi's `bash` needs a
bash-compatible shell. busybox is a third-party, unsigned, GPL executable downloaded from a personal
site — the kind of addition an IT department refuses for an internal deployment. Windows PowerShell
5.1 ships with Windows and runs under MXC's tier 1 (finding 7 of
`docs/investigations/windows-sandboxing.md`); pi already has a `powershell` tool. With both, a confined
agent on Windows needs nothing but Microsoft's components.

## What Changes

- **`sandbox.bashShell` may name PowerShell** (`powershell.exe`, `pwsh.exe`, `pwsh`). The agent then
  gets pi's `powershell` tool instead of `bash` — same schema, prompt, rendering and truncation — and
  every command runs inside `bashRunner` with the policy a confined `bash` gets.
- **A PowerShell command runs as a script file**, written UTF-8 with a byte-order mark (Windows
  PowerShell 5.1 reads UTF-8 without one as the ANSI code page), started with `-NoProfile
  -NonInteractive -ExecutionPolicy Bypass -File`: the execution policy cannot be read inside the sandbox
  (the registry is refused), so it is given for the process. Progress bars are turned off (drawing one
  reads the console buffer back, which the sandbox refuses, and the command dies) and output is UTF-8.
- **Its exit status is the command's**: an explicit `exit n` gives `n`; otherwise a failed last
  statement gives the native program's code, or 1 for a failed cmdlet; success gives 0.
- **Output as plain text**: PowerShell 7 colours tables and errors by default; the script turns it off,
  or the model reads escape codes (found in a live turn with Codestral).
- **MXC comes with pi-outpost**: `@microsoft/mxc-sdk` (MIT, its executor signed by Microsoft) is an
  optional dependency — installed by default — and `"mxc"` in `sandbox.bashRunner` or
  `terminal.sandbox` names its `wxc-exec.exe`, or the one beside a standalone executable, where
  `build-exe` puts it.
- **A real bash in a Linux container (experimental)**: `sandbox.bashImage` runs each command of the
  agent's `bash` in a container of that image through MXC's WSLC backend, with only the root and the
  command's folder mounted. Commands run one at a time (two at once fail on WSLC's image store); a
  writable zone narrower than the root is refused (a writable mount inside a read-only one stays
  read-only).
- **Documentation**: Windows 11 setup with PowerShell first, busybox as the option for a POSIX shell;
  the WSL section stops presenting itself as the recommended answer for older Windows.

## Capabilities

### Modified Capabilities

- `sandbox-runner-bash`: `PowerShellMayBeTheConfinedShell`, `AConfinedPowerShellCommandRunsAsAScript`,
  `MxcComesWithPiOutpost` and `BashMayRunInAWslcContainer` are added.

## Impact

- `server/src/confinedBash.ts`, `server/src/sandbox.ts`, `server/src/index.ts` (startup line).
- `docs/sandboxing.md`.
- No configuration key is added; no client change.
- Checked on a real Windows 11 tier 1 host (26100.9444, 2026-10-13): MXC's suites for PowerShell and
  WSLC, and live turns with Codestral. The model used the `powershell` and `bash` tools as intended and
  confinement held, but its arithmetic was wrong in both shells (PowerShell multiplied strings from
  `Import-Csv`; awk the wrong columns), and once it reported results its commands had not produced.
  Gemma 4, the target model, was not tried.
