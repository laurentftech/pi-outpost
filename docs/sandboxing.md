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
- [The agent cannot rewrite what confines it](#the-agent-cannot-rewrite-what-confines-it)
- [Several projects open at once](#several-projects-open-at-once)
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
  `bashFrom`) can write anywhere the server's user can. pi-landstrip's denies writing
  `.pi/sandbox.json` by default; add the rest of the directory to its policy:
  `"filesystem": { "denyWrite": [".pi/**"] }`.
- **The extension's own view of file tools.** With `"toolFilesystemPolicy": "sandbox"` in
  `landstrip.json`, pi-landstrip also checks `read`, `write` and `edit` against its file policy — a
  second opinion on pi-outpost's tools of those names. It does not know pi-outpost's other tools,
  which the rule above covers.

## Several projects open at once

One server, one installation of the extension, loaded into **each project's session**:

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
