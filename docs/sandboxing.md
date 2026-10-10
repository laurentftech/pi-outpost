# Sandboxing

pi-outpost confines its own file tools. The agent's `bash` and the terminal panel are confined only
when you name a sandbox runner; otherwise a command runs with every right of the account the server
runs as.

- [Recommended setup](#recommended-setup)
- [What is confined](#what-is-confined)
- [Linux: landstrip](#linux-landstrip)
- [Windows 11: MXC and busybox](#windows-11-mxc-and-busybox)
- [Older Windows: WSL](#older-windows-wsl)
- [Check that it is really confined](#check-that-it-is-really-confined)
- [Alternative: hand bash to an extension](#alternative-hand-bash-to-an-extension)

## Recommended setup

Name the same runner for the agent's `bash` (`sandbox.bashRunner`) and for the terminal
(`terminal.sandbox`):

| Where the server runs | Runner | Shell (`sandbox.bashShell`) |
| --- | --- | --- |
| Linux: a Docker container, the host, a VM, WSL2 | [landstrip](#linux-landstrip) | `/bin/bash`, the default |
| Windows 11 with the August 2026 update or later | [MXC's `wxc-exec.exe`](#windows-11-mxc-and-busybox) | busybox-w32's `sh.exe`, required |
| Older Windows | none works natively: use [WSL](#older-windows-wsl) | |
| macOS | untested | |

pi-outpost writes the runner's policy from the configuration, so a command cannot widen it. A
missing or failing runner refuses every command; nothing falls back to running unconfined.

The network stays open (`git fetch`, `npm install` work). To close it, close it around the server —
a Docker network, a firewall — or [hand `bash` to an extension](#alternative-hand-bash-to-an-extension)
that filters it.

## What is confined

| | Confined |
| --- | --- |
| `read`, `ls`, `grep`, `find` | To `sandbox.root`, symlinks resolved, plus read-only the directories of the skills the session loaded — never the disk's root, the home directory, or one holding the agent directory. |
| `edit`, `write`, document tools | To `sandbox.writableRoot`, with `allowWrite` only. Never inside a `.pi` directory, where an extension's policy may live. |
| `bash` (`allowBash`) | **Only with `bashRunner`** (or `bashFrom`). Otherwise it can do anything the server's user can. |
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

Output, exit status, timeout and cancellation behave as for an unconfined `bash`. Each project's
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

## Windows 11: MXC and busybox

```json
{
  "sandbox": {
    "root": "C:\\work\\app",
    "allowWrite": true,
    "allowBash": true,
    "bashRunner": "C:\\tools\\mxc\\node_modules\\@microsoft\\mxc-sdk\\bin\\x64\\wxc-exec.exe",
    "bashShell": "C:\\tools\\sh.exe"
  },
  "terminal": { "enabled": true, "sandbox": "C:\\tools\\mxc\\node_modules\\@microsoft\\mxc-sdk\\bin\\x64\\wxc-exec.exe" }
}
```

1. **Windows 11 24H2 or 25H2 with the August 2026 update or later** (build 26100/26200.9278+).
   `wxc-exec.exe --probe` must report `"tier": "base-container"`; pi-outpost refuses the lower tiers.
2. **MXC's executor**: `npm install @microsoft/mxc-sdk` in any folder (Node 24 or later); `arm64`
   instead of `x64` on ARM.
3. **busybox-w32**: download `busybox64.exe` from frippery.org and save it as `sh.exe`. Git Bash
   cannot start in a Windows sandbox (microsoft/mxc#1061).
4. **Run the server in your interactive session**, not as a service nor over SSH.

Inside: busybox's commands, native git (`status`, `log`, `diff`, branches, commits with your identity),
`node`, `npm`, `cmd` and PowerShell. Limits:

- busybox is `ash`, not bash: no `[[ ]]`, arrays or `$'…'`.
- The root's drive is readable, minus every folder beside the path down to the root (your `.ssh`,
  other projects…), denied by name at each launch — git needs it (microsoft/mxc#1464). Something created
  after the launch is not denied, and `Program Files` and `ProgramData` stay readable. Never make a
  drive's root the sandbox root: nothing would be left to deny.
- A folder readable but not writable can be neither listed nor entered: leave the whole root writable
  (no narrower `writableRoot`) where git runs.
- `git push` has no credentials, and signed commits fail: GnuPG for Windows is built without ASLR, which
  the sandbox enforces.
- The confined PowerShell starts with `-ExecutionPolicy RemoteSigned` and progress bars off; give both
  yourself to a shell you name in `terminal.shell`.

Details and probes: [`investigations/windows-sandboxing.md`](investigations/windows-sandboxing.md).

## Older Windows: WSL

Without MXC's tier 1, no runner works natively (landstrip's AppContainer cannot run git:
landstrip/landstrip#204). Run pi-outpost in WSL, with the Linux setup, after closing WSL's doors to
Windows — by default it mounts every drive read-write and can start any Windows program, unconfined.

In `/etc/wsl.conf`, then `wsl --shutdown`:

```ini
[interop]
enabled = false
appendWindowsPath = false

[automount]
enabled = false
mountFsTab = true
```

Mount only the project, in `/etc/fstab`:

```
C:/Users/me/dev/project  /mnt/project  drvfs  rw,metadata,uid=1000,gid=1000,umask=022  0 0
```

Then the [Linux configuration](#linux-landstrip) with `"root": "/mnt/project"`, plus
`"files": { "watch": false }`: changes made from Windows raise no event inside WSL. Prefer a distribution
of its own (`wsl --import`), and keep your Windows credentials and SSH agent out of it.

## Check that it is really confined

1. The server's startup line reads `bash (confined by <runner>)`, never `bash (UNCONFINED)`.
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
