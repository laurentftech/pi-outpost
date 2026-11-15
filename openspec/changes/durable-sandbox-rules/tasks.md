# Tasks

## 1. Verify on Windows 11 before building

- [x] 1.1 `processContainer.captureDenials` (`mode: "block"`) with a `1.0.0` request through `wxc-exec.exe` 1.1.0: the report's real shape, where it is written, what announces its path.
- [x] 1.2 Its cost per command, and what it needs beyond native PSEC.
- [x] 1.3 Correct `design.md` and the spec delta by what 1.1 and 1.2 show.

## 2. Record and tell

- [x] 2.1 One record type; translate landstrip's lines and the proxy's refused hosts into it.
- [x] 2.2 Windows: the `diagnose` option, its narrower rerun (no drive, no named denies, no network), the report read from its announced path, filtered, deleted, the announcement stripped.
- [x] 2.3 macOS, as they happen. Probed on an Apple M1 (`scripts/probes/mxc-capture-denials-mac.mjs`; `research.md`, "Measured on macOS"): Seatbelt's report holds explicit denies too, each file by its path, for about 50 ms, and no `file` entry is noise — so every command of the agent's shell under MXC on macOS asks for it on the development contract (`mxcMacCaptureRequest`, `seatbeltReportRefusals`; `design.md`, "On macOS, refusals are reported as they happen"), and falls back to the stable contract, reporting nothing of files, if the SDK refuses the document.

  **Found by PR #504's first CI run, and since fixed** (`research.md`, "Found on the way"):
  - **Linux, a confinement regression.** In process, `bwrap` held the server's environment where a command read it. Linux is back on `lxc-exec` with the command's environment (`mxcRunsInProcess`; `design.md`, "MXC runs through its SDK, but on Linux"). Asked upstream: an environment for the sandbox's launcher (microsoft/mxc#1783).
  - **The terminal through the SDK's PTY exited at once**: `mxcPty` took the SDK's `input` after `wait()`, which ends an input nobody took.
  - `check`: `e2e/sandbox-rules.spec.ts` reaches `server/src/pdf.ts`; `e2e/tsconfig.json` now includes the worker's declaration. Three tests written on Windows failed on POSIX and are fixed (`within` and `mxcReportFile` took the host's path rules; the missing-runner test named an executor now read as `"mxc"`).
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
- [ ] 5.7 The real suites keyed on the SDK, not `MXC_EXEC`; CI's MXC jobs on Linux and macOS. The suites pass on an Apple M1 (59 of 59) and in Docker (30 of 30); they are still switched on by `MXC_MAC_EXEC` and `MXC_LXC_EXEC` — on Linux that path is the executor really started — and CI has not run since.

## 4. Verify

- [ ] 4.1 Each runner in its own job or machine: landstrip, MXC Linux, MXC macOS, Seatbelt, MXC Windows. Done by hand: MXC macOS and Seatbelt (Apple M1), MXC Linux (Docker). Left: landstrip, MXC Windows after these changes, and CI.
- [x] 4.2 The running app, with a break-it pass: a rule revoked mid-command, a rule on a directory deleted since, two clients answering at once.
- [ ] 4.3 `scenario-coverage.md`, `npm run check:scenarios`, `openspec validate durable-sandbox-rules --strict`, docs.
