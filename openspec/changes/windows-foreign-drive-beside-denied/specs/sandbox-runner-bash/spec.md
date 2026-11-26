# Spec Delta

## ADDED Requirements

### Requirement: BesideTheForeignWayDownStaysDenied

Under MXC on Windows, on a drive other than the project root's, everything beside the readable way
down to an opened folder SHALL be denied by name in each folder of the way down, as beside the
root on the root's drive — the system temporary directory included.

#### Scenario: BesideTheForeignWayDownStaysDenied
- **GIVEN** the project root on `D:\projects\app`, a tool on `PATH` under the profile on
  `C:\Users\me\AppData\Local\Python\3.11.4`, the system temporary directory
  `C:\Users\me\AppData\Local\Temp`, and PowerShell confined by MXC on Windows 11 tier 1
- **WHEN** the confinement canary runs, its beside-root bait in a fresh directory under the
  system temporary directory
- **THEN** reading the bait's marker and writing beside it are both refused and the verdict is
  `verified` (not `leaking`); in the policy the way down on `C:` (`C:\`, `C:\Users`,
  `…\AppData`, `…\AppData\Local`, the tool) is in `readonlyPaths` and not in `deniedPaths`, while
  `C:\Users\me\AppData\Local\Temp` is in `deniedPaths`; the command's own `pi-outpost-bash-*`
  folder stays in `readwritePaths` (the more specific allow wins over the deny), and the system
  folders at `C:\` stay readable
