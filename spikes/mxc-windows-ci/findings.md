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

- Run: _(link)_ — build _(…)_ — probe: _(tier, flags)_ — checkRunner: _(…)_ — suites:
  _(pass/fail/skipped)_.
- Notes:

## Runner: `windows-latest` (Server edition)

- Run: _(link)_ — build _(…)_ — probe: _(tier, flags)_ — checkRunner: _(…)_ — suites:
  _(pass/fail/skipped)_.
- Notes:

## Conclusion for a real `mxc-windows` CI job

- Runner label to use, and whether a self-hosted Windows 11 x64 runner is still needed:
- Job shape (from the spike workflow, minus the probing): checkout → setup-node 24 → pinned
  npm → `npm ci --foreground-scripts` → `MXC_EXEC=<sdk bin>/wxc-exec.exe` → the real-MXC
  suites; plus the guard: run `checkRunner` first and skip when the host has no base
  container, so an unpatched image skips rather than fails.
- Cost: _(job minutes)_.
