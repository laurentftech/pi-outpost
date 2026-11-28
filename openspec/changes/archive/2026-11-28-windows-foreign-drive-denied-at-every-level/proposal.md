# Proposal: the foreign drive stays confined whatever the enumeration level (issue #585)

## Why

Issue #585: same symptom as #582 on v0.67.1 — `mxc does not confine: beside-root reached by the
canary` — with the root on `D:\Python\Projet_oper` and `%TEMP%` on
`C:\Users\MOI\AppData\Local\Temp` (confirmed on the reporter's machine: no junction on the way,
`realpath` stays on `C:`). The #583 fix denies what lies beside the foreign way down, but only
over the folders still in `enumeratePaths`: on a host whose MXC refuses to build a policy with
listable folders (a domain machine's profile ACLs — `noteMxcEnumerateLevel(2)`, shown by
`sandbox doctor` as `MXC enumeration level 2`), `enumeratePaths` is empty, so `foreignWay` was
empty too, while the foreign drive's root still went to `readonlyPaths` — the whole `C:` drive,
profile and temporary directory included, was readable inside the confined shell. The doctor's
printed policy looked confined (it is built with full enumeration forced) while commands ran at
level 2.

## What changes

`mxcTerminalConfig` (`server/src/terminalSandbox.ts`): the way down to every opened folder (the
shell's, the search path's tools', the grants') SHALL be computed whatever the enumeration level,
and the foreign way down SHALL be taken from that computation — not from `enumeratePaths` — so
what lies beside it is denied by name at every level, level 2 included. `sandbox doctor` SHALL
also show the policy at the host's proven level (`runtimePolicy`), so the displayed policy can no
longer look confined while commands run at a lower level.

## Capabilities

### Modified Capabilities

- `sandbox-runner-bash`: on Windows under MXC, with a tool on another drive than the root's, the
  way down on that drive is readable and everything beside it is denied by name at **every**
  enumeration level the host proved (0, 1, 2) — the system temporary directory included — so the
  confinement canary's beside-root bait under `%TEMP%` on the foreign drive is refused and the
  verdict is `verified` even when the host cannot enumerate at all.

## Impact

`server/src/terminalSandbox.ts` (`mxcTerminalConfig`: `wayDownAll` computed from shell + tools +
grants at any level; `foreignWay` from it), one unit test in `server/test/terminalSandbox.test.ts`
(`ForeignWayDownDeniedWithoutEnumeration`, levels 1 and 2), `server/src/sandboxDoctor.ts`
(`runtimePolicy` + rendering; relay probe URL stripped of whitespace), one paragraph in
`docs/sandboxing.md`.
