# Tasks

- [x] 1.1 `confinedBash.ts`: PowerShell shells run a BOM-prefixed `.ps1` with `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File`, prelude (progress off, UTF-8) and exit-status trailer.
- [x] 1.2 `sandbox.ts`: register pi's `powershell` tool with the confined operations when `bashShell` names PowerShell; `index.ts` startup line names it.
- [x] 1.3 Tests: fake-runner unit tests (arguments, script bytes, tool registration); real PowerShell through the fake runner where `pwsh` exists (CI runners, Docker locally).
- [x] 1.4 `docs/sandboxing.md`: PowerShell first on Windows 11, busybox optional, WSL demoted.
- [x] 1.5 Windows 11 tier 1 (Boot Camp): `MXC_EXEC=… node --import tsx/esm --test server/test/confinedPowerShellMxc.test.ts` — confinement, git, exit codes, progress.
- [x] 1.6 One live turn with a weak model (Codestral, 2026-10-13) on a PowerShell task and on the same task in WSLC: tools used as intended, confinement held; the model's arithmetic wrong in both shells.
- [x] 2.1 `mxcExecutor.ts`: `"mxc"` resolves to the installed package's executor, else the one beside the executable; `config.ts` refuses it when neither exists.
- [x] 2.2 `build-exe` places `wxc-exec.exe` beside a Windows executable.
- [x] 2.3 Optional dependency in `server` and `cli`; lockfile regenerated with npm 11.
- [x] 2.4 PowerShell output as plain text.
- [x] 3.1 `sandbox.bashImage`: WSLC request (`mxcWslcConfig`), one run at a time, refusal of a narrower writable zone; configuration checks.
- [x] 3.2 Tests: request and queue everywhere; under MXC's real executor with `MXC_EXEC` and `MXC_WSLC_IMAGE` (`server/test/confinedBashWslc.test.ts`).
- [x] 3.3 Documentation: README, `docs/sandboxing.md`, investigation finding 11.
