# Proposal: prune the deny list when the host's security environment cannot open a path

## Why

On v0.68.0, a domain-joined Windows 11 machine (root `D:\pi-outpost`, profile and `%TEMP%` on `C:`)
reports at startup: `mxc cannot confine it on this machine — failed to create the process security
environment: CreateProcessSecurityEnvironment failed (HRESULT = 0x80070005)`. Nothing runs: the
shell is unavailable, fail-closed.

Since #586, the policy at enumeration level 2 also carries the foreign drive's way down
(`readonlyPaths`) and the deny-by-name of what lies beside it under the profile on `C:`. Windows
builds the process security environment from every policy path and refuses the **whole** policy when
one cannot be opened there — `0x80070005` on a domain-joined account (a denied file the account
cannot open with the access the builder asks, e.g. a held hive file). The existing fallback only
steps the enumeration level down (0→1→2); at level 2 those deny entries were still present, so the
launch still failed — a regression from #586: v0.67.1 built the level-2 policy on the same machine.

## What changes

`mxcTerminalConfig` (`server/src/terminalSandbox.ts`): a new `strictDenies` mode — deny only what the
host can open where the security environment is built (`strictlyDeniable`: a denied **file** must
open with no sharing at all, a denied **folder** only with a plain open and not be a link). The
launch retry chain (`confinedBash.ts`, the canary in `confinementStatus.ts`) uses it as the last
fallback, after the enumeration levels: on `isSecurityEnvironmentRefusal` at level 2, remember it
(`noteMxcStrictDenies`, like the level) and rebuild once with the pruned deny list. An openable folder
like `Temp` stays denied, so the confinement canary still passes and `bashRunner: "auto"` keeps
working; only entries that would break the security environment are left out.

## Capabilities

### Modified Capabilities

- `sandbox-runner-bash`: on Windows under MXC, when the host's process security environment cannot
  open a denied path (0x80070005), the deny list is pruned to the paths it can open instead of the
  whole launch being refused — the shell starts, confined, and the canary's beside-root bait under
  `%TEMP%` on a foreign drive stays refused.

## Impact

`server/src/terminalSandbox.ts` (`strictDenies` input, `strictlyDeniable`, `deniableEntries` filter
param, module flag `mxcStrictDenies`/`noteMxcStrictDenies`), the retry loops in
`server/src/confinedBash.ts` and `server/src/confinementStatus.ts`, one unit test in
`server/test/terminalSandbox.test.ts` (`StrictDeniesKeepOnlyOpenableEntries`), one paragraph in
`docs/sandboxing.md`.
