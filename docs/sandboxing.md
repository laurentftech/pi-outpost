# Sandboxing: what is confined, and what is not

**Installing a sandboxing extension does not, by itself, confine anything in pi-outpost.**
An extension such as [pi-landstrip](https://pi.dev/packages/pi-landstrip) loads without an
error, reports its sandbox as on, and — unless you also set
[`sandbox.bashFrom`](#hand-bash-to-the-extension-sandboxbashfrom) — the agent's commands still
run unconfined. This page says what pi-outpost confines, what it does not, why an extension
alone is not enough, and how to check that what you set up is really in force.

- [What pi-outpost confines](#what-pi-outpost-confines)
- [What it does not](#what-it-does-not)
- [Why installing an extension is not enough](#why-installing-an-extension-is-not-enough)
- [Hand bash to the extension: `sandbox.bashFrom`](#hand-bash-to-the-extension-sandboxbashfrom)
- [Confine pi-outpost's own bash: `sandbox.bashRunner`](#confine-pi-outposts-own-bash-sandboxbashrunner)
- [Confine the terminal: `terminal.sandbox`](#confine-the-terminal-terminalsandbox)
- [The agent cannot rewrite what confines it](#the-agent-cannot-rewrite-what-confines-it)
- [Several projects open at once](#several-projects-open-at-once)
- [Check that it is really confined](#check-that-it-is-really-confined)
- [Recipe: WSL on a managed Windows machine](#recipe-wsl-on-a-managed-windows-machine)

## What pi-outpost confines

With a `sandbox` in the configuration, pi-outpost replaces Pi's file tools with its own:

- `read`, `ls`, `grep` and `find` are confined to `sandbox.root`, with symlinks resolved — plus,
  read-only, the directory of each skill the session loaded (bundled with pi-outpost, installed into
  the agent directory, `~/.agents/skills`…), so a skill the agent is told about is one it can open.
  Never a directory that would open more: the disk's root, your home directory, or one holding the
  agent directory, where `auth.json` keeps your keys;
- `edit` and `write` are confined to `sandbox.writableRoot`, and only exist with `allowWrite`;
- the document tools (PDF, Word, Excel, PowerPoint, mail) follow the same zones.

Pi's own built-ins that the sandbox does not replace — `bash`, `powershell`, and `edit`/`write` in a
read-only sandbox — are **not registered at all**, so no extension or setting can switch them back on.

That confinement is pi-outpost checking paths before it touches a file. It is not an operating-system
boundary: it holds for these tools, and for nothing else.

## What it does not

| Path to the machine | Confined by pi-outpost? |
| --- | --- |
| `bash`, once `allowBash` is on | **No**, unless `sandbox.bashRunner` names a sandbox runner (below), or `sandbox.bashFrom` hands it to a sandboxing extension. Otherwise it starts in the project, and can do anything the server's user can. |
| Extensions | **No.** They run inside the server process, with all of its rights. |
| MCP servers | **No.** They are separate processes, with the rights of the user who starts them. |
| The terminal panel (`terminal.enabled`) | **Not by default.** It is a shell for you, not for the agent. Set `terminal.sandbox` to confine it to the sandbox (below). |
| Anything a command starts | **No.** It inherits whatever confined, or did not confine, the command. |

Where any of these is on, the real boundary is the account the server runs as and the machine
around it: a dedicated user, a container, a VM — or a sandboxing extension that pi-outpost actually
uses (below).

## Why installing an extension is not enough

A sandboxing extension can protect you in three ways, and pi-outpost treats each differently:

| What the extension does | In pi-outpost |
| --- | --- |
| **Replaces a tool** with a confined one of the same name (pi-landstrip's `bash`) | **Shadowed.** When two tools share a name, Pi keeps the one the application supplies over the one an extension registers. pi-outpost supplies its own `bash` with `allowBash`, so the extension's confined `bash` is never the one that runs — **unless `sandbox.bashFrom` names that extension**. |
| **Filters tool calls** through a `tool_call` hook (allow, deny or ask per command or path) | **Applies.** Hooks see pi-outpost's tools too. But a filter decides *whether* a call runs; it does not confine *what the command then does*. |
| **Confines the whole process** (it runs pi-outpost inside its sandbox) | **Applies**, to everything the server does. |

pi-landstrip does the first two. Without `bashFrom`, you keep only its filter: commands it lets
through run unconfined — the extension still reports its sandbox as on, because it is, for a `bash`
the agent never uses. pi-outpost warns about it (below); the extension does not.

The same rule shadows any extension's `read`, `write` or `edit`: pi-outpost keeps its own confined
ones, which is what a sandbox should do. Only `bash` can be handed over.

## Hand bash to the extension: `sandbox.bashFrom`

```json
{
  "sandbox": {
    "root": "/home/me/project",
    "allowWrite": true,
    "allowBash": true,
    "bashFrom": "npm:pi-landstrip"
  }
}
```

`bashFrom` names the extension that supplies `bash`: its package source exactly as Pi lists it
(`pi list` shows `npm:pi-landstrip`), or the path of an extension file or directory. With it,
pi-outpost supplies no `bash` of its own, and:

- **the session refuses to start** unless the `bash` in place comes from that extension. The
  refusal names what it found instead: none (the extension is not installed, or not enabled),
  Pi's own, pi-outpost's, or another extension's, with its path;
- **turning bash on from Settings** while that extension is missing is refused and rolled back,
  so the next start is not refused too;
- **without `allowBash`**, there is no `bash` at all, the extension's included.

What `bash` may then do is the extension's policy, not pi-outpost's. For pi-landstrip, read its
defaults before trusting them: its shell may **read the whole filesystem** unless you set
`"shell": { "readAccess": "policy" }`, it may write only in the current directory, and the
network is off.

Two practical points:

- **Install the extension where the server loads it.** If your configuration sets `agentDir`,
  install into that directory: `PI_CODING_AGENT_DIR=/path/to/agentDir pi install npm:pi-landstrip`.
- **The extension reads the same directory.** An extension that looks up Pi's agent directory for
  itself — pi-landstrip does, for its global `sandbox.json` — reads `PI_CODING_AGENT_DIR`. With
  `agentDir` set, pi-outpost exports it to that directory as it starts (embedded runtime; the RPC
  runtime passes it to its child), so the policy beside the packages the server loads is the one
  enforced. The terminal panel keeps the value you started the server with: a `pi` you type there
  is still yours.

**If you forget `bashFrom`**, pi-outpost says so. When `allowBash` is on, `bashFrom` is not set, and an
extension registers its own `bash`, the server log carries a `WARNING` naming the extension, and every
browser that opens the project gets the same warning, with the `bashFrom` line to add.

## Confine pi-outpost's own bash: `sandbox.bashRunner`

Instead of handing `bash` to an extension, pi-outpost can keep its own and run **every command inside a
sandbox runner** — the same runners, and the same policy, as a [confined terminal](#confine-the-terminal-terminalsandbox):

```json
{
  "sandbox": {
    "root": "C:\\work\\app",
    "allowWrite": true,
    "allowBash": true,
    "bashRunner": "C:\\tools\\mxc\\wxc-exec.exe",
    "bashShell": "C:\\tools\\sh.exe"
  }
}
```

- `bashRunner` is MXC's executor (`wxc-exec.exe`, Windows 11) or landstrip's binary (Linux). Paths are
  resolved against the configuration file. Exclusive with `bashFrom`: naming both is refused at load.
- `bashShell` is the shell the commands run in. Default `/bin/bash`. **On Windows it must be named**, and
  it must be busybox-w32's `sh.exe`: Git Bash cannot start in any Windows sandbox (MSYS2's named objects,
  microsoft/mxc#1061).
- Each command is one launch of the runner: the command is written to a script in a private temporary
  directory, and the shell runs it there. Output, exit status, timeout and cancellation behave as for pi's
  own `bash`; cancelling ends the confined command too.
- What a command may do is what a confined terminal in the same project may do: read the root, write the
  writable zone, never the agent directory nor the configuration file, and none of the server's
  environment variables — so no provider key.
- If the runner is missing or fails its self-check, or no `bashShell` is named on Windows, **every `bash`
  call is refused** with the reason, and nothing runs. The session and its other tools keep working.
- Settings do not edit these two fields, and keep them when applying a sandbox change.

### On Windows 11: MXC and busybox

This is the setup that works on Windows today, measured on Windows 11 24H2 (build 26100.9457); the
investigation is in [`docs/investigations/windows-sandboxing.md`](investigations/windows-sandboxing.md).

1. **Windows 11 24H2 or 25H2 with the August 2026 update or later** (build 26100/26200.9278+): MXC's
   tier 1, where Windows applies the policy itself. pi-outpost refuses the lower tiers (Windows 10 and
   older builds), which would rewrite file ACLs at every launch.
2. **MXC's executor**: `npm install @microsoft/mxc-sdk` in any folder (Node 24 or later), then point
   `bashRunner` at `node_modules\@microsoft\mxc-sdk\bin\x64\wxc-exec.exe` (`arm64` on ARM).
   `wxc-exec.exe --probe` must say `"tier": "base-container"`.
3. **busybox-w32** as the shell: download `busybox64.exe` from frippery.org and save it as `sh.exe`.
4. Run the server **in your interactive session**, not as a service nor over SSH.

What works inside: busybox's commands and pipes, `/dev/null`, native git (`status`, `log`, `diff`,
branches), `node`, `npm -v`, `cmd` and PowerShell; about 0.13 s per command. What to know:

- **busybox is `ash`, not bash**: no `[[ ]]`, arrays or `$'…'`.
- **The root's drive is readable, minus everything beside the path to the root.** Git for Windows finds
  its working directory by listing every parent folder, and the sandbox cannot do that otherwise
  (microsoft/mxc#1464). So `C:\` is readable and every entry of `C:\`, `C:\Users`, `C:\Users\you`…
  that is not on the way down to the root is denied by name — your `.ssh`, `.gitconfig`, OneDrive,
  other projects. The list is read at each launch: something created afterwards beside one of those
  folders, or a file another program holds open at that moment, is not denied. Folders under
  `C:\Program Files` and `C:\ProgramData` stay readable.
- **A read-only folder can be neither listed nor entered**: with a `writableRoot` narrower than the root,
  `ls` or `cd` in the read-only part fails, and so does git there. With the whole root writable (no
  `writableRoot`), this does not arise.
- **Network**: allowed, as for the terminal. `git push` needs credentials that the policy keeps out of
  reach (the credential manager, `~\.ssh`). npm's cache is set to the command's (or terminal's) private
  temporary directory, so it works, and starts empty each time.
- **Git's identity**: your `~\.gitconfig` is passed as `GIT_CONFIG_GLOBAL` and readable on its own,
  read-only, so commits carry your name. Files it includes (`include.path`) are not opened up, and a
  configuration that requires signing makes commits fail (next point).
- **Signed commits** (`commit.gpgsign`) fail, and opening the keyring does not help: MXC's tier 1
  enforces ASLR, and GnuPG's Windows binaries (Gpg4win 4.x 32-bit and 5.1.1 64-bit alike) are built
  without it, so `gpg.exe` cannot start in the sandbox (`ERROR_ILLEGAL_DLL_RELOCATION`, 623). Windows
  OpenSSH's `ssh-keygen` is built with ASLR, so git's SSH signing (`gpg.format = ssh`, with the key in
  Windows' `ssh-agent`) is the likely way in; not tried.

### On Linux: landstrip

Name landstrip's binary (see [the terminal's install steps](#confine-the-terminal-terminalsandbox)) and
leave `bashShell` out to use `/bin/bash`. The policy is the terminal's: reads limited to the root, the
system directories and the tools on the `PATH`.

## Confine the terminal: `terminal.sandbox`

The terminal panel is a real shell, with every right of the account the server runs as. It ignores
`sandbox.root`, writes outside the writable zone, and can read the agent directory where the provider
keys are. Name a sandbox runner and every terminal runs inside it instead:

```json
{
  "terminal": { "enabled": true, "sandbox": "/opt/landstrip/bin/landstrip" },
  "sandbox": { "root": "/work/app", "allowWrite": true, "writableRoot": "/work/app/out", "allowBash": true }
}
```

The runner is landstrip's (the same project as pi-landstrip, which confines the agent's `bash`). It is
not bundled: fetch the package for your platform and point `terminal.sandbox` at its binary.

```bash
npm pack @landstrip/landstrip-linux-x64            # -linux-arm64, -win32-x64, -darwin-arm64…
tar xzf landstrip-landstrip-linux-x64-*.tgz        # the binary is package/bin/landstrip
./package/bin/landstrip doctor                     # {"ok":true,…,"implementation":"landlock+seccomp"}
```

Run `doctor` **where pi-outpost runs** — inside its container when it has one. On Linux it needs
Landlock (kernel 5.13 or later, enabled) and a seccomp filter that lets its calls through. Docker's
default profile does; bubblewrap, by comparison, needed it loosened.

With `terminal.sandbox` set:

| | Confined terminal |
| --- | --- |
| Reads | The sandbox root (the project root without a sandbox), the system directories, the tools on the `PATH`, and a private temporary directory. Nothing else — other projects, the home directory, `/opt`, `/var`. |
| Writes | The writable zone and the private temporary directory. Nothing with `allowWrite: false`. |
| Never | The agent directory (provider keys) and the configuration file, even under an allowed tree. |
| Environment | `PATH`, the locale, `TERM`, `SHELL`, `HOME` set to the root, npm's cache in the private temporary directory, and `GIT_CONFIG_GLOBAL` naming your `~/.gitconfig` (readable on its own, read-only, for git's identity) (on Windows, `USERPROFILE` is the private temporary directory, so a profile's data — PowerShell's history — never lands in the project). None of the server's other variables, so no key it holds. |
| Other processes | Cannot be signalled from inside. |
| "open as project" | Moves the agent only where the directory picker could: locks still hold. |

If the runner is missing, or its self-check fails, there is **no terminal** — the panel shows why —
and the rest of pi-outpost works. It never falls back to an unconfined shell. Without
`terminal.sandbox` the terminal is what it always was.

What stays readable: the server's own environment, through `/proc/<pid>/environ` (same account, no
separate process namespace). Keep provider keys in the credential store (`pi-outpost login`, or
Settings), not in the server's environment.

**Windows 11: MXC.** `terminal.sandbox` may name MXC's executor (`wxc-exec.exe`) instead, with the same
requirements, policy and limits as [the agent's `bash` on Windows 11](#on-windows-11-mxc-and-busybox):
`NUL`, git and busybox work there, and `cmd` or PowerShell open as the terminal's shell (or the one named in
`terminal.shell`). Its self-check is `wxc-exec.exe --probe`, which must report tier 1 (`base-container`).
Inside the sandbox PowerShell cannot draw progress bars (drawing one reads the console back, which is
refused, and the command fails), so the default confined PowerShell starts with
`$ProgressPreference='SilentlyContinue'`; set it yourself in a shell you name.

**Platforms.** Linux (WSL included) is the supported one for landstrip. On Windows landstrip's runner uses an AppContainer
and confines reads and writes the same way, and with no `terminal.shell` set the terminal opens PowerShell.
`cmd`, PowerShell and busybox run inside it; Git Bash does not (MSYS2 needs global named objects an
AppContainer may not create), and neither does `git`: the null device (`NUL`) is out of reach in the
container, and Git for Windows opens it at startup (even `type nul` is refused; reported upstream as landstrip/landstrip#204:
`\Device\Null` grants no access to AppContainers, and only an administrator can change that, once per
boot). The parent of the root can
be listed (names, not contents). The server must run in the user's interactive session: started as a
service or over SSH, its containers get no window station and most programs fail to start
(`0xC0000142`). macOS is untested.

### pi-landstrip's `bash` on Windows

As of pi-landstrip 0.19.11, the agent's `bash` does not run through it on Windows out of the box (tested
on Windows 10, interactive session; `scripts/probes/pi-landstrip-bash.mjs` reproduces each step):

1. **Default configuration**: pi's shell on Windows is Git Bash, outside pi-landstrip's `allowRead`, so the
   first call stops on a permission question — in pi-outpost a dialog, and the tool call looks stuck
   until someone answers it.
2. **Git allowed**: pi-landstrip launches its runner without `LOCALAPPDATA` and `SystemRoot`, and every
   call fails with `os error 203`. This one needs a pi-landstrip fix (reported upstream as landstrip/landstrip#203; a local patch
   is `scripts/probes/patch-pi-landstrip-launcher-env.cjs`).
3. **Even then, Git Bash cannot start in an AppContainer** (MSYS2's global named objects).

What works, with the fix for 2: a native shell. Copy busybox-w32 as `sh.exe`, name it as pi's shell, and
put pi-landstrip in the standard AppContainer (its default, `lpac`, breaks busybox's networking):

```json
// <agentDir>/settings.json
{ "shellPath": "C:\\tools\\sh.exe" }
// <agentDir>/sandbox.json
{
  "shell": { "readAccess": "policy" },
  "filesystem": { "allowRead": [".", "C:\\Windows", "C:\\tools\\sh.exe"] },
  "windows": { "appContainerMode": "standard" }
}
```

With that, the agent's commands run in the project, writes outside it are refused, and reads outside it
stop on a permission question — but any command touching `/dev/null` (`2>/dev/null`, `> /dev/null`)
fails, because the null device is out of reach in an AppContainer (landstrip/landstrip#204; fixing it
takes an administrator, once per boot). Until both are fixed upstream, use WSL (the recipe below).

## The agent cannot rewrite what confines it

A sandboxing extension's policy can live in the project itself. pi-landstrip merges the project's
`.pi/sandbox.json` over its global policy — later values win, lists add up — and reads it **before
every command**. Every project open in pi-outpost counts as trusted, so that file is read. An agent
able to write it could widen what its own next command may do: read the whole disk, reach the
network, write elsewhere.

So **none of pi-outpost's tools may write in a `.pi` directory** under the writable zone: `write`,
`edit`, and every tool that writes a file (documents, figures, tables, comparisons, mail
attachments). The refusal says why. The agent may still read those files, and you may edit them —
from your editor, or from the file browser, which is your hand, not the agent's. `.pi-outpost/`,
which holds the project's structured-exchange profiles, is not affected.

What this does not cover, and what to set for it:

- **Commands.** A `bash` command is not one of pi-outpost's tools. pi-outpost's own `bash` (without
  `bashFrom` or `bashRunner`) can write anywhere the server's user can. With `bashRunner`, its commands
  may write in the writable zone, `.pi` included — but that policy comes from the configuration file,
  which a command can neither read nor write, so nothing it writes widens it. pi-landstrip's denies writing
  `.pi/sandbox.json` by default; add the rest of the directory to its policy:
  `"filesystem": { "denyWrite": [".pi/**"] }`.
- **The extension's own view of file tools.** With `"toolFilesystemPolicy": "sandbox"` in
  `landstrip.json`, pi-landstrip also checks `read`, `write` and `edit` against its file policy — a
  second opinion on pi-outpost's tools of those names. It does not know pi-outpost's other tools,
  which the rule above covers.

## Several projects open at once

One server, one installation of the extension, loaded into **each project's session**:

- `bashRunner` and `bashShell` are server-wide too; each project's commands are confined to that
  project's root, with the same policy as its terminal.
- `allowBash` and `bashFrom` are server-wide. Each project's session checks that its `bash` is the
  extension's when it starts; turning bash on from Settings rebuilds every open project, and is
  rolled back everywhere if the extension is missing.
- Each project is confined to its own directory: pi-outpost's file tools to the project, and
  pi-landstrip's `"."` to the session's working directory — that project. `"allowWrite": ["."]`
  lets each project's commands write in that project only.
- The extension's policy is its global file plus **each project's own `.pi/sandbox.json`**, which may
  differ from one project to the next. Look at it when you open a project you did not write: a
  repository can ship one.
- The terminal panel, if enabled, is opened per project and confined by nothing.

## Check that it is really confined

Do not stop at "the extension says it is on". Check what the agent's commands can do:

1. **The session starts with `bashFrom` set.** That proves the `bash` the agent uses is the
   extension's. A refusal at start names the `bash` it found instead.
2. **A command the policy forbids is refused.** Ask the agent, in the chat, to run something your
   policy denies — reading a directory outside the project (`ls ~`, which pi-landstrip's defaults
   deny), writing outside it (`touch /tmp/outside-check`), or reaching the network
   (`curl -sI https://example.com`). The tool result must be a refusal from the extension, not an
   output.
3. **Repeat after any change** to the configuration, the extension's policy, or the extension's
   version.

If step 2 succeeds where it should be refused, the commands are not confined, whatever the
extension reports.

## Recipe: WSL on a managed Windows machine

A Windows machine where you cannot install a container runtime, and where the agent should only
touch one project folder on the Windows disk.

**1. Close WSL's doors to Windows.** By default a WSL distribution mounts every Windows drive
read-write (`/mnt/c`…) and can launch any Windows program (`powershell.exe`, `cmd.exe`), which then
runs as your Windows account, outside anything Linux confines. In `/etc/wsl.conf`:

```ini
[interop]
enabled = false
appendWindowsPath = false

[automount]
enabled = false
mountFsTab = true
```

Then `wsl --shutdown` from Windows. Keep interop on only if the agent must start Windows programs —
and know that those programs are not confined by anything in WSL.

**2. Mount only the project folder**, in `/etc/fstab`:

```
C:/Users/me/dev/project  /mnt/project  drvfs  rw,metadata,uid=1000,gid=1000,umask=022  0 0
```

The rest of `C:` is not mounted. Prefer a distribution of its own for pi-outpost (`wsl --import`),
separate from the one you work in.

**3. Run pi-outpost as an ordinary user**, with the sandbox on that folder and bash handed to the
extension:

```json
{
  "cwd": "/mnt/project",
  "sandbox": { "root": "/mnt/project", "allowWrite": true, "allowBash": true, "bashFrom": "npm:pi-landstrip" },
  "files": { "watch": false }
}
```

`files.watch` is off because changes made from Windows raise no event inside WSL; the file tree's
↻ re-lists by hand. Working on `/mnt/...` is slower than a Linux directory — noticeable for git and
large trees, not for ordinary editing.

**4. Tighten the extension's policy.** For pi-landstrip, in the global `sandbox.json` of the agent
directory it reads (see above) — not in the project, which you want to keep from widening it:

```json
{
  "shell": { "readAccess": "policy" },
  "filesystem": { "allowWrite": ["."], "denyWrite": [".pi/**"] },
  "network": { "allowNetwork": false }
}
```

and in `landstrip.json` beside it, so that it checks pi-outpost's `read`, `write` and `edit` too:

```json
{ "toolFilesystemPolicy": "sandbox" }
```

If the agent must install packages, allow only the hosts it needs (`network.allowedDomains`, for
example `pypi.org` and `files.pythonhosted.org`). With `readAccess: "policy"`, a command that needs
a system path it cannot read fails: grant that path in `filesystem.allowRead` rather than going back
to host-wide reads.

**5. Check it** as described above, from the chat.

Keep secrets out of that distribution: the model's API key, and for git a token scoped to the
repository — not your Windows credentials or SSH agent.
