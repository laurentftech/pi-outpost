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

- Run: https://github.com/laurentftech/pi-outpost/actions/runs/45374635075 (job
  `probe (windows-11-arm)`) — build **10.0.26200** (Windows 11 25H2, arm64), Node 24.22.3 —
  SDK probe: **`tier: "base-container"`, `baseContainerApiPresent: true`,
  `baseContainerSupportsDenyPaths: true`, `baseContainerSupportsEnumeratePaths: true`** —
  `checkRunner("mxc")`: **ok** — the 7 real-MXC suites started with `MXC_EXEC` at the SDK's
  `bin/arm64/wxc-exec.exe`, then the **spot runner was preempted again** at 11:10 UTC
  (37 min in; the first run 45366944884 was preempted too). Suite results lost with the
  kill; `probe.mjs` now appends each suite's log as it finishes so the next run keeps them.
- Notes: `windows-11-arm` **has MXC tier 1 and pi-outpost's gate passes there** — a hosted
  runner can exercise the real process container. But ARM spot runners are preempted
  routinely (~35–45 min in, twice), so the suites need either retries or a non-spot
  (self-hosted) Windows 11 runner.

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

- `windows-latest` (Server 2025, 26100.33828): **no tier 1** — cannot. `windows-11-arm`
  (Windows 11 25H2, 26200, arm64): **tier 1 present, gate passes** — can, but preempted
  twice mid-suites; add retries or prefer a self-hosted Windows 11 runner (x64 or arm64)
  for a stable job.
- Job shape (from the spike workflow, minus the probing): checkout → setup-node 24 → pinned
  npm → `npm ci --foreground-scripts` → `MXC_EXEC=<sdk bin>/<arch>/wxc-exec.exe` → the
  real-MXC suites; plus the guard: run `checkRunner` first and skip when the host has no
  base container, so an unpatched image skips rather than fails (proven on `windows-latest`:
  the gate refuses with the missing-build reason).
- Cost: probe ~7 min after `npm ci` (~9 min on arm64); suites were still running at 37 min
  when preempted — budget the job's 45 min accordingly, or split the suites.
