# Proposal: tools on another drive than the project's resolve under MXC on Windows

## Why

Issue #572: with the project root on `C:` and scoop on a second volume (`D:\WRK\Scoop` — a partition
gets its own drive letter, exactly as a second physical disk does), `Get-Command node` finds nothing and
`node -v` fails inside the sandbox, while opening `node.exe` by full path and an explicit read grant both
work. Reproduced on this machine with a `subst`'d second drive: without a grant, by-name resolution on
`D:` fails at every enumeration level; with a grant on the tool's folder it works.

## What changes

`mxcTerminalConfig` (`server/src/terminalSandbox.ts`): the root's drive is made readable whole, which is
why tools on it always resolved. For a tool on **another** drive, the way down to it — that drive's root
and every folder above the tool — SHALL become **readable** (not merely enumerable), and the junction
target stays readable as since #562. Readable shows the folders' names, as enumeration would; their
other contents stay denied — no file beside the way down is in any allow.

## Capabilities

### Modified Capabilities

- `sandbox-runner-bash`: on Windows under MXC, a tool installed on another drive than the project's
  (scoop on `D:`, a second partition or disk) resolves by name on `PATH`, including through junctions
  (`current`), with the executable anywhere in the target — its root included.

## Impact

`server/src/terminalSandbox.ts` (`ancestorsToEnumerate`, `mxcTerminalConfig`), one new unit test in
`server/test/terminalSandbox.test.ts`, verified end to end on a real MXC container against a second
drive letter. No documentation change: `docs/sandboxing.md` already describes tools on `PATH` as
readable.
