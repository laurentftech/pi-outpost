# Scenario coverage

Scenario inventory: `rg '^#### Scenario:' openspec/changes/sandbox-doctor-leak-evidence/` (13 scenarios, `sandbox-runner-bash`).

| Scenario | Status | Evidence |
| --- | --- | --- |
| ALeakIsNamedInTheDoctorReport | covered | `server/test/sandboxDoctor.test.ts` (TheDoctorNamesTheCanaryVerdict / "a leaking verdict is named in words…"): a `leaking` verdict with `reached: ["beside-root"]` renders `confinement: leaking (mxc) · checked … · reached: read a file beside the root` next to `decision log (last 0):`, and `--json` carries `confinement: { state, runner, checkedAt, reached }`. |
| AVerifiedShellSaysSo | covered | same describe, "a verified verdict says so…": renders `confinement: verified (mxc) · checked …`. |
| FailedUnavailableAndUnconfinedVerdictsRenderSafely | covered | same describe, "failed/unavailable/unconfined render…": `failed` reason is one line and ≤300 chars, `assertPasteSafe` over text/`--json`/bounded summary finds no env value, a `collectSandboxSnapshot` with `UV_INDEX_PASSWORD` in `serverEnv` leaks none; `unavailable`/`unconfined` render `reason:`. |
| TheAgentToolWithNoSettledVerdictYet | covered | same describe, "the agent tool reports `checking`…": `createSandboxDoctorToolDefinition(...).execute` with no settled verdict includes `confinement: checking`. |
| ANonMxcBackendDegrades | covered | same describe, "a non-MXC backend still shows the section…": linux/seatbelt snapshot with an `unavailable` verdict renders the confinement section with its reason while `policy` says the backend is not introspectable. |
| AGrantedToolBesideTheRootStaysOk | covered | `server/test/sandboxDoctor.test.ts` (PATH resolutions…): `classifyResolution("D:\\WRK\\Scoop\\…\\npm.ps1", "C:\\work\\app", granted, "win32")` → `ok` (also case-insensitive and trailing-slash variants via `outsideRootAndUngranted`). |
| AnUngrantedOutsideRootResolutionFails | covered | same describe: `classifyResolution("D:\\WRK\\other\\tool.exe", …)` → `fail (policy)` with "resolves outside the root and is not a granted path"; foreign drive `E:\x` and inside-root cases asserted via `outsideRootAndUngranted`. |
| AnUngrantedOutsideRootLinkTargetIsFlagged | covered | `server/test/sandboxDoctor.test.ts` (the link table…): a link with `outsideRoot: true, granted: false` renders `— OUTSIDE THE ROOT, NOT GRANTED`; the flag's computation uses the same `normalizePath`/`underNormalized` helpers the classifier tests pin. |
| AGrantedToolLinkIsNotFlagged | covered | same test: granted outside-root link and inside-root link render plain `(target readable)`; `--json` carries `outsideRoot`/`granted`. |
| ARelayProbeFailsWithAMultiLineError | covered | `server/test/sandboxDoctor.test.ts` (probe details are single-line): `oneLine` collapses the #582/#585-style error (`…«Uri».\nhttp://127.0.0.1:4473health»`) to one line with the URL intact; `renderSnapshot` renders a multi-line probe detail as one line; every detail from `runDoctorProbes` contains no `\n`. |
| BesideRootIsRefusedAtTheProvenLevel | covered | `server/test/sandboxDoctor.test.ts` (the beside-root canary replay probe): `besideRootProbeResult({ exitCode: 1, output: "[pi-outpost] … refused …" }, 2, marker)` → `ok (policy)` "refused at level 2" naming the bait. |
| BesideRootIsReachedThroughTheForeignDrive | covered | same describe: `besideRootProbeResult({ exitCode: 0, output: "canary" }, 2, marker)` → `fail (policy)` "reached at level 2" naming the bait path. |
| TheProbeIsSkippedWhenItCannotRun | covered | same describe: `runDoctorProbes` on a non-MXC runner includes `beside-root canary replay` as `skipped` with the reason; the no-runner case is the existing skipped-battery test. |

Live confined probe (real MXC launch, marker read at the proven level) is exercised by the Windows/MXC smoke task (tasks.md 5.3), not by the Linux-runnable unit tests.
