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
- [Check that it is really confined](#check-that-it-is-really-confined)
- [Recipe: WSL on a managed Windows machine](#recipe-wsl-on-a-managed-windows-machine)

## What pi-outpost confines

With a `sandbox` in the configuration, pi-outpost replaces Pi's file tools with its own:

- `read`, `ls`, `grep` and `find` are confined to `sandbox.root`, with symlinks resolved;
- `edit` and `write` are confined to `sandbox.writableRoot`, and only exist with `allowWrite`;
- the document tools (PDF, Word, Excel, PowerPoint, mail) follow the same zones.

Pi's own built-ins that the sandbox does not replace — `bash`, `powershell`, and `edit`/`write` in a
read-only sandbox — are **not registered at all**, so no extension or setting can switch them back on.

That confinement is pi-outpost checking paths before it touches a file. It is not an operating-system
boundary: it holds for these tools, and for nothing else.

## What it does not

| Path to the machine | Confined by pi-outpost? |
| --- | --- |
| `bash`, once `allowBash` is on | **No.** It starts in the project, and can do anything the server's user can. |
| Extensions | **No.** They run inside the server process, with all of its rights. |
| MCP servers | **No.** They are separate processes, with the rights of the user who starts them. |
| The terminal panel (`terminal.enabled`) | **No.** It is a shell for you, not for the agent, and nothing confines it. |
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
through run unconfined, and nothing tells you so — the extension still reports its sandbox as on,
because it is, for a `bash` the agent never uses.

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
- **Make the extension read the same directory.** pi-outpost hands `agentDir` to its sessions but
  does not export it, and an extension that looks up Pi's agent directory itself — pi-landstrip
  does, for its global `sandbox.json` — sees `PI_CODING_AGENT_DIR`, or `~/.pi/agent` without it. Start
  the server with `PI_CODING_AGENT_DIR` set to the same directory as `agentDir`, or leave `agentDir`
  unset, so that the policy you wrote is the one it reads.

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
directory it reads (see above) or in the project's `.pi/sandbox.json`:

```json
{
  "shell": { "readAccess": "policy" },
  "filesystem": { "allowWrite": ["."] },
  "network": { "allowNetwork": false }
}
```

If the agent must install packages, allow only the hosts it needs (`network.allowedDomains`, for
example `pypi.org` and `files.pythonhosted.org`). With `readAccess: "policy"`, a command that needs
a system path it cannot read fails: grant that path in `filesystem.allowRead` rather than going back
to host-wide reads.

**5. Check it** as described above, from the chat.

Keep secrets out of that distribution: the model's API key, and for git a token scoped to the
repository — not your Windows credentials or SSH agent.
