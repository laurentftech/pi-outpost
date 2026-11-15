# Tasks

## 1. Verify on Windows 11 before building

- [x] 1.1 `processContainer.captureDenials` (`mode: "block"`) with a `1.0.0` request through `wxc-exec.exe` 1.1.0: the report's real shape, where it is written, what announces its path.
- [x] 1.2 Its cost per command, and what it needs beyond native PSEC.
- [x] 1.3 Correct `design.md` and the spec delta by what 1.1 and 1.2 show.

## 2. Record and tell

- [x] 2.1 One record type; translate landstrip's lines and the proxy's refused hosts into it.
- [x] 2.2 Windows: the `diagnose` option, its narrower rerun (no drive, no named denies, no network), the report read from its announced path, filtered, deleted, the announcement stripped.
- [ ] 2.3 The same on macOS, behind the development contract. Deferred: needs an Apple silicon Mac (a probe first, as for Windows: does Seatbelt report explicit denies?).

  Handover, written from Windows (nothing below has run on a Mac):
  1. **Run what exists first**: `bash scripts/mxc-macos/test.sh` (Node.js ≥ 24.21 or ≥ 26.8, `npm ci` done). The suites hand `MXC_MAC_EXEC`'s path as the runner; it is now read as `"mxc"`, so they exercise MXC through the SDK (`server/src/mxcSdk.ts`) for the first time on macOS — shell (`confinedBashMxcMac`), terminal through `spawnWithPty` (`terminalSandboxMxcMac`), canary, grants. A failure here is task 5.7, before 2.3.
  2. **Probe the capture**, as `scripts/probes/mxc-capture-denials.mjs` did on Windows (see `research.md`, "Measured on Windows 11"): the request is the development contract `1.1.0-alpha` (`dist/generated/v1_1_0_alpha/wire.d.ts`, `seatbelt.captureDenials`: `mode: "block"`, `outputPath`, `retainEtl`), sent through `@microsoft/mxc-sdk/v1/dev`'s `spawnJson(json, { experimental: true })` — the stable `v1` API `sdkRequest` targets does not carry it. Answer: the report's shape and where it lands; whether a path the profile denies by name is reported (on Windows it is not — the whole reason for `diagnose`); its cost per command (it reads `log stream`); what it needs (permissions for the unified log?); the noise beside a real refusal.
  3. **Then decide with the probe in hand**: reported as they happen (`fileReporting` → `"reported"`, end-of-output note as landstrip) or on demand (`diagnose`, as Windows: `confinedBash.ts` `diagnosable`, `mxcDiagnosticConfig`'s macOS equivalent, strictly narrower). Write it in `design.md` (the macOS row of the sources table is still the documentation's word) and the spec delta, as 1.3 did.
  4. **Translate**: `mxcReportRefusals` (`sandboxRefusals.ts`) is Windows' (`path.win32`, `SystemRoot`, `WindowsApps` noise); add the POSIX one beside it, filtered of what the probe shows as noise. Mach-service refusals are `info` (no rule names them).
  5. **Coverage**: `scenario-coverage.md` has six macOS/Linux rows `partial`; the macOS ones become `covered` once step 1 passes on a Mac or in CI's `mxc-macos` job.
- [x] 2.4 End a confined command's output with what the sandbox refused it.

## 3. Rules

- [x] 3.1 The rules store, per project, in the server's state; add it to the never-grantable targets.
- [x] 3.2 Consult rules before the host question and the directory request; apply always-allow directories when a command starts.
- [x] 3.3 Protocol and interface: recorded refusals, rules listed and revoked, "always allow" and "always refuse" in the existing dialogs.
- [x] 3.4 `sandbox.grants: "never"`: no rule created, none applied.

## 5. MXC through its SDK, everywhere

- [x] 5.1 Probe: the SDK inside a standalone executable on Windows (`scripts/probes/mxc-sdk-sea`): koffi, its platform package and `mxc_ffi` beside it.
- [x] 5.2 Node.js floor `^24.21.0 || >=26.8.0`: `engines`, CI, documented prerequisites.
- [x] 5.3 The agent's shell through `spawn`: ProcessContainer, WSLC, Bubblewrap, Seatbelt; the diagnosis through the SDK alone.
- [x] 5.4 `"mxc"` resolved to the SDK, an executor's path read as `"mxc"`; the self-check through `probe`.
- [x] 5.5 The terminal through `spawnWithPty` on Linux and macOS; on Windows MXC's executor with a policy file (the SDK 1.1.0 PTY puts the request on the command line, which a terminal's request outgrows).
- [x] 5.6 The standalone executable: `build-exe` places koffi, its platform package and `mxc_ffi`; the bundle loads them from beside it.
- [ ] 5.7 The real suites keyed on the SDK, not `MXC_EXEC`; CI's MXC jobs on Linux and macOS.

## 4. Verify

- [ ] 4.1 Each runner in its own job or machine: landstrip, MXC Linux, MXC macOS, Seatbelt, MXC Windows.
- [x] 4.2 The running app, with a break-it pass: a rule revoked mid-command, a rule on a directory deleted since, two clients answering at once.
- [ ] 4.3 `scenario-coverage.md`, `npm run check:scenarios`, `openspec validate durable-sandbox-rules --strict`, docs.
