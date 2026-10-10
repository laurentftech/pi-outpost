# Investigation: confining shells on native Windows

Status: open (2026-10-10). Started from the `confined-terminal` change (run pi-outpost's web terminal
inside a sandbox runner) and from "the agent's `bash` through pi-landstrip seemed stuck on Windows".
This page records what was measured, the traps hit while measuring, and what to test next, so the
investigation can restart from here.

## Where things stand

| Question | Answer so far |
| --- | --- |
| Does pi-outpost's confined terminal work on Linux? | Yes: landstrip (Landlock + seccomp) under Docker's default profile; reads, writes, `/proc` escape and signals all confined. |
| On Windows 10, landstrip? | Reads and writes confined; `cmd`, PowerShell, `whoami` run; **`git` and anything using `/dev/null` fail** (the null device, below); Git Bash cannot start (MSYS2). The terminal opens PowerShell when confined. |
| The agent's `bash` through pi-landstrip on Windows? | Blocked by a pi-landstrip bug (launcher environment, os error 203): **fixed in PR landstrip/landstrip#205**. Even then: Git Bash cannot run, busybox runs until `/dev/null`. |
| Can the null device be fixed? | Yes, but only by an administrator, once per boot (landstrip/landstrip#204). |
| MXC (Microsoft eXecution Containers)? | On Windows 10 it falls back to the same AppContainer mechanism, with the same `NUL` wall but 0.3 s launches. **On Windows 11 (tier 1, `BaseContainer`) the `NUL` wall is gone**: `NUL`, `/dev/null`, `git` and busybox (pipes included) work, confined, in ~0.1 s (finding 7). Native git works with the drive root readable and everything beside the project denied (finding 8); Git Bash cannot start until MSYS2 changes (finding 9). |

## Findings

### 1. Probe from the interactive session, never over SSH

Processes started by the OpenSSH server live in a non-interactive service session. AppContainers there
get no window station, so every program that loads `user32.dll` dies with `0xC0000142`
(STATUS_DLL_INIT_FAILED). This produced a false "landstrip cannot start user32 programs" theory, and a
draft upstream issue that was withdrawn. `scripts/probes/run-interactive.ps1` runs a command in the
logged-on user's desktop session from SSH (a one-shot scheduled task with `/IT`); someone must be logged
on to the VM's desktop.

Two more measurement traps: Windows PowerShell 5.1 reads UTF-8 scripts without a BOM as ANSI (keep
`.ps1` files ASCII), and writes a BOM with `-Encoding UTF8` (which MXC's JSON parser rejects). `cmd`
interprets `>` and `|` in `set VAR=...`: pass commands base64-encoded (`BASH_CALL_COMMAND_B64`).

### 2. The null device is out of reach in an AppContainer

`\Device\Null`'s DACL grants Everyone, SYSTEM, Administrators and RESTRICTED, and has **no ACE for
ALL APPLICATION PACKAGES (S-1-15-2-1)**. An AppContainer token passes a second access check where only
its package SID, capabilities and that group count, so `NUL` is refused whatever the policy: `type nul`
and `echo x > nul` fail in `cmd`, Git for Windows dies at startup (`could not open '/dev/null'`), and
busybox fails on any `2>/dev/null`.

Proof: adding `ALL APPLICATION PACKAGES: read/write` to `\Device\Null` from an elevated session
(`scripts/probes/grant-null-device-to-appcontainers.ps1`, `-Remove` to undo) makes `NUL` and
`git --version` work inside the container. Device security descriptors are rebuilt at boot, so a real
fix needs something elevated at every boot (a startup task installed once by an administrator). On a
managed machine, that means IT. Reported with the proof in landstrip/landstrip#204.

### 3. Shells

| Shell inside the AppContainer | Result |
| --- | --- |
| `cmd`, PowerShell 5.1 | run |
| busybox-w32 (native) | runs; fails on `/dev/null` (finding 2); needs the standard container, `lpac` breaks its sockets (`WSAStartup failed, error 18`) |
| Git Bash / MSYS2 `sh` | cannot start: `NtCreateDirectoryObject(\BaseNamedObjects\msys-2.0S5-...)` — global named objects are forbidden to containers (also landstrip/landstrip#40) |
| Git for Windows `git` | dies on `NUL` (finding 2) |

pi's `bash` tool needs a bash-compatible shell, so PowerShell cannot stand in for the agent; the human
terminal can use anything.

### 4. pi-landstrip on Windows (agent `bash`)

From the interactive session, pi-landstrip 0.19.8–0.19.11:
1. Default policy: the first call stops on `Read blocked: "C:\Program Files\Git\bin\bash.exe" is not in
   allowRead` — a dialog in pi-outpost, so `bash` looks stuck.
2. Git allowed: every launch fails with `os error 203`: the launcher environment carries only `PATH`,
   `HOME`, `ProgramData`; the runner needs `LOCALAPPDATA`, the child `SystemRoot`. **Fix: PR
   landstrip/landstrip#205** (also issue #203).
3. With the fix, busybox as pi's `shellPath` (copied as `sh.exe`) and `windows.appContainerMode:
   "standard"`: commands run, writes outside are refused, reads outside are asked about. `/dev/null`
   still fails (finding 2).

### 5. Launch time (landstrip, AppContainer + DACL)

AppContainer access is granted by stamping ACEs on every allowed tree at each launch, and Windows
propagates them through every existing descendant (landstrip/landstrip#77). Measured for one `cmd /c
echo`: `C:\Windows` + root 0.16 s; + Git's installation 4 s; + all 15 `PATH` entries 16 s, of which
`AppData\Roaming\npm` alone 13 s. pi-outpost's Windows policy therefore leaves out `PATH` entries inside
the user's profile: first PowerShell prompt 15.5 s → 5.5 s. MXC's tier 3 (same mechanism, smaller
grants) launches in about 0.3 s.

### 6. MXC — Microsoft eXecution Containers

`microsoft/mxc` (MIT, SDK `@microsoft/mxc-sdk` 1.0.0, Node ≥ 24; executor `wxc-exec.exe` taking a JSON
request). Backend `processcontainer` picks the strongest tier the host supports:
1. **BaseContainer** — `Experimental_CreateProcessInSandbox` in `processmodel.dll`; the OS applies the
   policy itself. Windows 11 24H2/25H2 with the August 2026 update or later (26100/26200.9278+).
2. AppContainer + Brokered File System — compiled out of stock builds.
3. AppContainer + DACL — what landstrip does.

Measured on Windows 10 (tier 3, since `processmodel.dll` is absent there), `scripts/probes/mxc-probe.ps1`:
confinement holds (sibling secret, agent `auth.json`, writes outside the zone and in the profile all
refused), launches take ~0.3 s, `whoami` and PowerShell run **once `ui: { disable: false }` is set**
(MXC blocks Win32k by default and anything loading `user32.dll` then fails), `NUL` and so `git` fail as
with landstrip, Git Bash cannot start, and a root declared in `readonlyPaths` (with a writable zone
nested inside it) is unreadable while the same root as `readwritePaths` is readable — to understand.

The README warns that no MXC profile should be treated as a security boundary yet; the OS API is still
`Experimental_`.

### 7. MXC tier 1 on Windows 11

Measured 2026-10-10 on Windows 11 Home 24H2 build 26100.9457 (Boot Camp, x64; the registry's
`ProductName` still says "Windows 10", a known Windows 11 quirk), from the console session, MXC SDK
1.0.0, Git for Windows 2.45.1, busybox-w32 64-bit. `mxc-probe.ps1` for the battery, then
`mxc-run.mjs` to take the anomalies apart.

`processmodel.dll` exports `Experimental_CreateProcessInSandbox` and `--debug` reports `selected
isolation tier: base-container`, runner `BaseContainer`, "process security environment created
(processmodel.dll)". No ACL stamping: the OS applies the policy itself, and `whoami` answers the
user's own name. It is still an AppContainer underneath: kernel32 puts named objects in
`\Sessions\1\AppContainerNamedObjects\S-1-15-2-…` (finding 9).

| Check | Tier 1 |
| --- | --- |
| Confinement: sibling secret, agent `auth.json`, write elsewhere in the root, write in the profile | all refused; no file left behind |
| Readable root with a writable zone nested in it (`readonlyPaths` + `readwritePaths`) | readable, so the tier 3 anomaly (finding 6) does not occur here |
| `NUL` read and write in `cmd` | **work** (they fail at tiers 3 and under landstrip) |
| `git --version` | **works** |
| busybox `>/dev/null`, `2>/dev/null`, `cat /dev/null`, pipes, `git` called from busybox | **work**, provided busybox's own folder is readable (below) |
| PowerShell 5.1 | runs, 2.3 s |
| Git Bash, and every MSYS2 binary (`usr\bin\true.exe` too) | `0xC0000142` at start |
| Launch | 0.1 s for `cmd`, busybox or git |

Three things that are not what they look like:

- **busybox "unable to spawn shell"**: busybox-w32 re-launches its own executable for pipes and any
  command that is not the last one. If its folder is not readable, every such command fails, which the
  first battery mistook for a `/dev/null` failure (exit 2, no output). With `~\tools` in
  `readonlyPaths`, all of it works. The probe now adds that folder.
- **Git Bash**: MXC's message blames Win32k and says to set `ui.disable: false`, which is already set.
  `msys-2.0.dll` imports no `user32`, `true.exe` fails the same way, and `whoami`/PowerShell (which do
  load `user32`) run. The failure is in the MSYS2 runtime's own initialisation (finding 9). The native
  `mingw64\bin\git.exe` is unaffected.
- **git cannot find its working directory**: `git --version` runs, but `init`, `status`, `rev-parse`
  die on `unable to get current working directory: Permission denied` (finding 8).

### 8. Native git under tier 1: the working directory

Probes: `path-apis.cs` (each Win32 path call, inside the sandbox), `mxc-run.mjs`,
`mxc-deny-siblings.mjs`.

**Cause: the sandbox cannot reach the Mount Manager.** `GetVolumeNameForVolumeMountPointW("C:\")` is
refused, so Windows cannot turn `\Device\HarddiskVolume3\…` into `C:\…`:
`GetFinalPathNameByHandleW` fails with error 5 for every `VOLUME_NAME_DOS` request, whatever the policy,
`C:\` readable or not, and succeeds with `VOLUME_NAME_NT`. Git for Windows' `mingw_getcwd` calls it, then
falls back on `GetLongPathNameW`, which lists every parent folder by name, so it succeeds only when the
drive root and each ancestor can be listed. Node's `fs.realpathSync.native` (libuv, same call, no
fallback) fails with EPERM in every configuration tried. That will hit Node tools, npm included, until
MXC fixes it. The fix belongs to MXC (or the OS policy): **to report**, with `path-apis.cs` as the
reproduction.

**Workaround that works today: drive root readable, every sibling denied by name.** On this repository
(`C:\Users\lfran\pi-outpost`, writable), with `C:\` readable and a deny for every entry of `C:\`,
`C:\Users`, `C:\Users\lfran` other than the path down to the project (and the system folders at the
root), as `mxc-deny-siblings.mjs` computes it (65 entries here):

| Check | Result |
| --- | --- |
| `git status`, `log`, `diff`, `rev-parse` from a subfolder | work |
| `~\.gitconfig`, `~\.ssh\id_ed25519.pub`, the Recycle Bin, a sibling folder at `C:\` | refused |
| OneDrive, iCloudDrive (cloud placeholders) | refused (they were readable until denied explicitly) |
| through the compatibility junctions (`C:\Documents and Settings\…`, `Application Data`) | refused |
| `~\.gitconfig` added back read-only (kept out of the denies, listed in `readonlyPaths`) | `git config user.name` reads it; `git config --global` cannot write it |
| writes in the profile / in the project | refused / allowed |
| launch | ~0.15 s, 65 denies included |

Two kinds of deny entry make `CreateProcessSecurityEnvironment` reject the whole policy: a junction or
symlink (`0x8007010B`) and a file that cannot be opened, such as the loaded `NTUSER.DAT` (`0x80070020`,
sharing violation). The script leaves both out; the junctions point at folders that are denied, or
system, anyway.

Limits of this workaround: it is a deny list, computed at launch, so an entry created afterwards next to
an ancestor is readable, as is anything else on `C:\` outside the user folders (`ProgramData`, `Program
Files`). Folder names stay listable (`dir C:\Users\lfran` shows names, not contents). A commit with
`commit.gpgsign = true` needs gpg and its keyring, which are denied.

Dead ends, kept so nobody walks them again:
- **A project outside the profile** (`C:\mxc-lab\app`): fails the same way; the root is what matters.
- **`subst` the project to a drive letter**: git works when the project is a writable *subfolder* of the
  substituted drive, but not at its root. There the drive root is a readonly cwd (below), or, when
  writable, the whole `.git` becomes unreadable through the substituted path (the same folder declared
  through its `C:` path reads fine). A junction to the project in a substituted folder: MXC refuses the
  `chdir` through the junction.
- **A `readonlyPaths` folder cannot be a working directory or be listed**: `cd`, `dir` and
  `SetCurrentDirectoryW` are refused inside it, while its files read fine (the initial cwd set by the
  executor is the exception). A confined terminal's project is writable, so this only matters for
  read-only roots.

### 9. Git Bash under tier 1: MSYS2's named objects

`named-objects.cs` inside the sandbox: kernel32 names (`Local\`, `Global\`, mutexes, file mappings) work
and land in `\Sessions\1\AppContainerNamedObjects\<package SID>\`, where creating an object directory
also works. The raw NT paths `\BaseNamedObjects` and `\Sessions\1\BaseNamedObjects` are refused
(`0xC0000022`). The MSYS2 runtime (Cygwin's `shared.cc`, `get_shared_parent_dir` /
`get_session_parent_dir`) creates its `msys-2.0S5-…` directory with `NtCreateDirectoryObject` on exactly
those raw paths, so `msys-2.0.dll` fails to initialise; this machine's runtime (3.4.10) has no
`AppContainerNamedObjects` path. With finding 8's policy (`C:\` readable), MSYS gets far enough to say
so itself: `bash.exe: *** fatal error - NtCreateDirectoryObject(\BaseNamedObjects\msys-2.0S5-1888ae32e00d56aa):
0xC0000022`. No filesystem policy gets past it.

Upstream already knows: **microsoft/mxc#1061**, open. An MXC maintainer answers that tier 1 support
needs both a fix in MSYS's `get_session_parent_dir()` to use a non-global namespace and BNO namespace
virtualization in the OS, and that pre-creating the directories with an `ALL APPLICATION PACKAGES` ACE
did not work. Nothing on the MSYS2 or Git for Windows side. Another project confining Git Bash with a
restricted token (buhuikongpan/dsh-win-gitbash#10, MSYS 3.6.10) hit the same named objects and then
MSYS's signal pipe (`couldn't create signal pipe, Win32 error 5`, its DACL lacks the sandbox's SID).
Git Bash under any Windows sandbox therefore waits for the MSYS runtime, and probably for the OS.

## Where this leaves the goal: a Windows sandbox with Git for Windows only

| Piece | Today, MXC tier 1 |
| --- | --- |
| Native `git.exe` (all ordinary commands) | **works**, with the deny-siblings policy (finding 8) |
| `cmd`, PowerShell as the terminal's shell | work |
| Git Bash as the terminal's shell or pi's `bash` | **blocked** upstream (finding 9) |
| A bash-compatible shell for pi's `bash` tool | only busybox-w32, an extra 700 KB executable |
| Node tools inside (`npm`, `npx`, pi extensions) | at risk: `realpathSync.native` always fails (finding 8) |

## Next

1. **Follow microsoft/mxc#1464**, the Mount Manager refusal (finding 8), reported 2026-10-10 with
   `path-apis.cs`: it breaks git's cwd and Node's `realpath.native`, and the fix would remove the need
   for the deny list.
2. **Follow microsoft/mxc#1061** for Git Bash; until then pi's `bash` on Windows needs busybox.
3. **Prototype the confined terminal on tier 1**: `terminal.sandbox` with an MXC kind beside landstrip,
   PowerShell or `cmd` as the shell, the project writable, `C:\` readable with the computed denies,
   `~\.gitconfig` read-only. Requires Windows 11 24H2 with the August 2026 update, Node ≥ 24 for the SDK,
   and acceptance of an `Experimental_` OS API.
4. Measure how much of Node works inside (`npm --version`, `npm ls`, a pi extension).
5. Not yet run on this machine: the landstrip probes (`landstrip-git-nul.ps1`, `landstrip-shells.ps1`), to
   see whether Windows 11 changes anything for landstrip's AppContainer.

## Probes

All in `scripts/probes/`, each with a header saying what it shows and how to run it.

| Probe | Shows |
| --- | --- |
| `winps.sh` | Runs PowerShell on the VM over SSH (`ssh utm-win`), encoded. |
| `run-interactive.ps1` | Runs a command in the VM's interactive desktop session from SSH. |
| `confined-terminal-windows.mts` | pi-outpost's `TerminalManager` + real landstrip + default shell, end to end. |
| `landstrip-shells.ps1`, `landstrip-run.mjs` | Which shells start under landstrip; one command with exit code and output. |
| `landstrip-interactive.ps1` | The shells battery from the interactive session. |
| `landstrip-git-nul.ps1`, `landstrip-busybox-devnull.ps1` | The null device: `cmd`, git, busybox. |
| `grant-null-device-to-appcontainers.ps1` | Adds/removes the `\Device\Null` ACE (elevated): the #204 proof. |
| `landstrip-windows-tuning.ps1` | Launch time per allowed tree; null-device spellings. |
| `pe-imports.mjs` | A PE's imported DLLs (used while ruling out the SSH artefact). |
| `pi-landstrip-bash.mjs`, `patch-pi-landstrip-launcher-env.cjs` | The agent's `bash` through pi-landstrip, variants `default`/`policy`/`busybox`; the local launcher fix. |
| `mxc-probe.ps1` | The same battery through MXC's `processcontainer`, with the tier it picked. |
| `mxc-run.mjs` | One-off commands through MXC with extra readable/writable/denied roots (after `mxc-probe.ps1`). |
| `mxc-deny-siblings.mjs` | The deny list for "drive root readable, everything beside the project denied". |
| `path-apis.cs` | Each Win32 path call (`GetFinalPathNameByHandleW`, `GetLongPathNameW`, `SetCurrentDirectoryW`, Mount Manager) inside a sandbox. |
| `named-objects.cs` | Which named kernel objects a sandboxed process may create, and where kernel32 redirects them. |

## Upstream

- landstrip/landstrip#203 — pi-landstrip launcher environment on Windows (issue).
- landstrip/landstrip#205 — the fix (PR, from `laurentftech/landstrip`, branch
  `pi-landstrip-windows-launcher-env`).
- landstrip/landstrip#204 — the null device, with the root cause and the busybox follow-up.
- landstrip/landstrip#40, #77 — earlier Windows reports (Git Bash in AppContainer; per-run ACL cost,
  maintainer waiting for `CreateProcessInSandbox`).
- `microsoft/mxc` — https://github.com/microsoft/mxc
- microsoft/mxc#1061 — MSYS2/Cygwin runtimes cannot initialise in `processcontainer` (open).
- microsoft/mxc#1464 — `GetFinalPathNameByHandleW(VOLUME_NAME_DOS)` fails under `BaseContainer`: git's
  cwd, Node's `realpath.native` (ours, open).
- buhuikongpan/dsh-win-gitbash#10 — Git Bash under a restricted token: named objects, then the signal pipe.
