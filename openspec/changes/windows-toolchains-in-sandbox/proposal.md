# Proposal

## Why

Under MXC on Windows, the agent's confined shell and the confined terminal run node, npm, pip, uv and javac,
but most other toolchains fail. Measured on Windows 11 24H2 with mxc-sdk 1.1.0, each case run in a project
that works unconfined:

| Tool | Confined today | Cause |
|---|---|---|
| gcc | "Cannot create temporary file in …\AC\Temp\" | A |
| go | "failed to initialize build cache at …\AC\go-build" | A |
| gcc (TEMP fixed), cmake | `cc1` and CMake's `Modules` not found | B |
| mvn | "-classpath requires class path specification" (`boot\` unreadable) | B |
| rustc, cargo | "no default toolchain is configured" | C |
| gradlew | lock file refused in the real `~\.gradle\wrapper` | C |
| `npm root -g` | `<project>\${APPDATA}\npm\node_modules` | C |

- **A.** pi-outpost passes `TEMP`, `TMP` and `LOCALAPPDATA` naming the command's private temporary
  directory; MXC replaces them with its container's `…\Packages\sandbox.{…}\AC` folders, which do not
  exist and cannot be written. Every tool that writes a temporary file or a cache under `LOCALAPPDATA`
  fails. `TMPDIR`, which MXC leaves alone, still names the right directory.
- **B.** Only the folder a `PATH` entry names is readable. An installation keeps the rest of itself beside
  that folder — `libexec`, `share`, `boot`, `lib` — and a tool installed at a drive's root (Strawberry,
  `C:\tools`) or in the profile sits among the folders denied by name.
- **C.** `USERPROFILE` names the command's temporary directory and `APPDATA` is not passed, so a tool
  looking for its home (`~\.rustup`, `~\.cargo`, `%APPDATA%\npm`, uv's Pythons) finds an empty folder, and
  one that asks Windows for the real profile (Java, so Gradle and Maven) finds it refused.

With the three remedies applied by hand — the variables restored, each installation readable, tool homes
redirected — gcc, cmake, `cargo test`, `go test`/`go build` (a module downloaded), `mvn test` and
`gradlew test` all pass confined. Caches kept per command made every command download again (Gradle: its
130 MB distribution each time), hence a cache that lasts.

## What Changes

- Under MXC on Windows, a confined command and a confined terminal start with `TEMP`, `TMP` and
  `LOCALAPPDATA` naming their private temporary directory, whatever MXC set.
- Each `PATH` folder named `bin`, `cmd`, `Scripts` or `sbin` has its installation — the folder above it —
  readable, read only, under #524's guard (never a drive's root, the home directory or above it, nor a
  folder holding or inside the agent directory or the configuration).
- A **sandbox cache**, `%LOCALAPPDATA%\pi-outpost\sandbox-cache\` (a setting moves it), writable by
  confined commands and read by nothing unconfined: Cargo's home, Gradle's user home, Go's module and
  build caches, Maven's repository, NuGet's packages, and npm's, uv's and pip's caches point there, so a
  dependency is downloaded once per user, not once per command. `APPDATA` names a folder of it, so npm's
  global prefix and other per-user state land there instead of in the project.
- The homes that hold toolchains and no credentials are readable, read only, when they exist: rustup's
  (`RUSTUP_HOME`, so `cargo` and `rustc` find their toolchain) and the Pythons uv installed
  (`UV_PYTHON_INSTALL_DIR`). Homes that hold credentials (`~\.cargo\credentials.toml`, `~\.m2\settings.xml`,
  `~\.gradle\gradle.properties`, `~\.npmrc`) stay out: those tools get the sandbox cache instead, and the
  user's mirrors and tokens with them do not apply inside.
- A variable the user set for the server (`CARGO_HOME`, `GOPATH`, …) is not followed into the profile: the
  sandbox's own values win, and the startup line says the sandbox cache's location.
- **MSYS2 programs** (`Git\usr\bin`'s `perl`, `bash`, coreutils) cannot start under tier 1: their runtime
  creates named objects in the global namespace a container may not use (`0xC0000142`, microsoft/mxc#1061;
  investigation finding 9). Their folders — a search-path folder holding `msys-2.0.dll` — are left out of a
  confined command's search path, so `perl` finds a native Perl (Strawberry, measured working) instead of
  crashing, and a command that names one directly ends with a note saying why it cannot start.
- **bun**: `bun run` and `bun test` work from bun 1.4.5 (1.3.x gave up when an ancestor folder could not be
  opened, oven-sh/bun#34875). `bun install` and `bun add` hit an MXC defect: a file rename relative to a
  directory handle (`NtSetInformationFile`, `FileRenameInformation[Ex]` with `RootDirectory`) fails with
  `STATUS_INVALID_HANDLE` inside the container while the same rename by absolute path succeeds — bun
  reports `EBADF accessing temporary directory`. A confined command failing that way ends with a note
  naming the cause; the fix goes upstream, an MXC issue with the reproduction. bun's install cache joins
  the sandbox cache (`BUN_INSTALL_CACHE_DIR`), so it works the day MXC's fix lands.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sandbox-runner-bash`: under MXC on Windows, the temporary-directory variables restored, installations
  behind the search path readable, the sandbox cache and the toolchain homes.
- `terminal`: the confined terminal under MXC on Windows gets the same.

## Impact

- `server/src/terminalSandbox.ts` (`toolInstallations`, `mxcTerminalConfig`, `confinedEnvironment`),
  `server/src/confinedBash.ts` (the command script's prologue), `server/src/terminalManager.ts` (the
  confined terminal's start), `server/src/config.ts` (the cache's location), the startup sandbox line.
- Builds on `windows-tool-installations` (#524): its launcher-following and guard are reused; its
  per-command npm/uv/pip caches move to the sandbox cache on Windows.
- A new directory under the user's profile, created on first use; disk use grows with the dependencies
  the agent's commands download (several hundred MB for a Gradle or Rust project).
- Documentation: `docs/sandboxing.md` (Windows 11: toolchains, the sandbox cache, what is not carried in —
  mirrors, credentials), `docs/configuration.md` (the cache setting).
- .NET is measured during implementation (its SDK was still installing when the matrix ran).
