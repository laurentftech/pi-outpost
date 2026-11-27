# Sandboxing

pi-outpost confines its own file tools, and by default the agent's shell too: a configuration that says
nothing about the sandbox gets one, and the server picks this machine's runner for the shell. The
terminal panel is confined only when you name a runner for it.

- [The default](#the-default)
- [Recommended setup](#recommended-setup)
- [What is confined](#what-is-confined)
- [Linux: landstrip](#linux-landstrip)
- [Linux, as an option: MXC](#linux-as-an-option-mxc)
- [macOS on Apple silicon: MXC](#macos-on-apple-silicon-mxc)
- [macOS, every Mac: Seatbelt](#macos-every-mac-seatbelt)
- [Windows 11: MXC and PowerShell](#windows-11-mxc-and-powershell)
- [Older Windows](#older-windows)
- [Check that it is really confined](#check-that-it-is-really-confined)
- [Alternative: hand bash to an extension](#alternative-hand-bash-to-an-extension)

## The default

Without a `sandbox` section, the configuration behaves as if it held:

```json
{ "sandbox": { "allowWrite": true, "allowBash": true, "bashRunner": "auto" } }
```

The agent reads and writes inside the project (the working directory), and its shell runs under the
runner `"auto"` picks:

| Platform | Runner | Shell |
| --- | --- | --- |
| Windows 11 | [MXC](#windows-11-mxc-and-powershell) | PowerShell (the agent gets a `powershell` tool) |
| Linux | [MXC](#linux-as-an-option-mxc) | `/bin/bash` |
| macOS | [Seatbelt](#macos-every-mac-seatbelt) | `/bin/bash` |

The runner is used only after its self-check and the [canary](#check-that-it-is-really-confined) have
both passed. The session does not wait for them: a command issued earlier waits, then runs. If they
fail (an [older Windows](#older-windows), a Docker container without user namespaces, a leak), the shell
**refuses every command** and says why. Nothing falls back to running unconfined.

| You want | Write |
| --- | --- |
| An unconfined shell (a machine nothing can confine yet) | `"bashRunner": "none"` in `sandbox` — in the file only, never from Settings; `pi-outpost config --unconfine` writes it. With `"bashShell": "powershell.exe"` the agent gets its `powershell` tool, otherwise `bash` |
| No sandbox at all, as before this default | `"sandbox": false` — the shell's lock is shown open, saying the sandbox is turned off, and highlighted with `pi-outpost config --confine` when this machine can confine; there is none when the agent has no `bash` tool, or under the `rpc` runtime, whose child shell pi-outpost does not judge |
| Another runner, a shell, allowed hosts | see [Recommended setup](#recommended-setup) |

An existing `sandbox` section keeps its meaning: `allowBash` without a `bashRunner` is still an unconfined
shell. Its lock is shown open. When this machine's runner passes its self-check, the lock is highlighted
and says so, as do the startup log and `pi-outpost doctor`. One command confines it:

```sh
pi-outpost config --confine
```

It runs the self-check and the canary, and only if both pass sets `"bashRunner": "auto"` in the file,
changing nothing else. Otherwise the file is left as it was and the reason printed.

With `"sandbox": false`, the same command turns the sandbox back on: once both checks pass, it replaces
`false` with the default sandbox (writing allowed, `allowBash` on, `"bashRunner": "auto"`), and says so —
the agent's file tools are then limited to the project too. It refuses under the `rpc` runtime, where no
sandbox can be enforced.

## Recommended setup

Name the same runner for the agent's `bash` (`sandbox.bashRunner`) and for the terminal
(`terminal.sandbox`):

| Where the server runs | Runner | Shell (`sandbox.bashShell`) |
| --- | --- | --- |
| Linux: a Docker container, the host, a VM, WSL2 | [landstrip](#linux-landstrip) or [MXC](#linux-as-an-option-mxc) — current versions need namespace permissions in Docker; see the [Docker recipe](docker.md) | `/bin/bash`, the default |
| Windows 11 with the August 2026 update or later | [MXC](#windows-11-mxc-and-powershell): `"mxc"`, installed with pi-outpost | `powershell.exe` (the agent gets a `powershell` tool), busybox-w32's `sh.exe`, or — experimental — a real bash in a [Linux container](#a-real-bash-wslc-experimental) (`sandbox.bashImage`) |
| Older Windows | none works natively: see [Older Windows](#older-windows) | |
| macOS on Apple silicon | [MXC](#macos-on-apple-silicon-mxc): `"mxc"`, installed with pi-outpost — or [Seatbelt](#macos-every-mac-seatbelt): `"seatbelt"` | `/bin/bash`, the default |
| macOS on Intel | [Seatbelt](#macos-every-mac-seatbelt): `"seatbelt"`, part of macOS | `/bin/bash`, the default |

pi-outpost writes the runner's policy from the configuration, so a command cannot widen it. A
missing or failing runner refuses every command; nothing falls back to running unconfined.

The network stays open (`git fetch`, `npm install` work). Under MXC (Windows 11, Linux, Apple-silicon macOS), Seatbelt (macOS) or landstrip on Linux, `sandbox.allowedHosts` limits it
to the hosts you name and asks you about the others ([below](#the-network-only-named-hosts)). Elsewhere,
close it around the server — a Docker network, a firewall — or [hand `bash` to an extension](#alternative-hand-bash-to-an-extension)
that filters it.

## What is confined

| | Confined |
| --- | --- |
| `read`, `ls`, `grep`, `find` | To `sandbox.root`, symlinks resolved, plus read-only the directories of the skills the session loaded — never the disk's root, the home directory, or one holding the agent directory. |
| `edit`, `write`, document tools | To `sandbox.writableRoot`, with `allowWrite` only. Never inside a `.pi` directory, where an extension's policy may live, and never pi-outpost's configuration file, which sets the sandbox. |
| `bash` (`allowBash`) | **Only with `bashRunner`** — `"auto"` by default — or `bashFrom`. With `"none"`, or `allowBash` and no runner in a section of your own, it can do anything the server's user can. With a PowerShell `bashShell`, the agent's shell tool is `powershell` instead, confined the same way. |
| The terminal panel | **Only with `terminal.sandbox`.** |
| Extensions, MCP servers | **No.** They run with the server's rights, or their own process's. The project's own load only once you allow them ([below](#the-projects-extensions-allowed-one-by-one)). |

Pi's own `bash`, `powershell`, `edit` and `write` are never registered in a sandbox, so nothing can
switch them back on. The file tools' confinement is pi-outpost checking paths, not an operating-system
boundary; the runner is one.

### The project's extensions: allowed one by one

A pi extension is code pi loads into the server itself: it is not confined, and runs with every right of
your account. The agent may write one in the project — that is part of what pi is — and a cloned
project may bring some. So what the project brings is loaded only once you have allowed it: the files
under `.pi/extensions/` (a directory extension as a whole), the extensions its `.pi/settings.json`
names, the packages it lists, which pi would install, and the MCP servers its `.pi/mcp.json`
defines — a command the server would start, or a URL it would connect to.

At each new session, one not allowed for its current content is left out, and the interface asks: its
path and size, that it would run outside the sandbox, its code one click away, **Allow** or **Refuse**.
Allowed while the agent is idle, the session restarts with it; while it works, it loads with the next
session. Both answers are kept, per project, under the agent directory, out of every confined command's
reach. A change to the file asks again. Settings → Extensions lists what you decided, and withdrawing a
decision asks at the next session. A package you install into the project from Settings is allowed by
that act. Extensions of your own (`~/.pi/agent`) are not asked about.

With no one to ask (`pi-outpost -p`), an extension not allowed is left out and named on stderr. The pi
CLI run in the folder has its own question, about the whole folder.

Under a runner, a command (or a terminal) may:

| | |
| --- | --- |
| Read | The sandbox root, the system directories, the tools on the `PATH`, a private temporary directory, and the directories you list in `sandbox.readOnlyPaths` ([below](#tools-installed-for-you-sandboxreadonlypaths)). |
| Write | The writable zone and the private temporary directory. Nothing with `allowWrite: false`. |
| Not write | The repository's `.git` at the root of the writable zone, when it exists: its configuration and hooks name commands git runs, for you too, later. Reading it, `git status`, `git diff` and `git log` work; a commit asks for a grant on it ([below](#grants-beyond-the-sandbox-when-you-say-so)), and "for this session" covers a session's commits. A repository nested deeper in the project is not held. `sandbox.gitWritable: true` leaves it writable. The terminal is not held. |
| Never | The agent directory (`auth.json`, the keys) and the configuration file. |
| Environment | `PATH`, locale, `TERM`, `SHELL`, `HOME` set to the root, npm's, uv's and pip's caches in the temporary directory (`npm_config_cache`, `UV_CACHE_DIR`, `PIP_CACHE_DIR`: never your own cache made writable, where a package left by a command would later run unconfined), the shell's history there too (`HISTFILE`, and `ZDOTDIR` for zsh) so none is left in your project, `GIT_CONFIG_GLOBAL` naming your `~/.gitconfig` (read-only, for git's identity — with the global ignore and attributes files it names in `core.excludesFile` and `core.attributesFile`, read-only too); on Windows `USERPROFILE`, `TEMP` and `TMP` point to the temporary directory; your proxy variables when the network is open, never one carrying a password ([below](#behind-a-company-proxy)). None of the server's other variables, so no provider key. |
| Signal | No process outside the sandbox. |

The repository's `.git/config` names commands git runs (`core.fsmonitor`, filters, diff drivers). The agent's commands cannot write it by default (the *Not write* row above). And whatever is written there — with `sandbox.gitWritable`, a grant, or in a repository nested deeper — the git pi-outpost itself runs, unconfined, for the Files badges and the history, overrides every such key: nothing written there runs in the server. Your own tools still read that file: an editor's git integration or a prompt that shows git status would run what it names.

Output, exit status, timeout and cancellation behave as for an unconfined `bash`, with one difference: a
command given no timeout is stopped after 300 seconds, its output ending with a sentence that says so —
a server started to check it answers would otherwise hold the turn for ever. Commands the model
asks for in one message run one after another, in the order it wrote them, where pi would run them
together: each starts a runner first, and a step that depends on the previous one (create, then
rename) would otherwise overtake it. Each project's
commands and terminals are confined to that project's root. Each command runs in a sandbox of its own, ended with it: a process it starts in the background (`Start-Process`, `Start-Job`, `&`, `nohup`) ends when the command does — the agent is told so, and to keep a server inside one command with a timeout, or in the terminal. Under MXC on Windows there is no WMI (`Get-CimInstance` fails) and `Get-Process` lists only the command's own processes. A drive of your session the sandbox does not reach (a mapped network drive) made PowerShell print an `InitializeDefaultDrives` error at the start of every command; that line is left out. In a confined command `HOME` (`~`) is the project; on Windows `USERPROFILE`, `TEMP` and `LOCALAPPDATA` are the command's own throwaway folders and `APPDATA` the sandbox cache. Your own home is named in `PI_OUTPOST_USER_HOME`, and the agent is told a `~/…` path you or a document give is there: it asks `run_with_grant` to read it. The variable is a path, not an access. Settings never edit `bashRunner` or
`bashShell`.

## Linux: landstrip

```json
{
  "sandbox": { "root": "/work/app", "allowWrite": true, "allowBash": true, "bashRunner": "/opt/landstrip/bin/landstrip" },
  "terminal": { "enabled": true, "sandbox": "/opt/landstrip/bin/landstrip" }
}
```

landstrip is not bundled. Fetch it and run its self-check **where pi-outpost runs** — inside its
container when it has one:

```bash
npm pack @landstrip/landstrip-linux-x64            # or -linux-arm64
tar xzf landstrip-landstrip-linux-x64-*.tgz        # the binary is package/bin/landstrip
./package/bin/landstrip --appimage-extract         # no FUSE device needed
./squashfs-root/usr/bin/landstrip doctor           # {"ok":true,…,"implementation":"landlock+seccomp"}
```

The Linux package is an AppImage. Use the extracted executable as the runner when FUSE is unavailable,
including in Docker; keep its extracted directory and license notices. The full-app recipe performs
this extraction while building the image and keeps `/opt/landstrip/bin/landstrip` as its runner path.

It needs Landlock and a seccomp profile that lets its calls through. landstrip 0.20.26 also creates
user, PID and mount namespaces, with a private procfs: Docker's unchanged default profile refuses it.
The [full-app recipe](docker.md) supplies dedicated seccomp and AppArmor profiles and documents the
system-path exception. Verify the actual runner on the host; do not disable confinement to make it start.

**In Docker, keep the runner.** The container protects the host, not what the server holds inside it:
the agent directory, the configuration, every mounted project. Also:

The [full-app Docker recipe](docker.md) includes Python, the integrated terminal and landstrip,
and checks both confined surfaces before serving.

**The network, host by host.** `sandbox.allowedHosts` holds the agent's shell to the hosts it names,
and asks you about the others ([below](#the-network-only-named-hosts)):

```json
{
  "sandbox": { "root": "/work/app", "allowWrite": true, "allowBash": true, "bashRunner": "/opt/landstrip/bin/landstrip", "allowedHosts": ["pypi.org", "files.pythonhosted.org"] }
}
```

Each command then runs with IP networking denied but for loopback TCP to the server's proxy, and
`HTTPS_PROXY`, `HTTP_PROXY` and `ALL_PROXY` pointing at it. landstrip opens that port by its number on
every loopback address: the proxy holds it on `127.0.0.1` and `[::1]`, so only a service of your machine
listening on another `127.x` address under the very same port number could be reached — keep none
there. The runner is known by its file name, `landstrip`: a runner under another name does not take host
questions. On Windows, landstrip refuses the key: use MXC.

- run the server as an ordinary user, not root (`--security-opt no-new-privileges` is compatible);
- mount only the projects and the agent directory — never the Docker socket, never `--privileged`;
- keep provider keys in the credential store (`pi-outpost login`, or Settings), not in the server's
  environment. landstrip 0.20.26 hides the server's processes in a separate PID namespace; a runner
  using filesystem confinement alone can leave same-account `/proc/<pid>/environ` readable.

## Linux, as an option: MXC

```json
{
  "sandbox": { "root": "/work/app", "allowWrite": true, "allowBash": true, "bashRunner": "mxc", "allowedHosts": ["registry.npmjs.org", "github.com"] },
  "terminal": { "enabled": true, "sandbox": "mxc" }
}
```

On Linux, `"mxc"` runs MXC's Bubblewrap backend through `lxc-exec`, the executor in the SDK's package
installed with pi-outpost; a path ending in `lxc-exec` is read as `"mxc"`. Unlike Windows and macOS, MXC
does not run in process here: Bubblewrap's own process is visible to the command and keeps the
environment it was started with, which in process would be the server's, keys included. `lxc-exec` is
started with the command's minimal environment instead. It runs each command, and
each terminal, in namespaces holding only the system trees, the root and the command's temporary
folder — no home, no other project, no agent directory. What it adds over landstrip:

- **The server's processes are out of sight**: the command sees its sandbox's processes alone, so the
  `/proc/<pid>/environ` read above finds nothing.
- **`sandbox.allowedHosts`**, as on Windows ([below](#the-network-only-named-hosts)): outbound and inbound
  traffic denied, the server's proxy the only way out. Without it, the network is open.

**The price is part of Docker's own hardening.** Bubblewrap needs user namespaces, which Docker's default
seccomp and AppArmor profiles refuse; it mounts a fresh `/proc` for the command, which the kernel refuses
while Docker masks parts of the container's own (`systempaths`); and any network rule needs a tun device
for slirp4netns:

```bash
docker run \
  --security-opt seccomp=deploy/docker/profiles/seccomp-mxc.json --security-opt apparmor=unconfined \
  --security-opt systempaths=unconfined \
  --cap-drop ALL \
  --init \
  --device /dev/net/tun \
  --security-opt no-new-privileges \
  …
```

`seccomp-mxc.json` is Docker's default profile with six more calls allowed, whatever their arguments:
`clone`, `unshare`, `setns`, `mount`, `umount2` and `pivot_root` — the namespaces Bubblewrap creates and
the mounts it makes inside them. Everything else Docker's profile refuses stays refused, for the server
as for its commands, and no capability is needed. `seccomp=unconfined` works too and gives all of that
up. landstrip's profile is narrower still (it fixes the flags of each call), and does not let MXC start.
The AppArmor side is not covered here: on a host with AppArmor, `unconfined` as above, or a profile
that permits `userns` and these mounts.

and the image needs `bubblewrap`, `slirp4netns`, `iptables` and `ip`
(`apt-get install bubblewrap slirp4netns iptables iproute2`). Under Docker's default profile the runner is
refused at its self-check — a confined `/bin/true` — with MXC's reason, and every command with it.
On an Ubuntu 24.04+ host, AppArmor also refuses unprivileged user namespaces to every process outside a
profile that allows them, inside a container or not: set `kernel.apparmor_restrict_unprivileged_userns=0`
on the host (a host-wide loosening), or give the container an AppArmor profile that permits `userns`.
MXC's refusal names this case. `--init` puts an init in front of pi-outpost: a terminal closed under MXC leaves its `bwrap`
processes to the container's first process, and Node does not reap them — without it, three zombies
pile up per closed terminal. Keep the rest of the advice above: an ordinary user, no Docker socket, no
`--privileged`. If loosening the container is not acceptable, landstrip is the runner.

`sandbox.bashImage` (WSLC) is Windows only. `scripts/mxc-linux/test.sh` runs this runner's tests in a
container both ways; CI's `mxc-linux` job runs it on every pull request.

## macOS on Apple silicon: MXC

`@microsoft/mxc-sdk`, installed with pi-outpost, runs MXC's Seatbelt backend in process — the sandbox
macOS applies to its own apps. Nothing has to be installed or loosened:

```json
{
  "sandbox": { "root": "/Users/me/app", "allowWrite": true, "allowBash": true, "bashRunner": "mxc", "allowedHosts": ["registry.npmjs.org", "github.com"] },
  "terminal": { "enabled": true, "sandbox": "mxc" }
}
```

A command reads the root, the system, the tools on its search path and the developer tools; writes the
writable zone and its private temporary directory; and cannot read the agent directory, the
configuration or anything beside the root. It cannot signal a process outside itself — the server
included — and gets the minimal environment. `sandbox.allowedHosts` holds the network to the hosts it
names, as on Windows ([below](#the-network-only-named-hosts)).

Both macOS runners allow certificate verification through the system's `TrustEvaluationAgent` service, so HTTPS
clients can validate certificate chains. This does not enable access to the user's Keychain.

`/usr/bin/git` is Apple's `xcrun` shim, which cannot find its cache folders in the sandbox and warns
on every call: the confined search path puts the developer tools' own `git` first (Xcode's or the
Command Line Tools', whichever `xcode-select -p` names).

**What was refused is told.** Every command of the agent's shell asks MXC for Seatbelt's report of what it
refused — a file beside the root, or one denied by name — and its output ends naming each directory, which
is also recorded for the project's [rules](#rules-always-allow-always-refuse). Enforcement is unchanged. This
uses a request contract MXC calls development (`1.1.0-alpha`); if a later SDK refuses it, commands run on
the stable contract, confined the same, and nothing is reported of files.

MXC's native library exists for Apple silicon only: on an Intel Mac `"mxc"` is refused at start, saying so —
[Seatbelt](#macos-every-mac-seatbelt) is the runner there.
`sandbox.bashImage` (WSLC) is Windows only. CI's `mxc-macos` job runs this runner's tests on a real
Mac (`scripts/mxc-macos/test.sh`, on any Apple-silicon Mac with `npm ci` done).

## macOS, every Mac: Seatbelt

`"seatbelt"` names macOS' own `/usr/bin/sandbox-exec`, on Intel and Apple silicon alike, with nothing
to install:

```json
{
  "sandbox": { "root": "/Users/me/app", "allowWrite": true, "allowBash": true, "bashRunner": "seatbelt", "allowedHosts": ["registry.npmjs.org"] },
  "terminal": { "enabled": true, "sandbox": "seatbelt" }
}
```

pi-outpost writes the Seatbelt profile itself, in the shape MXC's `mxc-exec-mac` generates and from the
same paths, so the limits are those of [MXC on macOS](#macos-on-apple-silicon-mxc): the root, the
system, the search path's tools and the developer tools readable; the writable zone and a private
temporary directory writable; the agent directory, the configuration and everything beside the root
out of reach; no signal outside the command; the minimal environment; git the developer tools' own.
The network is open, but not to the server or other services on the loopback; `sandbox.allowedHosts`
holds it to the hosts it names.

Apple marks `sandbox-exec` deprecated in its manual page; it ships and works on current macOS. Should
a release drop it, the runner's self-check fails and every command is refused with the reason — never
run unconfined. On Apple silicon either runner works; MXC's is maintained by Microsoft.
`scripts/mxc-macos/test.sh` runs both runners' tests (Seatbelt's alone on Intel).

## Windows 11: MXC and PowerShell

```json
{
  "sandbox": {
    "root": "C:\\work\\app",
    "allowWrite": true,
    "allowBash": true,
    "bashRunner": "mxc",
    "bashShell": "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
  },
  "terminal": { "enabled": true, "sandbox": "mxc" }
}
```

1. **Windows 11 24H2 or 25H2 with the August 2026 update or later** (build 26100/26200.9278+).
   MXC's probe must report `"tier": "base-container"`; pi-outpost refuses the lower tiers.
2. **MXC comes with pi-outpost**: the optional dependency `@microsoft/mxc-sdk`, installed by default
   (see [MXC comes with pi-outpost](configuration.md#mxc-comes-with-pi-outpost)). `"mxc"` runs it in
   process for this machine's architecture; a path to `wxc-exec.exe` is read as `"mxc"`. The confined
   terminal alone runs under `wxc-exec.exe`, signed by Microsoft, in the same package. The standalone
   executable finds MXC's native parts and `wxc-exec.exe` beside itself, where `pi-outpost build-exe`
   puts them. pi-outpost needs Node.js 24.21 or 26.8 for it on Windows.
3. **Run the server in your interactive session**, not as a service nor over SSH.

**Diagnostic data.** From `@microsoft/mxc-sdk` 1.1.0, on Windows builds routed for Microsoft telemetry,
MXC sends Microsoft four Required events per confined command (execution start and end, a categorized
error, a process exit), with random identifiers to correlate them. No setting of pi-outpost or MXC, consent
choice or administrative policy turns them off; a machine with no route to Microsoft sends nothing. MXC
collects nothing on Linux and macOS. See MXC's
[diagnostic data](https://github.com/microsoft/mxc/blob/main/docs/telemetry.md) and the
[Microsoft Privacy Statement](https://privacy.microsoft.com/privacystatement).

Nothing else is installed: Windows PowerShell 5.1 comes with Windows. `pwsh.exe` (PowerShell 7) works
too — a bare name is looked up on `PATH` when the configuration loads, and one not found stops the
server, saying so. With a PowerShell `bashShell` the agent is given pi's `powershell` tool instead of `bash`, so the
model writes PowerShell; every command runs from a script, without profile, with the execution policy
given for the process (the sandbox cannot read the registry's), progress bars off (drawing one is
refused inside) and output as plain text (PowerShell 7 colours tables and errors otherwise, and the model
reads the escape codes). Its exit status is the one it sets with `exit`, else the failed native program's code,
or 1 for a failed cmdlet. A native program that writes to a redirected stderr (`2>&1`) and exits 0 is not a
failure, though Windows PowerShell 5.1 shows each such line as an error.

**For a POSIX shell instead**, name busybox-w32: download `busybox64.exe` from frippery.org, save it as
`sh.exe` and give its path as `bashShell`; the agent keeps `bash`. busybox is `ash`, not bash: no `[[ ]]`,
arrays or `$'…'`. Git Bash cannot start in a Windows sandbox (microsoft/mxc#1061).

Inside: native git (`status`, `log`, `diff`, branches, commits with your identity), `node`, `npm`,
`cmd` and PowerShell. Your desktop is out of reach: a program the agent builds and runs there cannot
type or click in your session, move the cursor, see your windows or read the clipboard — pi-outpost asks
MXC for no clipboard and no input injection. Limits:

- The root's drive is readable, minus every folder beside the path down to the root (your `.ssh`,
  other projects…), denied by name at each launch — git needs it (microsoft/mxc#1464). Something created
  after the launch is not denied, and `Program Files` and `ProgramData` stay readable. Never make a
  drive's root the sandbox root: nothing would be left to deny.
- Every folder on the shell's `PATH` is readable, so a tool installed for you runs — Python in
  `AppDataLocalPrograms`, `uv`. A `PATH` entry that is or holds your home directory, or holds the
  agent directory or the configuration, is left out. Where a `PATH` folder only holds launchers, the
  installation they start is readable too, read only: Git for Windows installed for you (`Git\cmd`
  starts `Git\mingw64\bin\git.exe`), scoop's shims (the program each `.shim` names), WinGet's
  `Links` and a folder that is itself a link (nvm-windows) — each followed one step, to a program that
  is there. The project's `.venv` too: its `python.exe` loads the interpreter `pyvenv.cfg` names in
  `home` (under `%APPDATA%\uv\…` for a Python uv installed), readable when that folder holds
  `python.exe` and `Lib` — the agent writes `pyvenv.cfg`, so it cannot name any other folder that way.
  The same guard applies to each: never your home directory or above it, the agent directory or the
  configuration. Anything else a tool needs — the Pythons uv keeps when no `.venv` names one, a
  program elsewhere — goes in [`sandbox.readOnlyPaths`](#tools-installed-for-you-sandboxreadonlypaths). The Python launcher `py.exe` still finds no
  interpreter (it reads the registry); `python` runs. scoop's `shims` are followed wherever they are,
  a global install's (`C:\tools\scoop\shims`) too.
- The folders above such a tool, when it is beside the root (`C:\dev` for `C:\dev\nodejs` while the
  project is `C:\projects\app`), can be listed but not read: a path through them resolves, so Node runs
  a global npm CLI. Everything else in them stays denied by name, as beside the root — another project
  in `C:\dev` is out of reach. A folder the root's drive already makes readable is left as it is.
  On another drive than the root's, the way down to a tool is readable; what lies beside it stays
  denied by name, as on the root's drive — the temporary directory included.
  That holds whatever enumeration level the host's MXC proved: when it refuses listable folders
  altogether, the way down on the other drive is still what is readable, and what lies beside it —
  the temporary directory included — is still denied by name, not opened with the drive.
  When the host's security environment cannot open a denied path at all (0x80070005, seen on
  domain-joined accounts), the deny list is pruned to what it can open — an openable folder such as
  the temporary directory stays denied — so the shell still starts, confined.
  A tool reached through a link on the way down (scoop's `current` junction to the active version) has
  the link's target readable like the link, so `node` resolves on `PATH` through it; the link itself is
  never made listable. This needs a Windows whose MXC can list a folder without reading it; MXC says so
  in its probe.
- A folder readable but not writable can be neither listed nor entered: leave the whole root writable
  (no narrower `writableRoot`) where git runs.
- `git push` has no credentials. Commits are signed through the server when your `~/.gitconfig`
  asks for them (`commit.gpgsign`/`tag.gpgsign`): GnuPG for Windows is built without ASLR, which the
  sandbox enforces, so it cannot run inside, and the private keys stay out of it anyway — instead the
  shell's `gpg.program` points at a shim that POSTs the payload to pi-outpost's signing relay on this
  machine, and the server signs with your key, unconfined. Only payloads go in and only signatures come
  back; `~/.gnupg` is refused to commands. Sign only: verification (`git log --show-signature`) is
  refused in the sandbox — verify from the app or outside it. This needs gpg (or the `gpg.program` your
  gitconfig names) on this machine, OpenPGP (`gpg.format=ssh` is not relayed), and the loopback open.
  Where any of those is missing, the shell's environment turns `commit.gpgsign`/`tag.gpgsign` off (env
  entries win over the file) instead of failing every commit, and the startup line says so — re-sign
  outside the sandbox (`git commit --amend --no-edit -S`, or from the app, which runs git unconfined).
- The confined terminal's PowerShell starts with `-ExecutionPolicy RemoteSigned` and progress bars off;
  give both yourself to a shell you name in `terminal.shell`.

Details and probes: [`investigations/windows-sandboxing.md`](investigations/windows-sandboxing.md).

### The loopback and Python

Windows does not let a process in MXC's container connect even to a port it listens on itself, unless
the container may reach the host's loopback. CPython on Windows builds `socket.socketpair()` — and with it
every asyncio event loop — from exactly such a connection, so without it any Python using asyncio
(pytest-asyncio, uvicorn, lancedb as it is imported, MCP servers) hangs forever, silently. It is a Windows
bug Microsoft has acknowledged ([microsoft/mxc#1261](https://github.com/microsoft/mxc/issues/1261)); no
MXC setting opens a process's own loopback without the host's.

So by default, without `sandbox.allowedHosts`, the agent's shell and the confined terminal run with the
host's loopback open, and asyncio works. What that opens: **services listening on this machine's
loopback are reachable from a command** — a database, a development server, another tool's local API.
pi-outpost itself is not: it requires its token on every connection, and the token lives in the agent
directory, which no command can read. Inbound connections from the network stay denied.

To close the loopback again, at the price of asyncio:

```json
{ "sandbox": { "hostLoopback": false } }
```

Under `sandbox.allowedHosts` the loopback reaches the proxy alone and asyncio hangs: MXC accepts no other
loopback rule beside its proxy ([microsoft/mxc#1731](https://github.com/microsoft/mxc/issues/1731)). The
server's startup line says which way it is (`loopback open: …` or `loopback closed: Python's asyncio
cannot start in the shell`).

### The private network

Windows refuses a process in MXC's container the private network — the subnets this machine is on,
and intranet ranges a policy names: a company's package mirror, git server or proxy — unless inbound
connections from it are allowed too. Outbound alone cannot be asked for: MXC documents the capability as
bidirectional by design ([microsoft/mxc#830](https://github.com/microsoft/mxc/issues/830)). So it stays
closed unless you open it, which only you can do:

```json
{ "sandbox": { "privateNetwork": true } }
```

Then, without `sandbox.allowedHosts`, the agent's shell and the confined terminal reach the intranet, and
a server a command starts can be reached from it, through Windows' firewall like any program. The
startup line says so (`private network open: …`).

Closed, a connection there fails, and each program says it its own way — uv `os error 10013`, Python
`WinError 10013`, Node `connect EACCES`, Java `Permission denied: connect`, curl and git only `Couldn't
connect to server`. MXC reports no refused connection itself (its denial report holds files, registry keys
and capabilities, never the network). So pi-outpost judges it from its own policy: when a command fails, the
hosts its command line names — and those its output names in a URL or a connection error — are resolved,
and one that falls on this machine's private network (its subnets, as Windows counts them) while that is
closed, or on the machine itself while its loopback is closed, is named in a note at the end of the output,
so the agent does not take it for a network failure and retry:

```
[pi-outpost] the sandbox refused nexus.corp.example (10.0.0.20): it is on this machine's private network (the intranet), which is closed unless the user sets sandbox.privateNetwork to true. It is not a network failure, and retrying will not help. Only the user can open it: if the task needs it, tell them.
```

Where no host can be told but the output shows a refused connection (Windows' own sentence for
WSAEACCES, in your language), the note says so without a host — and it does not claim the Internet is
open: without `sandbox.allowedHosts` the sandbox does not restrict outbound connections, so whether
the Internet answers at all is the machine's network, not the sandbox's, and on an air-gapped machine
the same WSAEACCES comes from the machine's own firewall. The note names the only addresses the
sandbox closes (the private network, the machine's own services) and says retrying will not help.
A refused connection never offers a file diagnosis.

Under `sandbox.allowedHosts` the key changes nothing: the proxy is the only way out, and it reaches an
intranet host you list by name. A command cannot reach the private network around it, even with
`privateNetwork: true` (measured, and tested). The key and `hostLoopback` are independent. A program there that connects
directly, ignoring `HTTPS_PROXY`, fails with "network unreachable" (WSAENETUNREACH, 10051); the same note
follows, saying so.

### Behind a company proxy

A confined command, and the confined terminal, get your `HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY` and
`NO_PROXY` (either case) when no `sandbox.allowedHosts` proxy is their way out: behind a company's proxy
nothing else gets out, and every download would time out. A variable whose proxy names a user or password
(`http://user:password@proxy:8080`) is a credential and is not passed; the startup line names it. A proxy
set only by a PAC file or WinHTTP, not by these variables, is not read. Under `sandbox.allowedHosts` none
is passed — `NO_PROXY` would route around the server's proxy — and the server's proxy connects directly.

### Toolchains and the sandbox cache

Measured on Windows 11 24H2 with nothing configured, the agent's confined shell and the confined terminal
run node, npm and npx, pip and `python -m venv`, uv, gcc and CMake (Strawberry), `rustc` and `cargo`,
`javac`, Maven, Gradle's wrapper, Go, `dotnet`, a native Perl, and `bun run` / `bun test`. What makes that
work, and what it costs:

- **A temporary directory that exists.** Each command's `TEMP`, `TMP` and `LOCALAPPDATA` are inside its
  private temporary directory, deleted afterwards.
- **The installation behind each `PATH` folder is readable**, read only: a folder named `bin`, `cmd`,
  `Scripts` or `sbin` opens the one above it (`C:\Strawberry\c`, Maven's, the JDK's), so a tool finds the
  rest of itself. Never a drive's root, your home directory or a folder directly in it (`~\.cargo` holds
  `credentials.toml`), nor anything holding the agent directory or the configuration.
- **A sandbox cache**, `%LOCALAPPDATA%\pi-outpost\sandbox-cache` (`sandbox.cacheDir` moves it): Cargo's
  home, Gradle's user home, Go's module and build caches, Maven's repository, NuGet's packages, bun's, npm's,
  uv's and pip's caches and `APPDATA` are folders of it, so a dependency is downloaded once per user, not
  once per command. Confined commands write there and nothing unconfined reads it: your own caches stay
  yours, and a package a command left never runs outside the sandbox. It grows with what the agent
  builds — Gradle's distribution, Rust and Maven dependencies; delete it to reset it. Commands of every
  project share it, all of them confined.
- **Toolchain homes are read where they are**: rustup's (`RUSTUP_HOME`, by default `~\.rustup`), so
  `cargo` and `rustc` find your toolchain, and the Pythons uv installed (`%APPDATA%\uv\python`).
- **Your mirrors are carried in, your credentials are not.** Before each command, a copy of your own
  configuration is put where the confined tool reads it, with every credential taken out:

  | Tool | Yours | Taken out |
  | --- | --- | --- |
  | uv | `%APPDATA%\uv\uv.toml` — or, with no file, `UV_DEFAULT_INDEX` and `UV_PYTHON_INSTALL_MIRROR` from your environment, synthesized into the carried `uv.toml` | a `user:password@` in a URL |
  | pip | `%APPDATA%\pip\pip.ini` (named by `PIP_CONFIG_FILE`) | the same |
  | npm | `~\.npmrc` (named by `npm_config_userconfig`) | `_authToken`, `_auth`, `_password`, `password`, `username` |
  | Maven | `~\.m2\settings.xml` (named by `MAVEN_ARGS`) | `<servers>`, every `<username>`, `<password>`, `<passphrase>`, `<privateKey>` |
  | Gradle | `~\.gradle\gradle.properties` | every property whose name says password, secret, token, credential, API key or auth |
  | Cargo | `~\.cargo\config.toml` | `token`; `credentials.toml` is never read |
  | Go | `%APPDATA%\go\env` (`go env -w`) | `GOAUTH` |
  | NuGet | `%APPDATA%\NuGet\NuGet.Config` | `<packageSourceCredentials>`, an account's key |

  So a company's mirror is used as on your machine. An edit of yours applies from the next command, and
  the copy of a file you remove goes too. Each copy starts with a line naming yours: edit that one. A
  project's own configuration (`.npmrc`, `gradle.properties`, `.cargo\config.toml` in the root) still
  applies on top.

  **A registry that needs your credentials goes through the server's relay.** A command can read
  whatever its tools read, so a token given to the sandbox is a token the agent could print or send
  anywhere. Instead, the copy names a relay the server runs —
  `http://127.0.0.1:<port>/<key>/<registry>/…` — and the server, unconfined, forwards each request to
  your registry with your credentials added. The agent uses your mirror; it never sees the secret.

  - Read only: `GET` and `HEAD`. Installing works; publishing (`npm publish`, `mvn deploy`) is refused
    with `405`, so nothing is published in your name. Run those outside the sandbox.
  - Only the registries your files name, under a key drawn when the server starts. What a registry
    answers comes back with its links pointing at the relay (an index's files, npm's tarballs, NuGet's
    service index) and without its cookies.
  - Behind a company proxy, the relay uses your `HTTPS_PROXY`; it trusts the certificate authorities
    Windows trusts, so a mirror signed by your company's authority works.
  - Paired with a URL in your file, so relayed: a `user:password@` in uv's, pip's and Go's; npm's
    `_authToken`, `_auth` and `username` / `_password` for the `registry` lines they cover; Maven's
    `<server>` for the `<mirror>` and `<repository>` of its id; NuGet's `ClearTextPassword` for its
    source. Not relayed, only left out: Gradle's properties and Cargo's tokens (build scripts and Cargo
    use them themselves), a Maven password encrypted with your master password, NuGet's encrypted
    `Password`.
  - Under `sandbox.allowedHosts`, the relay is reached through the command's proxy, as the host
    `registry-relay.pi-outpost.invalid`, without a question. With `sandbox.hostLoopback: false` and no
    list, a command cannot reach it: the credentials are left out, unrelayed.

  The startup line lists what is carried (`your uv.toml, .npmrc (credentials kept in the server, its
  registries relayed) carried in`).
- **MSYS2 programs cannot start** — Git's `usr\bin` (its `bash`, `perl`, coreutils), an MSYS2 install:
  their runtime needs named objects a container may not create (microsoft/mxc#1061). Their folders are
  left out of the confined `PATH`, so `perl` finds a native Perl, and the startup line names them. A
  command naming one by its path ends with a note saying so.
- **bun**: 1.4.5 or later for `bun run` and `bun test` (1.3 gave up on folders above the project). `bun
  install` and `bun add` cannot complete inside the container — it refuses the rename bun uses to probe
  its cache — and the command ends with a note; run them outside the sandbox.
- **`uvicorn --reload`** fails at start: its reloader's child cannot open the named pipe its parent hands
  the socket through (`FileNotFoundError: [WinError 2]`). `uvicorn` without `--reload`, and
  `multiprocessing` itself, work.
- **What a shell writes for itself stays out of your project**: PowerShell's module cache goes to the
  command's temporary directory (inside the container Windows names no folder for local application
  data, and PowerShell fell back on the working directory), and Python writes its output in UTF-8, so a
  message Windows words in your language reaches the agent undamaged.

A tool pi-outpost does not set up itself keeps its downloads in the sandbox cache with
`sandbox.toolEnvironment`, `${cache}` standing for the cache's folder; `sandbox.readOnlyPaths` lets it read
an installation or home that no `PATH` folder leads to:

```json
{
  "sandbox": {
    "toolEnvironment": { "COMPOSER_HOME": "${cache}/composer", "SBT_OPTS": "-Dsbt.global.base=${cache}/sbt" },
    "readOnlyPaths": ["C:\\tools\\php"]
  }
}
```

A variable grants nothing — the sandbox still decides what a command reads and writes — and the
sandbox's own (`PATH`, `TEMP`, `USERPROFILE`, …) are refused.

### Microsoft's telemetry

MXC has two kinds of telemetry, and pi-outpost can switch off only one:

- **Optional telemetry** needs a request to opt in, MXC's stored consent and a policy that allows
  it. pi-outpost never opts in (`telemetry: { enabled: false }` on every call) and never asks for
  consent: it is off. An administrator can also block it machine-wide with the `REG_DWORD`
  `AllowTelemetry` under `HKLMSOFTWAREPoliciesMxc` (only `3` permits it).
- **Four Required events** — `ExecutionStart`, `ExecutionEnd`, `Error`, `ProcessExited` — are
  emitted on eligible Windows builds whatever is asked. They carry random identifiers, the backend,
  the outcome, the exit code and the duration; no command, no path, no free text. MXC's
  documentation states that no setting, registry key or administrative policy of MXC's turns them
  off: they are written to Windows' event tracing (provider `Microsoft.MXC`) and routed by a
  component signed into MXC's build. This holds for every use of MXC, executor or SDK alike. On
  Linux and macOS MXC has no telemetry.

Sources: MXC's [telemetry](https://github.com/microsoft/mxc/blob/v1.1.0/docs/telemetry.md) page.

### The network: only named hosts

Confined, a command cannot read beside the root — but it can send what it reads inside it anywhere.
`sandbox.allowedHosts` closes that: the agent's shell may then reach only the hosts it names.

```json
{
  "sandbox": {
    "root": "C:\\work\\app",
    "allowWrite": true,
    "allowBash": true,
    "bashRunner": "mxc",
    "bashShell": "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    "allowedHosts": ["registry.npmjs.org", "*.pki.goog", "github.com", "*.githubusercontent.com"]
  }
}
```

Each command runs with outbound traffic denied, and a proxy the server runs on its loopback as the only
way out. MXC hands the command `HTTPS_PROXY` and `HTTP_PROXY`; curl, git and npm follow them, and
PowerShell's `Invoke-WebRequest` and `Invoke-RestMethod` are pointed at the proxy too. The proxy relays a
listed host on any port and refuses any other; a direct connection — or a program that ignores
`HTTPS_PROXY` — is refused by the sandbox, as is any other service listening on your machine's loopback.
With grants on (the default), a connection to an unlisted host is not refused outright: it waits while
you are asked ([grants](#grants-beyond-the-sandbox-when-you-say-so)), and the command's output ends
with your answer. With `sandbox.grants: "never"`, the server logs each refusal
(`[sandbox] network: refused …`), and the command's output ends with a note naming the hosts refused
while it ran, so the agent can tell you what to add:

```
curl: (56) CONNECT tunnel failed, response 403

[pi-outpost] network refused: example.com — not in sandbox.allowedHosts. Ask the user to add it there if the command needs it.
```

- A name matches that host only; `*.githubusercontent.com` matches the names under it, not
  `githubusercontent.com` itself. An empty list names no host: with grants on, every host is asked
  about; with `sandbox.grants: "never"`, the network is closed entirely.
- Plain `http://` is relayed like HTTPS, to the listed hosts only.
- On Windows, list your hosts' certificate authorities too. `curl.exe` checks a certificate's
  revocation by fetching the authority's list over plain HTTP, and fails when it cannot: for
  registry.npmjs.org that is `*.pki.goog`. The note after the output names the host it was refused.
- The agent's shell only, under MXC — Windows' process container, or [Linux's](#linux-as-an-option-mxc)
  Bubblewrap —, [Seatbelt](#macos-every-mac-seatbelt), or [landstrip on Linux](#linux-landstrip): the key
  is refused without one of them as `bashRunner`, and with `bashImage` (WSLC). The terminal panel is
  your own shell and keeps the network.
- A program that ignores `HTTPS_PROXY`, or resolves names and connects itself (UDP, raw sockets), is
  refused: it has no way out but the proxy.
- Without the key, the network is open, as before. A Settings apply keeps the list.

### A real bash: WSLC (experimental)

```json
{
  "sandbox": {
    "root": "C:\\work\\app",
    "allowWrite": true,
    "allowBash": true,
    "bashRunner": "mxc",
    "bashImage": "buildpack-deps:bookworm-scm"
  }
}
```

With `sandbox.bashImage`, each command of the agent's `bash` runs in a Linux container of that image,
through MXC's WSLC backend (WSL containers): a real bash with the image's tools — git, curl and ssh in
`buildpack-deps:bookworm-scm`. The agent keeps its `bash` tool. It needs WSL with container support
(`wsl --version` 3.0.5 or later; `wsl --update` brings it). The image is downloaded on the first command (about 20 s), then each
command takes about 4 s. `bashShell` must be absent, and `bashRunner` must be MXC.

WSLC is WSL's own: neither Docker nor a WSL distribution (Ubuntu or any other) is needed, nor used
when installed — both stay stopped. A standard account, outside Administrators, runs it too. The image
is pulled from its registry — Docker Hub for `buildpack-deps` — so a corporate proxy or firewall must
let that through; it is kept per Windows account under `%TEMP%\mxc-wslc-sessions` (about 500 MB for
`buildpack-deps:bookworm-scm`), and pulled again only if that folder is emptied.

Inside, only two folders of the host exist: the root, mounted at its Windows path under `/mnt/<drive>/`
(`C:\work\app` is `/mnt/c/work/app`), read-only or writable with `allowWrite`; and the command's
temporary folder. No profile, no key, no configuration, no other project: there is nothing to deny. The
environment is the container's own. Limits, all the backend's:

- **The writable zone is the whole root or nothing.** A writable folder inside a read-only mount stays
  read-only, so a `writableRoot` narrower than the root refuses every command.
- **The network is open, the host's `localhost` included.** WSLC opens or closes it all at once:
  services listening on the host's loopback are reachable from a command.
- The model sees Windows paths in its file tools and `/mnt/c/…` in `bash`; relative paths work in both.
- Commands run one at a time: two at once fail on WSLC's image store.
- Creating a container occasionally fails on a folder's first mount (`WslcCreateContainer`,
  `0x80004005`); running the command again works.
- The terminal panel is not confined this way: `terminal.sandbox` keeps MXC's Windows container.

### Not yet

What the Windows sandbox does not do yet, and what to do meanwhile. The work behind each, and where it
would start, is the "Remaining work" of the `windows-sandbox-reach` change's `design.md` (under
`openspec/changes/`, or its archive once merged).

| Not yet | Meanwhile |
| --- | --- |
| A tool installed in a layout pi-outpost does not know (beyond Git, scoop, WinGet, nvm, a `.venv`) is not readable | list its folder in [`sandbox.readOnlyPaths`](#tools-installed-for-you-sandboxreadonlypaths), or grant it when asked |
| Yarn Berry's, bun's, Poetry's, conda's, RubyGems' and Composer's configuration is not carried in | set the mirror in the project's own configuration, or run that install outside the sandbox |
| A registry authenticated by Gradle's properties, Cargo's token, or an encrypted Maven or NuGet password answers 401: those credentials are left out, not relayed | run that build's dependency download outside the sandbox once; the sandbox cache keeps what it downloaded |
| Under `sandbox.allowedHosts`, a network reached only through a company proxy is not reached: the server's proxy connects directly | leave `allowedHosts` unset there, so commands use your `HTTPS_PROXY` |
| A proxy configured by PAC or WinHTTP alone is not seen | set `HTTPS_PROXY` (and `NO_PROXY`) for the server |
| A connection refused to a host the command never names (a library's, deep in a build) is told only when the program's own error says so — MXC does not report refused connections ([microsoft/mxc#1843](https://github.com/microsoft/mxc/issues/1843)) | if a build fails on the network, check the intranet hosts it uses against `sandbox.privateNetwork` |
| Two pi-outpost servers of the same Windows user share the sandbox cache, and with it the carried configuration: one's commands may meet the other's relay and get a 404 | run one server per user, or give each its own `sandbox.cacheDir` |
| On a machine where Windows refuses the policy over the folders made listable (a domain-joined account, `CreateProcessSecurityEnvironment` `0x80070005`), pi-outpost steps the enumeration down per command: first without the ancestors of the grants (the profile's folders), then without any listable folder. At the last level the folders above a tool beside the root are not listable and `realpath` of the tool's folder fails | nothing to do: the command runs, confined the same at every level; a tool beside the root that needs its folder resolved by path takes a grant (`run_with_grant` or `sandbox.readOnlyPaths` on its ancestor folders) |

## Older Windows

Without MXC's tier 1, no runner confines natively: landstrip's AppContainer cannot run git
(landstrip/landstrip#204), and MXC's lower tiers hit the same wall. The interface says so once, in a
dialog naming your build, what it lacks, and the ways out below; the shell's refusal and the console say
the same.

- **Update Windows**, then the setup above. This is the supported path. MXC's process container needs
  one of these builds or later (`winver` shows yours). Windows 11 23H2 and earlier must first move to
  24H2 or later — no cumulative update brings it to 23H2:

  | Windows 11 | Build | Update |
  | --- | --- | --- |
  | 24H2 | 26100.9278 | August 2026 (KB5120998) |
  | 25H2 | 26200.9278 | August 2026 (KB5120998) |
  | 26H2 | 26300.9550 | September 2026 (KB5124010) |
  | 26H1 | 28000.2804 | August 2026 (KB5120996) |
- **If you cannot update Windows, run commands unconfined.** On that machine, run

  ```sh
  pi-outpost config --unconfine
  ```

  then restart pi-outpost. It sets `"sandbox.bashRunner": "none"` in the configuration file (with the
  same `--config` or `--profile` you start pi-outpost with) and changes nothing else: the agent's file
  tools stay limited to the project, but **its commands run with every right of your account** — they
  can read, change and delete any file you can, outside the project too, and reach any host. Once
  Windows is updated, `pi-outpost config --confine` checks MXC and confines the shell again.
- **Run pi-outpost inside WSL** with the [Linux setup](#linux-landstrip). WSL mounts every drive
  read-write and can start any Windows program, unconfined, so this holds only after closing those doors
  (`[interop] enabled = false`, `appendWindowsPath = false`, `[automount] enabled = false` in
  `/etc/wsl.conf`, the project alone mounted from `/etc/fstab`, `"files": { "watch": false }`), in a
  distribution of its own. It is fiddly to get right and easy to undo; prefer the update.

## Grants: beyond the sandbox, when you say so

A confined command sometimes needs one thing the policy refuses: a host `sandbox.allowedHosts` does not
list, a directory beside the root. Rather than widening the configuration for every later command, you
are asked — and you answer in the interface, for that command only, for the rest of the session, or not
at all. No answer within five minutes, an aborted turn, or no browser connected to the project refuses.
A grant never takes a command out of the sandbox: it widens it, and nothing more. Nothing is written to
the configuration or to the project's settings. To keep an answer for good, make it a
[rule](#rules-always-allow-always-refuse) for the project, or add the host to `sandbox.allowedHosts`.

**A host is asked about when a command connects to it.** Each command gets a proxy of its own, and a
connection to a host the list does not name waits there while you are asked, with the running command
in front of you:

- **Allow for this command**: the connection goes through, and so does every later one of that command.
- **Allow for this session**: the same, and every later command of the session reaches that host too,
  until the session ends or is replaced, a sandbox settings change is applied, or the server restarts.
- **Refuse**: the connection is refused, saying so.
- **Always allow** / **Always refuse**: the same answer, kept as a [rule](#rules-always-allow-always-refuse)
  for the project: later commands are not asked about that host, in this session or the next.

The agent does not ask for hosts and cannot: a request exists only once a command has really connected.
The command's output ends with what you answered, which the agent reads and the transcript keeps:

```
[pi-outpost] network: the user allowed example.com for this command.
```

Permission requests appear below the conversation, leaving its evidence readable and scrollable.
Long commands, target lists and explanations scroll within a panel limited to 40% of the screen's
height. The refusal and approval buttons stay visible while you inspect the details. Reading the
conversation or resizing the window does not answer the request; nothing is approved by default.

**A directory is asked for by the agent**, with the command that needs it — a file access cannot wait
the way a connection does. Its `run_with_grant` tool names the command, the directories (read, or
read-write) and why; nothing runs until you answer, and allowed once, it is that exact command alone:
the next one is confined as before, even the same one run again. A read-write grant applies even with
`allowWrite: false`, and the dialog says so. The result starts with the grant it ran with:

```
Ran with the user's grant for this command: read-write C:\work\beside.
```

Some targets are refused before you are asked, whatever you would answer: the agent directory (the
provider keys) and the configuration file, or a directory holding either; a `.pi` directory or anything
inside one; a drive's root and your home directory itself; and, as hosts, IP addresses and `localhost`
and the names under it. A program installed outside the sandbox runs once its folder is granted —
"access denied" starting one is a refused path like any other, and the agent asks for that folder, read
only. What no grant lets a command do is leave the sandbox — start your browser, a
desktop application (`Start-Process` on a URL, `start`, `open`): it is not a connection, so nobody is
asked, and it stays refused.

| Runner | Directories | Hosts |
| --- | --- | --- |
| MXC on Windows 11, Linux and Apple-silicon macOS, Seatbelt, landstrip on Linux | asked for by the agent | asked about on connection, under `sandbox.allowedHosts` |
| landstrip on Windows | asked for by the agent | — (the network is open) |
| WSLC (`sandbox.bashImage`) | refused: the container's mounts are fixed when it starts | — |

A runner takes host questions once a command under it is shown to reach its own proxy and no other
command's — the condition for a grant to stay with the command it was given to. That is tested for each
runner above in CI; a runner without that proof never asks. Without someone to ask — `sandbox.grants:
"never"`, or such a runner — a host the list does not name is refused at once, and the note asks you to
add it to the list.

**An internal page is asked about by its name.** `wiki.corp.example` gets a question; `http://10.1.2.3/`
does not, because a grant never names an IP address. Point the agent at the page's host name. The agent's
shell only: the terminal panel is yours, and the file tools (`edit`, `write`) keep their zones.

Every request leaves a line in the server's log — approved once or for the session, refused, expired,
aborted, refused with no one to ask, or forbidden:

```
[sandbox] grant approved once: host example.com for "curl -sI https://example.com/" — The running command is connecting to example.com, which sandbox.allowedHosts does not list.
```

While the session holds grants, the shell's lock says how many (`🔒 shell confined · 1 grant`) and its
description lists them; the canary's verdict is the base policy's, unchanged. To keep the old behaviour,
nobody asked and no grant tool:

```json
{ "sandbox": { "grants": "never" } }
```

`"never"` also switches [rules](#rules-always-allow-always-refuse) off: none is made, and none in the store applies.

### What the sandbox refused

When the sandbox refuses a command something, the command's output ends by saying what, so the agent
can ask for exactly that rather than guess from the program's own "Permission denied":

```
[pi-outpost] the sandbox refused reading /home/me/work/notes.
[pi-outpost] If the task needs one of these, ask run_with_grant for exactly it; judge the command by its exit status and output.
```

Each refusal is also recorded for the project — the directory or host, the access, the last command
that met it — and listed under the shell's lock (click it). What each runner can tell:

| Runner | Refused files | Refused hosts |
| --- | --- | --- |
| landstrip on Linux | as they happen | yes |
| MXC on Windows 11 | on a diagnosis the agent asks for (below) | yes |
| MXC on Linux and macOS, Seatbelt, landstrip on Windows | not reported: the panel says so | yes, where hosts are asked about |

**MXC on Windows reports refusals only on demand.** Its report costs about a second per command, and it
leaves out every path the policy names to deny — which is how the folders beside the root are refused.
So a command runs without it; when one fails, its output ends offering a diagnosis, and the agent may
run the same command again with `diagnose: true`. That second run is narrower than the first, never
wider: no drive root, the folders beside the root left to the default deny, the agent directory and the
configuration still denied, no network, no grant, no rule. Its output is not shown — only the
directories the sandbox refused it, and the agent asks for those. A diagnosis is run only for a command
that has just failed that way: `diagnose` on a command that has not is ignored, and the command runs as
usual — output shown, network and host questions included — ending with a note saying so. The command runs twice, effects
included; the agent is told never to diagnose a command that must not run twice. The first diagnosis
also measures what the shell itself is refused starting up (PowerShell reads the default profile), and
leaves that out of every report.

### Tools installed for you: `sandbox.readOnlyPaths`

A rule is the project's. A tool installed for your account is the machine's: list its directories
once, and every command of the agent's confined shell can read them, in every project.

```json
{ "sandbox": { "readOnlyPaths": ["C:\\Users\\me\\AppData\\Roaming\\uv\\data\\python"] } }
```

Read only, always. A relative path is the configuration file's folder's. Each is checked at every
launch as a grant is: the agent directory, the configuration, a `.pi` directory, a drive's root and
your home directory itself are never given — such an entry, or one that no longer exists, is skipped
and said once in the server's log. Settings do not edit it and keep it. A diagnosis keeps these
directories too, so it names only what the configuration does not give. Not with `sandbox.bashImage`:
a WSLC container's mounts are fixed when it starts. The agent's shell only: the terminal panel takes
the installations behind its `PATH`, not this list.

Name the folder a tool needs, not the one holding everything: a tool's directory often holds its
credentials too — `.cargo\credentials.toml`, `.m2\settings.xml`, `gradle.properties`, `NuGet.Config`.
uv's `data\python` holds interpreters only; uv's `data` beside it holds its tools' environments too.
A directory is not enough for a tool that finds its home through `USERPROFILE`, which points to the
command's temporary directory (rustup's `.rustup`, cargo's `.cargo`): those stay out of reach.

### Rules: always allow, always refuse

A rule keeps your answer for the project: across sessions and server restarts, without a question.
You make one from a grant dialog (**Always allow**, **Always refuse**), or from a refusal listed under
the shell's lock. It names a resource, never a command: a directory with its access (read, or read
and write), or a host.

- **Always allow**: the directory is given to every command of the project's confined shell when it
  starts; a connection to the host goes through. A rule on a directory deleted since is skipped.
- **Always refuse**: a request for the directory, or a connection to the host, is refused at once,
  and the agent is told it was your rule and not to ask again.

What can never be granted takes no always-allow rule (the panel says why), and only you make rules:
the agent's tools have no way to. The rules are listed under the shell's lock, each revoked in one
click; a revoked rule stops applying from the next command.

They are kept by the server under the agent directory
(`<agentDir>/pi-outpost/sandbox-rules/`, a file per project named by a hash of its root), beside the
sessions — never in the project or the configuration file. A confined command can neither read nor
write them: the agent directory is denied to every runner.

## Check that it is really confined

pi-outpost checks it itself, and shows the answer. Once a runner has passed its self-check — and again
whenever the sandbox settings change — the server runs a **canary** through that runner, with the very
policy a command of the agent's shell (and, separately, of the terminal) gets. The canary tries what
confinement must refuse:

| Attempt | Judged by |
| --- | --- |
| read a marker file the server puts in the agent directory | the command |
| read a marker file in a private folder outside the root | the command |
| write a file into that folder | the host: did the file appear? |
| signal a throwaway process of the server's user | the host: is it still alive? |
| find the server's environment in its own | the command |
| read the server's process environment (`/proc/<server>/environ`, Linux) | the command, then the server: what does that environment hold? |
| under `sandbox.allowedHosts`: reach an unlisted host through the proxy, and connect around it | the command |

The bait is removed afterwards. An attempt that cannot mean anything — the system's temporary folder
inside the sandbox root, no `curl` in the shell — is reported "not checked", never as a leak.

The verdict is shown next to the context indicator for the agent's shell, and as the terminal's badge:

| | |
| --- | --- |
| 🔒 `shell confined` / `confined to <root>` | every attempt was refused; the tooltip lists them, with the runner and the time |
| 🔐 `partly confined`, amber | only the server's process environment was readable, and it holds secret-looking variables (keys, tokens, secrets, passwords): the tooltip names them, never their values |
| 🔓 `not confined`, in red | anything else got through; the tooltip names which. The configuration is left as it is: fix the runner or its host, or stop relying on it |
| `checking confinement` | the canary is running |
| ⚠ `confinement unchecked` | the canary could not answer; the tooltip says why |
| ⛔ `shell unavailable` | a runner `"auto"` chose did not pass, or there is none: every command is refused. The first time, a dialog says why and what to do; clicking the lock opens it again |
| ⛔ `shell unavailable — Windows update needed` | the same, because Windows lacks the update MXC needs: the dialog names it |
| 🔓 `shell not confined`, highlighted | no runner, yet this machine's passes its self-check: the tooltip says to run `pi-outpost config --confine` |
| 🔓 `shell not confined`, grey | no runner, and none can confine here: the tooltip says why |
| nothing | no shell (`allowBash` off), or the shell is an extension's |

`pi-outpost doctor` runs the same canary for each confined surface (`shell sandbox`, `terminal sandbox`)
and exits non-zero when one leaks — the check for a headless server. It warns about an `"auto"` shell
that is unavailable, and about an unconfined one this machine could confine.

On Linux, landstrip leaves the server's `/proc/<pid>/environ` readable (see
[Linux: landstrip](#linux-landstrip)). The canary sees it, and the server judges it by what its start
environment holds: nothing secret-looking, and the lock stays closed (its tooltip says the environment
is readable); provider keys, `PI_OUTPOST_TOKEN` or any other key, token, secret or password, and the
lock turns amber, naming them. Keep provider keys in the agent directory rather than in the server's
environment; MXC's Linux runner hides the server's processes entirely.

### Seeing the sandbox's own state: `pi-outpost sandbox doctor`

When a command misbehaves, the first question is whether it is a policy decision or an environment
problem. `pi-outpost sandbox doctor` (run on the host, in the project) prints one snapshot of the
sandbox's state: the active backend and, under MXC on Windows, the enumeration level the host proved;
the canary verdict of the agent's shell — a leak is named there in words ("read a file beside the
root"), so a confinement failure is visible in the report even though a leak leaves no refusal in the
decision log; the policy by class (read-write, read-only, denied with each denial's reason class,
enumerable); the link/junction resolution table, where a target that lies outside the root and is not
a granted path is flagged `OUTSIDE THE ROOT, NOT GRANTED` (a granted tool beside the root is by
design); the network policy; the environment variables the confinement drops, as **names** grouped by
prefix, never values; the running relays (registry, signing) and the carried config seeds; a probe
battery whose results each name the responsible layer — PATH resolution of the common tools (a tool
resolving outside the root and ungranted fails as a policy leak), a scratch write, the full-path vs
by-name asymmetry, relay reachability, and a replay of the beside-root canary (a marker in the host's
temporary directory, read through the confined shell at the proven enumeration level); and the last
recorded refusals from the project's rules store. Probe details print one per line, so an error can
never truncate a following value. `--json` prints the same snapshot as one JSON object. The output is
paste-safe by construction: no environment values, no credentials, no file contents, so it can be
pasted into an issue.

Inside a confined session, the agent has the read-only `sandbox_doctor` tool: the same snapshot,
bounded in size, without the probe battery — enough to tell a refusal from a missing tool without
leaving the sandbox.

## Alternative: hand bash to an extension

`sandbox.bashFrom` hands `bash` to a sandboxing extension such as
[pi-landstrip](https://pi.dev/packages/pi-landstrip), instead of a runner. Use it when you need what
the extension adds — a network filter, per-command rules. It does not confine the terminal, and it is
exclusive with `bashRunner`.

```json
{ "sandbox": { "root": "/home/me/project", "allowWrite": true, "allowBash": true, "bashFrom": "npm:pi-landstrip" } }
```

**Installing the extension alone confines nothing.** pi-outpost supplies its own `bash`, which shadows
the extension's, so commands run unconfined while the extension reports its sandbox as on. pi-outpost
warns about it in its log and in the browser. With `bashFrom` (the source `pi list` shows, or a path),
pi-outpost supplies no `bash`, and the session refuses to start unless the `bash` in place is that
extension's; turning bash on from Settings without it is rolled back.

- **Install it where the server loads it**: with `agentDir` set,
  `PI_CODING_AGENT_DIR=/path/to/agentDir pi install npm:pi-landstrip`. pi-outpost exports that
  directory to the extension, so its global `sandbox.json` there is the one enforced.
- **The policy is the extension's**, not pi-outpost's. pi-landstrip reads the whole filesystem unless
  `"shell": { "readAccess": "policy" }`, and merges each project's `.pi/sandbox.json` over its global
  policy before every command — a repository can ship one. pi-outpost's tools never write in `.pi`;
  deny it to commands too: `"filesystem": { "denyWrite": [".pi/**"] }`.
- **A tight policy**, in the agent directory's `sandbox.json`:

  ```json
  {
    "shell": { "readAccess": "policy" },
    "filesystem": { "allowWrite": ["."], "denyWrite": [".pi/**"] },
    "network": { "allowNetwork": false }
  }
  ```

  and `{ "toolFilesystemPolicy": "sandbox" }` in `landstrip.json` beside it, so it checks pi-outpost's
  `read`, `write` and `edit` too. Open the network host by host with `network.allowedDomains`.
- **On Windows it does not work yet** (pi-landstrip 0.19.11: launcher environment, then Git Bash and the
  null device); see [the investigation](investigations/windows-sandboxing.md).

To check it: the session starts (a refusal names the `bash` it found instead), and a command the
policy denies is refused.
