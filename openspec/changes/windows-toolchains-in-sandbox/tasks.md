# Tasks

## 1. The temporary directory

- [x] 1.1 Re-measure under the real SDK whether any request shape keeps `TEMP`, `TMP` and `LOCALAPPDATA` as sent (`inheritDefaultEnv`, `LOCALAPPDATA` omitted or explicit). Verify by recording the outcome in `design.md` and, if none does, a comment on an existing microsoft/mxc issue or a new one drafted for the user to approve. Done: MXC derives them from the `LOCALAPPDATA` it is given; the failure was pi-outpost's own deny of `LOCALAPPDATAPackages` (design.md, A). Nothing to report upstream.
- [x] 1.2 Under MXC on Windows, pass the command's and the confined terminal's private temporary directory as `LOCALAPPDATA`, so the container's profile and `TEMP` are created there (and, for the terminal under `wxc-exec.exe`, which does not create them, its shell starts by restoring the three from `TMPDIR`); landstrip unchanged. Verify with unit tests on the environment for both callers, and real-MXC tests `OnWindowsATemporaryFileCanBeCreated` and `OnWindowsTheTerminalHasAWritableTemp`.

## 2. Installations behind the search path

- [x] 2.1 Extend `toolInstallations` so a `bin`, `cmd`, `Scripts` or `sbin` entry adds its parent under the existing guard. Verify with unit tests on a fake reader: Strawberry, Maven, a JDK, Go, and `AnInstallationParentNeverOpensTheProfile` (a drive root `bin`, the home's `bin`, a folder holding the agent directory).
- [x] 2.2 Measure the launch time of a confined command with a realistic `PATH` before and after, through the SDK and `wxc-exec.exe`. Verify by recording both in `design.md`; keep the change only under 0.5 s added.
- [x] 2.3 Real-MXC tests: `OnWindowsCmakeFindsItsModules`, `OnWindowsMavenStarts`, `OnWindowsGccCompiles` (skipped when the tool is absent).

## 3. The sandbox cache and toolchain homes

- [ ] 3.1 `sandbox.cacheDir` (default `%LOCALAPPDATA%\pi-outpost\sandbox-cache`), refused when it is or holds the home, the agent directory or the configuration, or lies inside the sandbox root; carried over by Settings. Verify with config tests for `TheSandboxCacheIsNotTheUsers`.
- [ ] 3.2 The per-tool table and its variables in `confinedEnvironment` under MXC on Windows; the cache in `readwritePaths`, created on first use; npm's, uv's and pip's caches moved there from the temporary directory on Windows. Verify with unit tests on the environment and the request, and that Linux and macOS are unchanged.
- [ ] 3.3 `RUSTUP_HOME` and uv's Pythons readable and named, when they exist and pass the guard; Cargo's, Maven's, Gradle's and npm's homes never. Verify with request tests and a real-MXC `CargoCredentialsStayOut`.
- [ ] 3.4 Real-MXC tests: `ADependencyIsDownloadedOnce` (Go), `GradlesWrapperRunsConfined`, `NpmsGlobalPrefixIsNotInTheProject`, `OnWindowsCargoTestsConfined`, `UvFindsTheUsersPythons`, `OnWindowsTheTerminalBuildsAGoModule`; each skipped when its tool is absent.
- [ ] 3.5 State the sandbox cache's location on the startup sandbox line under MXC on Windows. Verify with a startup-line test.

## 4. MSYS2 and bun

- [ ] 4.1 Drop search-path folders holding `msys-2.0.dll` from the confined command's and terminal's `PATH`, say them on the startup line, and add the `0xC0000142` note for a command naming one. Verify with unit tests (fake reader) and real-MXC `OnWindowsPerlIsTheNativeOne` and `AnMsysProgramNamedDirectlyIsExplained`.
- [ ] 4.2 bun's install cache in the sandbox cache (`BUN_INSTALL_CACHE_DIR`, `BUN_TMPDIR`), and the note after bun's `EBADF accessing temporary directory`. Verify with unit tests on the note and real-MXC `OnWindowsBunRunsAndTests` and `BunInstallsFailureIsExplained` (skipped below bun 1.4.5).
- [ ] 4.3 Draft the MXC issue (the rename reproduction: `scripts/probes/` gets the probe) and the bun change (retry by absolute path on `STATUS_INVALID_HANDLE`, with a test), and show both to the user before posting anything. Verify by the drafts' text in the change folder and the user's answer.

## 5. Running app and documentation

- [ ] 5.1 Run the full matrix (`node`, npm, npx, pip, uv, gcc, cmake, cargo, javac, mvn, gradlew, go, dotnet, Strawberry Perl, bun run/test/add) confined, as is, and record it in `design.md`; add .NET's row now that its SDK is installed.
- [ ] 5.2 Through the real agent (a free OpenRouter model): ask it to build and test a Rust crate, a Gradle project, a Go module and a bun project (run and test) in turn, and to run a Perl one-liner, then read the transcript to confirm each finished without a grant. Then a monkey pass: two commands of different projects at once on the same cache, the cache folder deleted between commands, a command cancelled mid-download.
- [ ] 5.3 Document in `docs/sandboxing.md` (Windows 11: toolchains, the sandbox cache, what is not carried in, MSYS2 programs, bun's install limit and bun 1.4.5) and `docs/configuration.md` (`sandbox.cacheDir`). Verify links and JSON examples.

## 6. Integration

- [ ] 6.1 Write `scenario-coverage.md` for every scenario of this change, all `covered`; run `node scripts/check-scenario-coverage.mjs --change windows-toolchains-in-sandbox`, `npm run lint`, `npm run typecheck` and `openspec validate windows-toolchains-in-sandbox --strict`.

## Workflow follow-up

- Archive `windows-tool-installations` before this change, since this one builds on its requirements.
- Archive this change after review.
