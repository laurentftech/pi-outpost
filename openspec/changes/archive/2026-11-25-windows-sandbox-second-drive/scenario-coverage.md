# Scenario coverage

Scenario inventory: `rg '^#### Scenario:' openspec/changes/windows-sandbox-second-drive/` (1 scenario, `sandbox-runner-bash`).

| Scenario | Status | Evidence |
| --- | --- | --- |
| AToolOnAnotherDriveThanTheRootsResolves | covered | `server/test/terminalSandbox.test.ts`, "AToolOnAnotherDriveThanTheRootsResolves: scoop on a second drive (D:), root on C: — …": with a fake reader, the way down on `D:` (`D:\`, `D:\WRK`, `D:\WRK\Scoop`, `…\apps`, `…\nodejs`) is in `readonlyPaths` and not in `enumeratePaths`, the `current` junction is readable and never enumerated, its target `…\v26.8.2` is readable and not denied (that is what makes `node.exe` at the target's root resolvable), and `D:\private`/`Scoop\buckets` are in no allow. End to end on a real MXC container with a second drive letter (`subst D:`): before the fix, `Get-Command node`/`node -v`/`Test-Path <junction>\node.exe` are refused without a grant; after the fix, `node` resolves through `current` and runs (`v26.13.1`) at enumeration levels 0, 1 and 2. |
