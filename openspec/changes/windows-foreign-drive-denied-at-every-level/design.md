# Design: the foreign way down is denied beside at every enumeration level

## Mechanism

- `mxcTerminalConfig` now computes `wayDownAll = ancestorsToEnumerate([...shellDir, ...tools,
  ...grantedRead, ...grantedWrite], guard)` unconditionally. `enumeratePaths` (what MXC gets as
  listable folders) stays gated by the host's proven level exactly as before: level 0 gets
  `wayDownAll`, level 1 the tools' ancestors only, level 2 none.
- `foreignWay` — the way down on a drive other than the root's, moved to `readonlyPaths` (#572) —
  is now `wayDownAll.filter(onForeign)` instead of `enumeratePaths.filter(onForeign)`. At level 2
  there is no enumeration, but the foreign drive is still readable whole, so the beside-the-way
  denies must come from the way down itself (issue #585).
- `wayDown = [...enumeratePaths, ...foreignWay]` is unchanged; `besideTheWay` (deny by name of
  each way-down folder's other children, system folders at drive roots excepted) now covers the
  foreign way down at every level. The grants' foreign ancestors (the sandbox cache under the
  profile on `C:`) are part of it at levels 1 and 2 too, which is what denies
  `AppData\Local\Temp` there.
- The command's own `input.tmp` under `Temp` stays in `readwritePaths`: the more specific allow
  wins over the deny, as before.
- `sandboxDoctor` builds the shown `policy` with full enumeration (the wanted policy) and a new
  `runtimePolicy` with `enumerateLevelFlags(mxcEnumerateLevel())` (what commands get), rendered as
  `policy at level N (what commands get): …`. The relay-reachability probe strips whitespace from
  the relay URL before interpolating it into the quoted PowerShell URI (a newline there made the
  probe fail as `network`, seen in #585's log).

## Security

- Exposure removed: at enumeration level 2 (and for the grants' way down at level 1), a foreign
  drive's whole subtree was readable through the drive root's allow; now only the way down to the
  opened folders is readable, everything beside it is denied by name — the profile's
  `AppData\Local\Temp` and the canary's beside-root bait included.
- Exposure kept: unchanged — the way down itself stays readable (tools must resolve, #572), the
  command's own temporary folder stays writable, system folders at a drive's root stay readable.
- No change on the root's own drive: `siblingsToDeny` was and stays level-independent.

## Validation

- Unit: `ForeignWayDownDeniedWithoutEnumeration` in `server/test/terminalSandbox.test.ts` (root on
  `D:`, tool and sandbox-cache grant under the profile on `C:`, fake reader) runs the policy at
  level 2 (`enumerateAncestors: false`) and level 1 (`enumerateGrants: false`): `C:\` readable,
  the way down readable and not denied, `Temp`/`Roaming` denied, `input.tmp` read-write and not
  denied, system folders at `C:\` not denied, and at level 2 `enumeratePaths` empty.
- Real: the existing `confinementCanaryMxcForeignDrive.test.ts` (CI `mxc-windows` job) still covers
  the two-drive canary at the runner's level.
