# Sandboxing

pi-outpost confines its own file tools. The agent's `bash` and the terminal panel are confined only
when you name a sandbox runner; otherwise a command runs with every right of the account the server
runs as.

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

## Recommended setup

Name the same runner for the agent's `bash` (`sandbox.bashRunner`) and for the terminal
(`terminal.sandbox`):

| Where the server runs | Runner | Shell (`sandbox.bashShell`) |
| --- | --- | --- |
| Linux: a Docker container, the host, a VM, WSL2 | [landstrip](#linux-landstrip) — or, loosening Docker's profile, [MXC](#linux-as-an-option-mxc) | `/bin/bash`, the default |
| Windows 11 with the August 2026 update or later | [MXC](#windows-11-mxc-and-powershell): `"mxc"`, installed with pi-outpost | `powershell.exe` (the agent gets a `powershell` tool), busybox-w32's `sh.exe`, or — experimental — a real bash in a [Linux container](#a-real-bash-wslc-experimental) (`sandbox.bashImage`) |
| Older Windows | none works natively: see [Older Windows](#older-windows) | |
| macOS on Apple silicon | [MXC](#macos-on-apple-silicon-mxc): `"mxc"`, installed with pi-outpost — or [Seatbelt](#macos-every-mac-seatbelt): `"seatbelt"` | `/bin/bash`, the default |
| macOS on Intel | [Seatbelt](#macos-every-mac-seatbelt): `"seatbelt"`, part of macOS | `/bin/bash`, the default |

pi-outpost writes the runner's policy from the configuration, so a command cannot widen it. A
missing or failing runner refuses every command; nothing falls back to running unconfined.

The network stays open (`git fetch`, `npm install` work). Under MXC (Windows 11, Linux, Apple-silicon macOS) or Seatbelt (macOS), `sandbox.allowedHosts` limits it
to the hosts you name ([below](#the-network-only-named-hosts)). Elsewhere, close it around the server —
a Docker network, a firewall — or [hand `bash` to an extension](#alternative-hand-bash-to-an-extension)
that filters it.

## What is confined

| | Confined |
| --- | --- |
| `read`, `ls`, `grep`, `find` | To `sandbox.root`, symlinks resolved, plus read-only the directories of the skills the session loaded — never the disk's root, the home directory, or one holding the agent directory. |
| `edit`, `write`, document tools | To `sandbox.writableRoot`, with `allowWrite` only. Never inside a `.pi` directory, where an extension's policy may live. |
| `bash` (`allowBash`) | **Only with `bashRunner`** (or `bashFrom`). Otherwise it can do anything the server's user can. With a PowerShell `bashShell`, the agent's shell tool is `powershell` instead, confined the same way. |
| The terminal panel | **Only with `terminal.sandbox`.** |
| Extensions, MCP servers | **No.** They run with the server's rights, or their own process's. |

Pi's own `bash`, `powershell`, `edit` and `write` are never registered in a sandbox, so nothing can
switch them back on. The file tools' confinement is pi-outpost checking paths, not an operating-system
boundary; the runner is one.

Under a runner, a command (or a terminal) may:

| | |
| --- | --- |
| Read | The sandbox root, the system directories, the tools on the `PATH`, a private temporary directory. |
| Write | The writable zone and the private temporary directory. Nothing with `allowWrite: false`. |
| Never | The agent directory (`auth.json`, the keys) and the configuration file. |
| Environment | `PATH`, locale, `TERM`, `SHELL`, `HOME` set to the root, npm's cache in the temporary directory, `GIT_CONFIG_GLOBAL` naming your `~/.gitconfig` (read-only, for git's identity); on Windows `USERPROFILE`, `TEMP` and `TMP` point to the temporary directory. None of the server's other variables, so no provider key. |
| Signal | No process outside the sandbox. |

Output, exit status, timeout and cancellation behave as for an unconfined `bash`. Commands the model
asks for in one message run one after another, in the order it wrote them, where pi would run them
together: each starts a runner first, and a step that depends on the previous one (create, then
rename) would otherwise overtake it. Each project's
commands and terminals are confined to that project's root. Settings never edit `bashRunner` or
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
./package/bin/landstrip doctor                     # {"ok":true,…,"implementation":"landlock+seccomp"}
```

It needs Landlock (kernel 5.13 or later, enabled) and a seccomp profile that lets its calls through;
Docker's default one does.

**In Docker, keep the runner.** The container protects the host, not what the server holds inside it:
the agent directory, the configuration, every mounted project. Also:

- run the server as an ordinary user, not root (`--security-opt no-new-privileges` is compatible);
- mount only the projects and the agent directory — never the Docker socket, never `--privileged`;
- keep provider keys in the credential store (`pi-outpost login`, or Settings), not in the server's
  environment: a command can still read it through `/proc/<pid>/environ` (same account).

## Linux, as an option: MXC

```json
{
  "sandbox": { "root": "/work/app", "allowWrite": true, "allowBash": true, "bashRunner": "mxc", "allowedHosts": ["registry.npmjs.org", "github.com"] },
  "terminal": { "enabled": true, "sandbox": "mxc" }
}
```

On Linux, `"mxc"` names MXC's Linux executor (`lxc-exec`), installed with pi-outpost like Windows'
`wxc-exec.exe`; a path ending in `lxc-exec` names it too. Its Bubblewrap backend runs each command, and
each terminal, in namespaces holding only the system trees, the root and the command's temporary
folder — no home, no other project, no agent directory. What it adds over landstrip:

- **The server's processes are out of sight**: the command sees its sandbox's processes alone, so the
  `/proc/<pid>/environ` read above finds nothing.
- **`sandbox.allowedHosts`**, as on Windows ([below](#the-network-only-named-hosts)): outbound and inbound
  traffic denied, the server's proxy the only way out. Without it, the network is open.

**The price is Docker's own hardening.** Bubblewrap needs user namespaces, which Docker's default seccomp
and AppArmor profiles refuse; it mounts a fresh `/proc` for the command, which the kernel refuses while
Docker masks parts of the container's own (`systempaths`); and any network rule needs a tun device for
slirp4netns:

```bash
docker run \
  --security-opt seccomp=unconfined --security-opt apparmor=unconfined \
  --security-opt systempaths=unconfined \
  --init \
  --device /dev/net/tun \
  --security-opt no-new-privileges \
  …
```

and the image needs `bubblewrap`, `slirp4netns`, `iptables` and `ip`
(`apt-get install bubblewrap slirp4netns iptables iproute2`). Under Docker's default profile the runner is
refused at its self-check — a confined `/bin/true` — with MXC's reason, and every command with it.
On an Ubuntu 24.04+ host, AppArmor also refuses unprivileged user namespaces to every process outside a
profile that allows them, inside a container or not: set `kernel.apparmor_restrict_unprivileged_userns=0`
on the host (a host-wide loosening), or give the container an AppArmor profile that permits `userns`.
MXC's refusal names this case. `--init` puts an init in front of pi-outpost: a terminal closed under `lxc-exec` leaves its `bwrap`
processes to the container's first process, and Node does not reap them — without it, three zombies
pile up per closed terminal. Keep the rest of the advice above: an ordinary user, no Docker socket, no
`--privileged`. If loosening the container is not acceptable, landstrip is the runner.

`sandbox.bashImage` (WSLC) is Windows only. `scripts/mxc-linux/test.sh` runs this runner's tests in a
container both ways; CI's `mxc-linux` job runs it on every pull request.

## macOS on Apple silicon: MXC

`@microsoft/mxc-sdk`, installed with pi-outpost, carries MXC's macOS executor, `mxc-exec-mac`, built on
Seatbelt — the sandbox macOS applies to its own apps. Nothing has to be installed or loosened:

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

`/usr/bin/git` is Apple's `xcrun` shim, which cannot find its cache folders in the sandbox and warns
on every call: the confined search path puts the developer tools' own `git` first (Xcode's or the
Command Line Tools', whichever `xcode-select -p` names).

The executor exists for Apple silicon only: on an Intel Mac `"mxc"` is refused at start, saying so —
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
   `wxc-exec.exe --probe` must report `"tier": "base-container"`; pi-outpost refuses the lower tiers.
2. **MXC's executor comes with pi-outpost**: `wxc-exec.exe`, signed by Microsoft, in the optional
   dependency `@microsoft/mxc-sdk` — installed by default, see
   [MXC comes with pi-outpost](../README.md#mxc-comes-with-pi-outpost). `"mxc"` names it, for this
   machine's architecture; a path to another `wxc-exec.exe` works too. The standalone executable looks
   for `wxc-exec.exe` beside itself, where `pi-outpost build-exe` puts it.
3. **Run the server in your interactive session**, not as a service nor over SSH.

Nothing else is installed: Windows PowerShell 5.1 comes with Windows. `pwsh.exe` (PowerShell 7) works
too. With a PowerShell `bashShell` the agent is given pi's `powershell` tool instead of `bash`, so the
model writes PowerShell; every command runs from a script, without profile, with the execution policy
given for the process (the sandbox cannot read the registry's), progress bars off (drawing one is
refused inside) and output as plain text (PowerShell 7 colours tables and errors otherwise, and the model
reads the escape codes). Its exit status is the one it sets with `exit`, else the failed native program's code,
or 1 for a failed cmdlet.

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
- A folder readable but not writable can be neither listed nor entered: leave the whole root writable
  (no narrower `writableRoot`) where git runs.
- `git push` has no credentials, and signed commits fail: GnuPG for Windows is built without ASLR, which
  the sandbox enforces.
- The confined terminal's PowerShell starts with `-ExecutionPolicy RemoteSigned` and progress bars off;
  give both yourself to a shell you name in `terminal.shell`.

Details and probes: [`investigations/windows-sandboxing.md`](investigations/windows-sandboxing.md).

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
The server logs each refusal (`[sandbox] network: refused …`), and the command's output ends with a note
naming the hosts refused while it ran, so the agent can tell you what to add:

```
curl: (56) CONNECT tunnel failed, response 403

[pi-outpost] network refused: example.com — not in sandbox.allowedHosts. Ask the user to add it there if the command needs it.
```

- A name matches that host only; `*.githubusercontent.com` matches the names under it, not
  `githubusercontent.com` itself. An empty list closes the network entirely.
- Plain `http://` is relayed like HTTPS, to the listed hosts only.
- On Windows, list your hosts' certificate authorities too. `curl.exe` checks a certificate's
  revocation by fetching the authority's list over plain HTTP, and fails when it cannot: for
  registry.npmjs.org that is `*.pki.goog`. The note after the output names the host it was refused.
- The agent's shell only, under MXC — Windows' process container, or [Linux's](#linux-as-an-option-mxc)
  Bubblewrap: the key is refused without MXC as `bashRunner`, and with `bashImage` (WSLC). The terminal
  panel is your own shell and keeps the network.
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
(`wsl --version` 3.0 or later). The image is downloaded on the first command (about 20 s), then each
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

## Older Windows

Without MXC's tier 1, no runner confines natively: landstrip's AppContainer cannot run git
(landstrip/landstrip#204), and MXC's lower tiers hit the same wall. Two ways out, neither easy:

- **Update to Windows 11 with the August 2026 update**, then the setup above. This is the supported
  path.
- **Run pi-outpost inside WSL** with the [Linux setup](#linux-landstrip). WSL mounts every drive
  read-write and can start any Windows program, unconfined, so this holds only after closing those doors
  (`[interop] enabled = false`, `appendWindowsPath = false`, `[automount] enabled = false` in
  `/etc/wsl.conf`, the project alone mounted from `/etc/fstab`, `"files": { "watch": false }`), in a
  distribution of its own. It is fiddly to get right and easy to undo; prefer the update.

## Check that it is really confined

1. The server's startup line reads `bash (confined by <runner>, …)` — `powershell (confined by …)` with
   a PowerShell shell, `… WSLC image <image>` with `bashImage` — never `bash (UNCONFINED)`.
2. Ask the agent, in the chat, to read a sibling project and the agent directory's `auth.json`, to
   write outside the writable zone, and to list its environment for a key. Each must be refused or empty.
3. Do the same in the terminal.
4. Repeat after changing the configuration or the runner.

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
