# Design: the foreign way down is readable, its beside entries are denied

## Mechanism

- `mxcTerminalConfig` keeps the foreign drive's enumerated ancestors in a separate `foreignWay`
  list while moving them to `readonlyPaths` (#572), and computes `besideTheWay` over
  `[...enumeratePaths, ...foreignWay]` instead of `enumeratePaths` alone.
- Entries already allowed or enumerated (the way down itself, the tools, the command's own
  `input.tmp`) are filtered out as before; system folders at a drive's root
  (`WINDOWS_SYSTEM_FOLDERS`) are skipped exactly as `siblingsToDeny` skips them on the root's
  drive.
- `deniedPaths` therefore gains the entries beside the foreign way down — `AppData\Roaming`,
  `AppData\Local\Temp`, … — while `input.tmp` under `Temp` stays in `readwritePaths`: the more
  specific allow wins over the deny, the same rule that keeps the sandbox cache working under a
  denied sibling on the root's drive.

## Security

- Exposure removed: on a foreign drive, everything beside the way down was readable through the
  drive root's allow; now only the way down itself is. The confinement canary's beside-root bait
  (a fresh directory under `%TEMP%`) is refused, so the verdict no longer reports a leak that is
  a policy gap, not an MXC failure (#582).
- Exposure kept: the names of the way-down folders themselves (same as the root's drive), and
  the command's own temporary folder, which must stay writable for the shell's script files.

## Validation

- Unit: `BesideTheForeignWayDownStaysDenied` in `server/test/terminalSandbox.test.ts` (root on
  `D:`, tool + tmp under the profile on `C:`, fake reader): way down readable and not denied,
  `Temp`/`Roaming` denied, `input.tmp` read-write and not denied, system folders at `C:\` not
  denied.
- Real: `server/test/confinementCanaryMxcForeignDrive.test.ts` runs the canary through the real
  MXC container with the root on the checkout drive and the system temp on another — CI's new
  `mxc-windows` job (`windows-11-arm`, tier 1 per spike #558) sets `MXC_EXEC` and runs it; before
  the fix the verdict is `leaking` with `beside-root` reached, after the fix `verified`.
