# Spec Delta

## ADDED Requirements

### Requirement: AToolOnAnotherDriveThanTheRootsResolves

Under MXC on Windows, when a folder a command opens by path is on another drive than the project root's,
the root of that drive and every folder above the opened one SHALL be readable, not merely enumerable, so
a command can traverse them; the opened folder and a junction's target SHALL be readable as on the root's
drive; and everything beside the way down on that drive SHALL keep its contents denied.

#### Scenario: AToolOnAnotherDriveThanTheRootsResolves
- **GIVEN** the project root on `C:\Users\me\work\app`, scoop on a second drive `D:\WRK\Scoop`, `D:\WRK\Scoop\apps\nodejs\current` a junction to `D:\WRK\Scoop\apps\nodejs\v26.8.2` whose root holds `node.exe`, and `PATH` naming `current\bin`, `current` and `D:\WRK\Scoop\shims`, all confined by MXC on Windows 11 tier 1
- **WHEN** a command runs `Get-Command node; node -v`
- **THEN** `node` resolves through the junction to `current\node.exe` and runs — `D:\`, `D:\WRK`, `D:\WRK\Scoop`, `D:\WRK\Scoop\apps`, `D:\WRK\Scoop\apps\nodejs`, the junction and its target are readable, the link is never enumerated, and `D:\private` or `Scoop\buckets` keep their contents denied
