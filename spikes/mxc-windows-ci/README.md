# Spike: MXC's real process container on a CI Windows runner

**Question.** Today no CI runner exercises MXC on Windows: the real-MXC suites
(`server/test/*Mxc.test.ts`, gated on `MXC_EXEC`) skip everywhere, and only the manual
`MXC_EXEC=mxc npm test` on a developer's Windows 11 runs them (docs/development.md). Can a
GitHub-hosted (or self-hosted) Windows runner run them — i.e. does its build carry MXC's
tier 1 (`processmodel.dll`, `CreateProcessSecurityEnvironment`), which needs Windows 11
24H2/25H2 at build 26100.9278 / 26200.9278 or later (the August 2026 update)?

This spike answers it by measurement, on two runner images at once, and records whether the
real suites pass there — including the enumeration layer that 0.65.0 added and that
`vibe/mxc-security-env-fallback-5c5e57` makes degrade when a host refuses it.

## How to run

- In CI: `.github/workflows/mxc-windows-ci-spike.yml` triggers on `workflow_dispatch` and on
  pushes to the spike branch touching `spikes/mxc-windows-ci/**`; it probes `windows-11-arm`
  (Windows 11 ARM64 — the SDK ships arm64 binaries) and `windows-latest` (Server edition) and
  uploads `results/<label>/` as an artifact. Nothing here is a required check.
- Locally on a Windows machine, after `npm ci`:
  `node --import tsx/esm spikes/mxc-windows-ci/probe.mjs` (set `MXC_SHELL` to busybox-w32's
  `sh.exe` too if you want `confinedBashMxc` in the run).

## What `probe.mjs` records

1. Host: platform, arch, OS build, Node.
2. The SDK's native parts for the arch (`wxc-exec.exe`, `mxc_ffi.dll`) and its `probe()` —
   the selected tier and `baseContainerSupportsDenyPaths` / `baseContainerSupportsEnumeratePaths`.
3. pi-outpost's own gate, `checkRunner("mxc")`.
4. Where the gate passes, the real-MXC suites with `MXC_EXEC` at the bundled `wxc-exec.exe`,
   and their pass/fail counts (full log kept beside the probe output).

Results land in `results/<label>/{probe.json,summary.md,suites.log}` (git-ignored).

## Findings

See [findings.md](findings.md) — filled from the workflow's artifacts, one section per runner.
