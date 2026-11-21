# Design

## Context

See proposal.md for the measured matrix. What the code does today, under MXC on Windows:

- `confinedEnvironment` (`terminalSandbox.ts`) builds an allowlisted environment: `USERPROFILE`, `TEMP` and
  `TMP` name the command's private temporary directory, `LOCALAPPDATA` is the server's (MXC needs it to
  start), `APPDATA` is absent, `npm_config_cache`, `UV_CACHE_DIR`, `PIP_CACHE_DIR` are in the temporary
  directory (#524). Measured inside: `TEMP`, `TMP` and `LOCALAPPDATA` arrive as
  `%LOCALAPPDATA%\Packages\sandbox.{guid}\AC[\Temp]`, which do not exist; `TMPDIR` arrives as sent.
- `mxcTerminalConfig` makes the drive readable, denies every folder beside the path down to the root by
  name, and re-allows the search path's folders and `toolInstallations` (#524: Git's layout, scoop shims,
  WinGet links, a linked folder, the `.venv`'s interpreter), all under one guard.
- The agent's shell runs each command as a script (`command.ps1`, or `command.sh` for busybox) through the
  SDK; the terminal starts its shell under `wxc-exec.exe` with a request file.
- Codex's MXC backend avoids all three problems by reading every volume and passing the real environment;
  pi-outpost keeps its allowlist (decided with the user: reads stay limited).

## Goals / Non-Goals

**Goals:**
- The toolchains of the matrix pass confined without per-project configuration.
- A dependency is downloaded once per user, not once per command.
- No credential file of the user becomes readable.

**Non-Goals:**
- Linux and macOS (not measured as failing; their runners pass the real temporary directory).
- The user's mirrors and tokens inside the sandbox (`settings.xml`, `.npmrc`, `credentials.toml`): a
  command that needs a private registry asks for a grant or the user configures it in the project.
- Making MSYS2 programs start (MSYS2's runtime and the OS: microsoft/mxc#1061) or `bun install` complete
  inside the container (MXC's handle-relative rename): both are fixed upstream; here they are kept out of
  the way and explained.

## Decisions

**A — give MXC a `LOCALAPPDATA` it can use.** Measured (task 1.1), through the SDK: MXC does not invent
its values, it derives them from the `LOCALAPPDATA` it is given — `LOCALAPPDATA` becomes
`<given>\Packages\sandbox.{guid}\AC` and `TEMP`/`TMP` `<given>\…\AC\Temp`, which it creates; with
`inheritDefaultEnvironment` the same. Launched alone they work. Under pi-outpost's policy the server's
`LOCALAPPDATA\Packages` is one of the folders denied by name beside the root's path (and for a root outside
the profile, all of `C:\Users` is), so the container cannot create or use its own profile. Under MXC on
Windows the command's and the terminal's `LOCALAPPDATA` is therefore their private temporary directory:
the container's profile, its `TEMP` and anything a tool keeps under `LOCALAPPDATA` (Go's build cache) land
in a folder already writable and deleted afterwards, and `Packages` — every Store app's data — stays
denied. landstrip keeps the server's value, which its AppContainer needs to start.

The terminal differs in one respect (measured): it starts under MXC's executor (`wxc-exec.exe`), which
derives the same paths but does not create the folders, so `TEMP` names one that does not exist. Its shell
therefore starts by pointing `TEMP`, `TMP` and `LOCALAPPDATA` back at `TMPDIR` (which MXC leaves alone):
PowerShell in the `-Command` it already starts with, `cmd` as `/K` (without quotes, which the request's
command line would escape as `\"`, unreadable to cmd). A shell the user gave other arguments, or another
shell, keeps them as configured.

**B — the parent of `bin`, `cmd`, `Scripts`, `sbin`.** Linux already reads the installation behind a `bin`
entry (`toolTrees`); Windows did not because landstrip's AppContainer re-granted every tree on each launch
(11–13 s). MXC's tier 1 applies a request in about 0.1 s, so the cost is measured (task) and accepted under
a ceiling. The guard is #524's `allowed` in `toolInstallations`, extended there rather than duplicated. Measured (task 2.2), a confined `exit 0` through the SDK with this machine's `PATH` (40 entries, six installations added: Strawberry's two, Maven, the JDK, Go, Python): median 1 773–1 783 ms before, 1 787–1 793 ms after, about +12 ms — PowerShell's own start dominates. A folder directly in the home directory is never taken (`~.cargo` holds `credentials.toml`); each installation is kept once, a wider one replacing folders inside it.

**C — one sandbox cache per user, outside the profile's own tool homes.** `%LOCALAPPDATA%\pi-outpost\
sandbox-cache` (or `sandbox.cacheDir`), in the request's `readwritePaths`, with one folder per tool
(`cargo`, `gradle`, `go\mod`, `go\build`, `m2`, `nuget`, `npm`, `uv`, `pip`, `appdata\Roaming`). Variables:
`CARGO_HOME`, `GRADLE_USER_HOME`, `GOMODCACHE`, `GOCACHE`, `GOPATH`, `MAVEN_OPTS=-Dmaven.repo.local=…`,
`NUGET_PACKAGES`, `DOTNET_CLI_HOME`, `npm_config_cache`, `UV_CACHE_DIR`, `PIP_CACHE_DIR`, `APPDATA`.
Alternatives rejected: per-command caches (measured: every command downloads again); the user's own caches
made writable (a package a confined command left would later run unconfined, and they sit beside
credentials). Per user rather than per project: one project's downloads serve the next, and every reader is
confined. The table is data, so a tool is added by a line.

**C — toolchain homes read only.** `RUSTUP_HOME` (the server's value, else `~\.rustup`) and uv's Pythons
(the server's `UV_PYTHON_INSTALL_DIR`, else `%APPDATA%\uv\python`) are added to `readonlyPaths` when they
exist and pass the guard, and named in the environment. Cargo's home is not read: `cargo` and `rustc` on
the search path are rustup's proxies (in `~\.cargo\bin`, already readable as a search-path folder), which
need only `RUSTUP_HOME`.

**MSYS2 folders leave the search path.** Measured: Strawberry's `perl.exe` runs confined; the `perl.exe`
in `Git\usr\bin` (MSYS2) dies with `0xC0000142`, as does every MSYS2 binary (finding 9). A folder holding
`msys-2.0.dll` is dropped from the confined command's and terminal's `PATH`, so the native program of the
same name is found; the startup line says which folders were dropped. A `0xC0000142` exit (`-1073741502`)
whose command names such a folder ends with a note, alongside the existing refusal notes.

**bun: what works, and the one wall.** Measured with bun 1.4.5: `bun run`, `bun <file>` and `bun test`
pass confined; 1.3.14 failed with `CouldntReadCurrentDirectory` (oven-sh/bun#34875, fixed). `bun add` /
`bun install` probe their temporary directory by renaming a file into the cache with
`NtSetInformationFile(FileRenameInformationEx, RootDirectory = cache handle)`. Reproduced outside bun:

| NT rename | unconfined | MXC tier 1 |
|---|---|---|
| any flags, name relative to `RootDirectory` (Ex and legacy class) | success | `0xC0000008` STATUS_INVALID_HANDLE |
| absolute `\??\C:\…` name (Ex and legacy) | success | success |

No location of cache or temporary directory avoids it. Node, Go, Rust and .NET rename by absolute path
(`MoveFileEx`) and are unaffected. The note matches bun's own message; the reproduction goes to MXC
(`upstream-mxc-issue.md`, posted after the user's review). A bun change retrying by absolute path was
drafted and dropped at the user's decision: the defect is MXC's.

**The sandbox cache must not be the user's.** `sandbox.cacheDir` is refused when it is or contains the
home directory, the agent directory, the configuration, or lies inside the sandbox root (where the agent
could place it to be read unconfined by the project's own tooling).

## Risks / Trade-offs

- [One project's command can leave a poisoned package in the cache another project's command uses] → every
  reader is confined; documented beside the setting; deleting the folder resets it.
- [Disk use grows: Gradle's distribution, Rust and Maven dependencies] → one folder, named on the startup
  line and in the docs.
- [The user's mirrors and private registries do not apply inside] → documented; the project's own
  configuration (`.cargo/config.toml`, `gradle.properties`, `.npmrc` in the root) still applies.
- [A parent made readable may hold more than the tool: `C:\Strawberry` holds Perl and C, a profile `bin`'s
  parent could be broad] → the guard refuses the home and above; a parent under the profile other than a
  known installation shape is measured during implementation before being kept.
- [Java tools other than Gradle and Maven read `user.home` from the real profile] → not handled; noted.

## Open Questions

- Whether a request field makes MXC keep `TEMP` (task 1.1); the prologue is the fallback either way.
