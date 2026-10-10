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
| MXC (Microsoft eXecution Containers)? | On Windows 10 it falls back to the same AppContainer mechanism, with the same `NUL` wall but 0.3 s launches. **Its tier 1 (`CreateProcessInSandbox`) needs Windows 11 24H2/25H2 — to test on the Boot Camp Windows 11.** |

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

## Next: Windows 11 (Boot Camp)

The open question is whether **tier 1** behaves differently, above all for `NUL`:

1. Boot Windows 11, check the build is 24H2/25H2 at 26100/26200.9278 or later (`winver`), install Node 24
   and Git for Windows if absent; copy busybox-w32 to `%USERPROFILE%\tools\sh.exe` to include it.
2. From the desktop session (not SSH), in a checkout of this branch:
   `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\probes\mxc-probe.ps1`
3. Read `%USERPROFILE%\mxc-probe\results.txt`: the diagnostic line must name the tier
   (`BaseContainer` expected); then `NUL read/write`, `git --version`, `busybox 2>/dev/null`.
4. If tier 1 opens `NUL` and runs git: MXC becomes the candidate Windows runner for the confined terminal
   (`terminal.sandbox` with an MXC kind beside landstrip), and a candidate base for confining the agent's
   `bash` on Windows. If not: Windows confinement waits for upstream (landstrip#204, MXC maturity), and
   WSL stays the answer.
5. Also worth running there: the landstrip probes (`landstrip-git-nul.ps1`, `landstrip-shells.ps1`) to see
   whether Windows 11 changes landstrip's AppContainer behaviour, and the `readonlyPaths` question.

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

## Upstream

- landstrip/landstrip#203 — pi-landstrip launcher environment on Windows (issue).
- landstrip/landstrip#205 — the fix (PR, from `laurentftech/landstrip`, branch
  `pi-landstrip-windows-launcher-env`).
- landstrip/landstrip#204 — the null device, with the root cause and the busybox follow-up.
- landstrip/landstrip#40, #77 — earlier Windows reports (Git Bash in AppContainer; per-run ACL cost,
  maintainer waiting for `CreateProcessInSandbox`).
- `microsoft/mxc` — https://github.com/microsoft/mxc
