# Findings: MXC on Windows CI runners

Filled from the `mxc-windows-ci-spike` workflow's artifacts (`results/<label>/probe.json`,
`summary.md`, `suites.log`) and run links. One section per runner image.

## Questions to answer

1. Does the runner's build carry MXC tier 1 (`probe()` reports `base-container` /
   `processmodel.dll`)? Which build is it, exactly (`os.release()`)?
2. Does the base container there report `baseContainerSupportsDenyPaths` and
   `baseContainerSupportsEnumeratePaths`? (0.65.0's policy needs deny; the enumeration layer
   is probed before being asked for.)
3. Does pi-outpost's `checkRunner("mxc")` pass there?
4. Where it passes, do the real-MXC suites pass? Any failure is the spike's main result —
   especially a `CreateProcessSecurityEnvironment` HRESULT, which would show whether a
   stock CI image reproduces the domain-machine refusal that
   `vibe/mxc-security-env-fallback-5c5e57` falls back from.
5. Is the runner x64 or arm64, and does the SDK's arch-matched native runtime load
   (`mxc_ffi.dll` through koffi)?

## Runner: `windows-11-arm` (Windows 11 ARM64)

- Run: https://github.com/laurentftech/pi-outpost/actions/runs/45366944884 (job
  `probe (windows-11-arm)`) — `npm ci --foreground-scripts` completed (koffi built its arm64
  prebuild, node-pty moved `conpty.dll` for arm64), then the **runner was preempted**
  ("The operation was canceled", 10:22 UTC) during the probe step: no probe output, no
  artifact. Retried by re-running the spike workflow; ARM runners are spot instances and
  may be preempted again.
- Notes: _(to fill from a completed run: build, SDK probe tier/flags, checkRunner, suites)_

## Runner: `windows-latest` (Server edition)

- Run: https://github.com/laurentftech/pi-outpost/actions/runs/45366944884 (job
  `probe (windows-latest)`, artifact `mxc-windows-ci-windows-latest`) — build **10.0.26100.33828**
  (Windows Server 2025, x64), Node 24.22.3 — SDK probe: `baseContainerApiPresent: false`,
  error `Windows ProcessContainer is unavailable: PSEC is not enabled`,
  `baseContainerSupportsDenyPaths/EnumeratePaths: false` — `checkRunner("mxc")` **refused**
  with that reason — suites: **not run** (the gate refused; by design they would assert and
  fail rather than skip).
- Notes: Server 2025 at this patch level has no MXC tier 1 (`processmodel.dll`/PSEC), so
  `windows-latest` cannot exercise the real process container. The refusal path works as
  intended: `checkRunner` names the missing build and the August 2026 update.

## Conclusion for a real `mxc-windows` CI job

- Runner label to use, and whether a self-hosted Windows 11 x64 runner is still needed:
- Job shape (from the spike workflow, minus the probing): checkout → setup-node 24 → pinned
  npm → `npm ci --foreground-scripts` → `MXC_EXEC=<sdk bin>/wxc-exec.exe` → the real-MXC
  suites; plus the guard: run `checkRunner` first and skip when the host has no base
  container, so an unpatched image skips rather than fails.
- Cost: _(job minutes)_.
