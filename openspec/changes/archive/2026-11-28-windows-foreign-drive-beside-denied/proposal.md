# Proposal: what lies beside the way down on a foreign drive stays denied (issue #582)

## Why

Issue #582: with the project root on `D:\pi-outpost` and the profile, the tools and the system
temporary directory on `C:`, v0.67.0 reports `mxc does not confine: beside-root reached by the
canary` at startup — the confinement canary's bait, a marker in a fresh directory under
`%TEMP%` (`C:\Users\…\AppData\Local\Temp`), was **readable** inside the confined shell, so the
verdict is `leaking` and, with `bashRunner: "auto"`, every command of the agent's shell is refused.
Writes beside the root were refused and the agent directory stayed denied: MXC confined; the
policy just left the foreign drive's whole way down — and everything beside it — readable.

Since #572, a tool on another drive than the root's needs the way down on that drive **readable**
(the drive's root and every folder above the tool), which puts that drive's root in
`readonlyPaths` and makes its whole subtree readable unless denied. But the deny-by-name of what
lies beside the way down was computed only over the folders still in `enumeratePaths` — the
foreign way-down folders are moved out of it to `readonlyPaths`, so their entries were never
denied. On the root's own drive the same protection exists (`siblingsToDeny`); on a foreign drive
it was missing, so `%TEMP%` — under the profile, on the way down when a tool lives there — stayed
readable.

## What changes

`mxcTerminalConfig` (`server/src/terminalSandbox.ts`): the deny-by-name of what lies beside the
way down (`besideTheWay`) SHALL cover the readable way down on a foreign drive too, not only the
enumerated folders on the root's drive. System folders at a drive's root stay readable, as on
the root's drive; the command's own temporary folder (`input.tmp`, read-write) stays allowed —
the more specific allow wins over the deny, as it already does for the sandbox cache on the
root's drive.

## Capabilities

### Modified Capabilities

- `sandbox-runner-bash`: on Windows under MXC, when the root is on one drive and a tool (or the
  shell) on another, the way down on the other drive is readable, **and** everything beside the
  way down there is denied by name — the system temporary directory included — so the
  confinement canary's beside-root bait is refused and the verdict is `verified`.

## Impact

`server/src/terminalSandbox.ts` (`mxcTerminalConfig`), one unit test in
`server/test/terminalSandbox.test.ts` (`BesideTheForeignWayDownStaysDenied`), one real-MXC test
(`server/test/confinementCanaryMxcForeignDrive.test.ts`, runs where `MXC_EXEC` is set), a new CI
job `mxc-windows` on `windows-11-arm` running the real-MXC suites (previously no CI runner had
Windows tier 1), and `scripts/mxc-windows/test.ps1`. One sentence in `docs/sandboxing.md`.
