# Tasks

- [x] 1.1 `confinedBash.ts`: PowerShell shells run a BOM-prefixed `.ps1` with `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File`, prelude (progress off, UTF-8) and exit-status trailer.
- [x] 1.2 `sandbox.ts`: register pi's `powershell` tool with the confined operations when `bashShell` names PowerShell; `index.ts` startup line names it.
- [x] 1.3 Tests: fake-runner unit tests (arguments, script bytes, tool registration); real PowerShell through the fake runner where `pwsh` exists (CI runners, Docker locally).
- [x] 1.4 `docs/sandboxing.md`: PowerShell first on Windows 11, busybox optional, WSL demoted.
- [ ] 1.5 Windows 11 tier 1 (Boot Camp): `MXC_EXEC=… node --import tsx/esm --test server/test/confinedPowerShellMxc.test.ts` — confinement, git, exit codes, progress.
- [ ] 1.6 One live turn with the target model asking for a PowerShell task.
