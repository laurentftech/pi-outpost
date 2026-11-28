# Spec Delta

## ADDED Requirements

### Requirement: ForeignWayDownDeniedWithoutEnumeration

Under MXC on Windows, on a drive other than the project root's, the way down to every opened
folder (the shell's, the search path's tools', the grants') SHALL be computed whatever the
enumeration level the host proved (0, 1, or 2 — none), and everything beside that way down SHALL
be denied by name at every level, exactly as at full enumeration — the system temporary
directory included.

#### Scenario: ForeignWayDownDeniedWithoutEnumeration
- **GIVEN** the project root on `D:\projects\app`, a tool on `PATH` under the profile on
  `C:\Users\me\AppData\Local\Python\3.11.4`, a read grant (the sandbox cache) at
  `C:\Users\me\AppData\Local\pi-outpost\sandbox-cache`, the system temporary directory
  `C:\Users\me\AppData\Local\Temp`, and a host whose MXC cannot build a policy with listable
  folders (enumeration level 2), so commands run with no `enumeratePaths` at all
- **WHEN** the policy is built for a command of the confined shell on Windows MXC
- **THEN** `C:\` and the way down on it (`C:\Users`, `…\AppData`, `…\AppData\Local`, the tool's
  folders, the cache's folders) are in `readonlyPaths` and not in `deniedPaths`, while
  `C:\Users\me\AppData\Local\Temp` and `…\AppData\Roaming` are in `deniedPaths` — at level 2 as
  at levels 0 and 1 — the command's own `pi-outpost-bash-*` folder under `Temp` stays in
  `readwritePaths` and not denied (the more specific allow wins), system folders at `C:\` stay
  readable, and `enumeratePaths` is empty at level 2; the confinement canary's beside-root bait
  in a fresh directory under `%TEMP%` is refused, so the verdict is `verified`, not `leaking`
  (issue #585)
