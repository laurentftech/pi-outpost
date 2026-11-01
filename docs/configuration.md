# Configuration reference

[Home](../README.md) · [How-to](how-to.md)

- [Model credentials](#model-credentials)
- [Projects](#projects)
- [Settings from the browser](#settings-from-the-browser)
- [Configuration file](#configuration-file)

## Model credentials

For built-in providers, credentials come from either **provider environment variables**
(`ANTHROPIC_API_KEY`, …) or an **`auth.json` in the agent directory** —
`<agentDir>/auth.json`, which is `~/.pi/agent/auth.json` unless your configuration names its
own `agentDir`. A custom OpenAI-compatible provider, including its key, is stored separately
in `<agentDir>/models.json`.

| | |
|---|---|
| **The interface** | With no usable model, pi-outpost shows a setup screen instead of a chat that could only fail. Pasting a key for a built-in provider writes `<agentDir>/auth.json`; declaring your own endpoint writes the provider and its key to `<agentDir>/models.json`. Either takes effect immediately — no restart |
| **`pi-outpost login` / `logout`** | `pi-outpost login --provider openai` runs the provider's account sign-in when available; otherwise it prompts for an API key without echoing it. `echo "$KEY" \| pi-outpost login --provider anthropic` stores a piped key. `pi-outpost logout --provider openai` removes only credentials stored by this server. Secrets have no command-line flag because argv is visible to other processes |
| **Settings → Accounts** | View each provider's authentication state and source, sign in, enter an API key, or remove this server's stored credential. `credentialsLock: true` makes the panel read-only |
| **Environment** | `export ANTHROPIC_API_KEY=…` before starting. Nothing is written to disk |

When signing in to OpenAI from a browser on another computer, the browser may fail to open
`localhost:1455` after authorization. Copy the **full address** from that browser page and paste
it into Pi Outpost's authorization code field to finish signing in. That address contains a
temporary sign-in code; paste it only into Pi Outpost.

### An OpenAI-compatible endpoint of your own

A corporate gateway, vLLM, SGLang, Ollama, LM Studio — anything speaking the OpenAI API.
Declare it from the setup screen (name, base URL, key, model id) and it is written to
`<agentDir>/models.json` in pi's own format, so it survives restarts and any pi process
sharing that directory sees it.

The two **compatibility** checkboxes on that form are not a detail to skip. Many
OpenAI-compatible servers reject the `developer` role and the `reasoning_effort` field that
pi sends to reasoning-capable models — and when they do, *every* turn fails, with an error
that never names the cause. Unchecking them makes pi send a plain `system` message and drop
`reasoning_effort`.

### Behind a TLS-inspecting proxy

A corporate proxy that re-signs certificates with an internal CA makes Node reject the
chain, which surfaces as a bare `fetch failed`. Trust the CA and everything verifies:

```bash
export NODE_EXTRA_CA_CERTS=/path/to/corp-ca.pem
```

pi-outpost detects that failure and names this variable rather than leaving you to guess.
There is deliberately **no configuration key that disables TLS verification**: it would
disable it for every outbound connection — including the one carrying your API key — and a
flag in a file gets copied between machines and outlives the reason it was added.

## Projects

One server can hold several projects at once. Each has its own agent session, its own
sandbox, its own file tree and its own session history; the agent keeps working in the
projects you are not looking at.

- **Open one** from the project control in the header: browse the server's filesystem and
  pick a directory. It is usable straight away, and it is still there after a restart
- **Switch** without a reload. A turn running in the project you leave runs to completion,
  and its result is waiting when you come back. Unsent composer text is kept per project
- **See what is happening elsewhere**: every project reports whether it is stopped, starting,
  idle, working, waiting for you, or ready for review. Waiting means the agent needs an answer;
  ready for review means its authoritative Work Plan has no unfinished task and at least one
  task awaiting review. Both raise the selector's attention badge. When the window is in the
  background, a browser notification names the project and the kind of attention without
  exposing its plan or workspace content. Nothing ever interrupts the project you are looking
  at, and merely selecting it does not acknowledge either state
- **Close one** to release its resources; the sessions on disk stay, so reopening the same
  directory finds them again. Closing is refused while its agent is running a turn, and the
  last remaining project cannot be closed
- Projects that nobody is using are retired after `workspaceIdleTimeoutMs` (30 minutes by
  default, `0` disables it) and rebuilt transparently on next use. A project running a turn,
  waiting for you, or ready for review is never retired
- **Switching shows a project's files at once.** Starting a project's agent is the slow part —
  seconds, more on Windows — so its file tree, files, git and terminal are there immediately,
  with "Starting the agent…" where the conversation will be. A message sent meanwhile is
  handled when the agent is up. Click several projects in a row and you land on the last
- **Start a side session** with the **+** on a project's row: a second agent on the same
  project, in a fresh conversation on the model the project is using, running at the same
  time as the first — for a quick question or fix while a long task works. It is listed under its project, named after its
  conversation, and closed like a project; its conversation stays in the project's history.
  Both agents work in the same directory with the same sandbox, and nothing keeps their edits
  apart. A conversation is open in one session at a time, Settings applied to a project wait
  for its other sessions' turns and then reach all of them, and side sessions are not reopened
  after a restart

A configuration where no project has ever been opened behaves exactly as a single-project
server: `cwd` alone. `"workspaceLock": true` pins the server to one project and removes the
open/switch/close controls — and side sessions — entirely.

The browser tab is titled with the project shown, and the side session when it is one
(`pi-outpost · fix typo — pi`), so several tabs on one server can be told apart.

## Settings from the browser

The gear menu changes what the agent may do, without editing a file or restarting the
server. Accepted changes are written to the configuration file that is loaded and applied to
a fresh agent session immediately.

**Restart session** is also available with no pending settings and without a sandbox.
It starts a fresh conversation and reloads extensions and MCP connections without changing
the configuration file; the previous conversation stays in the session history. A busy
session must finish first, and an extension can refuse the restart. This is separate from
**Restart pi-outpost**, which restarts the server.

**Credits**, at the bottom of Settings, shows the project website and open-source
acknowledgements. **Third-party notices** opens their full license texts locally.
Returning to Settings preserves pending edits.

| What | Notes |
|---|---|
| Sandbox root and writable root | Browse the server's directories and pick one — no need to know the host's paths by heart |
| Write and bash permissions | The same switches as `sandbox.allowWrite` / `sandbox.allowBash` |
| Agent resources | **Manage agent resources** opens one repository-first view for skills and extensions |
| Local folders | **Add local folder…** stores skill roots under `userSkillPaths` and extension roots under `userExtensionPaths` |
| Git repositories | **Add Git repository…** asks for the repository address and an editable local clone folder, then lists its skills grouped by folder, **all off**: turn skills on one by one or with **All on** / **All off**, then **Save**; later changes take effect with **Apply**. Extension roots are selected as before |
| Removing a repository | **Remove repository** unregisters it as a whole and, for a clone pi-outpost manages, deletes it from disk after a confirmation. Files you pointed it at elsewhere are kept |

Two lists, deliberately: what the **configuration file** declares (`skillPaths`,
`extensionPaths`) belongs to the deployment, and the interface can neither rewrite nor
remove it. What is added from Settings lives under its own key, and is the only thing the
interface offers to remove.

A deployment can forbid any of it: `sandboxLocks` locks individual sandbox fields,
`extensionLock` forbids extension-path changes (skill paths stay editable — loading code is
not the same act as pointing the agent at more text to read). What is locked is refused by
the server, not merely hidden by the interface. The enrollment warning is a browser-side
acknowledgement, not an authorization boundary; deployments that must forbid extension
activation should set `extensionLock`. Update confirmation is revision-bound and enforced
again by the server.

If the file cannot be written, nothing is applied and the session in front of you is left
exactly as it was.

The suggested clone location is `<user config dir>/resource-repositories/<name>-<hash>`;
you may replace it with any local folder whose parent already exists. A preview recognizes
skills at the repository root, `skills/`, or `.agents/skills/`, and extensions under
`extensions/`, `.pi/extensions/`, or `.agents/extensions/`. Previewing reads metadata only:
it does not import extension code. Removing an activated resource path only updates the
configuration and reloads the agent — it never deletes the cloned repository.

Repositories are checked and updated conservatively. Only a clean branch strictly behind
its configured upstream can be fast-forwarded. Dirty, detached, ahead, diverged, and
upstream-less repositories explain why they are blocked; resolve local Git state in an
external terminal and check again. The updater never commits, stashes, discards, rebases,
pushes, switches branches, initializes submodules, or runs repository hooks. Updating a
repository containing extensions requires confirmation of the exact revisions, and
`extensionLock` blocks the whole mixed repository from updating. If Git advances but one
workspace cannot reload, the repository remains advanced and the dialog reports the
per-workspace reload failure. A repository of skills alone is reloaded for real; one that
supplies an **extension** is not — a running server cannot load an extension's new code, so
the update says its code runs after a restart, and the repository joins what
**Restart pi-outpost** in Settings runs.

Clone and fetch are non-interactive: existing credential helpers, SSH agents, and other
non-prompting Git authentication continue to work, but the server never opens a terminal or
askpass prompt. Credential-bearing addresses are redacted from browser errors and stored
origins. An RPC runtime may omit skill paths and does not currently inventory extensions;
those resources remain visible under **Provenance unavailable** and cannot be Git-managed
until the runtime reports filesystem provenance.

## Configuration file

The server reads the **first** of these that exists, and only that one — configurations are
never merged, so the file you are reading is the configuration that is running:

1. `--config <path>`
2. `--profile <name>` → `<user config dir>/profiles/<name>.json`
3. `$PI_OUTPOST_CONFIG`
4. `$PI_OUTPOST_PROFILE` → `<user config dir>/profiles/<name>.json`
5. `./pi-outpost.config.json` (the directory you launch from)
6. `<user config dir>/config.json`

`<user config dir>` is `$XDG_CONFIG_HOME/pi-outpost`, or `~/.config/pi-outpost`. A file you
name explicitly must exist; the two implicit locations are simply skipped. Found nothing? The
server refuses to start and tells you to run `pi-outpost init`.

**Profiles.** `--profile work` (or `$PI_OUTPOST_PROFILE`) reads
`<user config dir>/profiles/work.json`. A profile is an ordinary configuration file — same
keys, same rules — so `pi-outpost --profile work` from anywhere gives you the setup you
configured once.

**Precedence.** For any setting that appears in more than one place: **flag > environment
variable > file > default** — except the fields you can change from Settings, where what you
applied wins and persists. Environment variables: `PI_OUTPOST_PORT` (falling back to `PORT`,
which platforms inject), `PI_OUTPOST_HOST`, `PI_OUTPOST_CWD`, `PI_OUTPOST_AGENT_DIR`,
`PI_OUTPOST_TOKEN`, `PI_OFFLINE`.

One exception, and it is deliberate: **a sandbox that grants write or bash but names no
`sandbox.root` refuses a `--cwd`/`PI_OUTPOST_CWD` override.** Such a sandbox falls back to
`cwd`, so an inherited variable (a shell profile, a CI job, a compose file) could otherwise
turn "write inside my project" into "write inside `/`" without touching the file that
granted it. Name the root, and the grant says what it covers.

Relative paths are resolved against the configuration file's directory. A larger example lives
in [`pi-outpost.config.example.json`](../pi-outpost.config.example.json).

### Workspace and sandbox

| Key | Effect |
|-----|--------|
| `cwd` | Agent working directory, and the default project |
| `agentDir` | Own config dir (auth, models, settings, sessions) — fully separate from `~/.pi/agent`. It starts with **no credentials**: see [Model credentials](#model-credentials). Exported as `PI_CODING_AGENT_DIR` for extensions that look it up themselves; the terminal panel keeps yours |
| `sandbox` | Absent: the [default sandbox](sandboxing.md#the-default) — the project, writable, and a shell confined by the runner the server picks (`"bashRunner": "auto"`). `false`: no sandbox at all |
| `sandbox.root` | Read-only zone: read/ls/grep/find are confined to this directory, symlinks resolved — plus, read-only, the directories of the skills the session loaded. Defaults to `cwd`. Applies to the `cwd` project; every other open project is confined to its own directory |
| `sandbox.allowWrite` | Adds edit/write, confined to `sandbox.writableRoot` (default `false`). Never inside a `.pi` directory, which holds the configuration that confines the agent — see [docs/sandboxing.md](sandboxing.md#what-is-confined) |
| `sandbox.writableRoot` | Read-write zone: a subdirectory of `root` that edit/write are further confined to. Defaults to `root` itself. Ignored while `allowWrite` is false, and applies to the `cwd` project only: every other open project is writable in its whole directory |
| `sandbox.allowBash` | Adds bash — **not path-confined** unless `bashRunner` or `bashFrom` confines it (default `false` in a section you write; on in the default sandbox) |
| `sandbox.bashRunner` | `"auto"`: the server picks this machine's runner and uses it once its check passes, refusing every command otherwise — see [the default](sandboxing.md#the-default). `"none"`: the shell runs unconfined. Otherwise, runs every command of pi-outpost's own `bash` inside a sandbox runner — MXC's `wxc-exec.exe` (Windows 11; `"mxc"` names the one installed with pi-outpost, see [MXC comes with pi-outpost](#mxc-comes-with-pi-outpost)), landstrip's binary (Linux), or — as an option on Linux, loosening Docker's profile — MXC's `lxc-exec` (`"mxc"` there; see [docs/sandboxing.md](sandboxing.md#linux-as-an-option-mxc)), or on Apple-silicon macOS MXC's `mxc-exec-mac` (`"mxc"`; see [docs/sandboxing.md](sandboxing.md#macos-on-apple-silicon-mxc)), or on any Mac `"seatbelt"`, macOS' own `sandbox-exec` (see [docs/sandboxing.md](sandboxing.md#macos-every-mac-seatbelt)) — with the policy of a confined terminal: reads in the root, writes in the writable zone, no keys. A missing or failing runner refuses each command, never runs it unconfined. Exclusive with `bashFrom`. See [docs/sandboxing.md](sandboxing.md#recommended-setup) |
| `sandbox.bashShell` | The shell `bashRunner` runs commands in (default `/bin/bash`). Required on Windows, where Git Bash cannot start in a sandbox: `powershell.exe` (the agent then gets a `powershell` tool instead of `bash`), or busybox-w32's `sh.exe` — a full path, or a bare name found on `PATH` |
| `sandbox.bashImage` | Experimental, Windows 11 with MXC: a Linux image (e.g. `buildpack-deps:bookworm-scm`) every command of the agent's `bash` runs in, through MXC's WSLC backend — a real bash, with only the root mounted (at `/mnt/c/…`). Needs MXC as `bashRunner` and no `bashShell`; the writable zone is the whole root. See [docs/sandboxing.md](sandboxing.md#a-real-bash-wslc-experimental) |
| `sandbox.allowedHosts` | With MXC (Windows 11, Linux with [its Docker flags](sandboxing.md#linux-as-an-option-mxc), or [Apple-silicon macOS](sandboxing.md#macos-on-apple-silicon-mxc)) or [Seatbelt](sandboxing.md#macos-every-mac-seatbelt) (any Mac): the only hosts the agent's shell may reach — names (`"registry.npmjs.org"`) or suffixes (`"*.githubusercontent.com"`). Outbound traffic is denied and a proxy the server runs is the only way out; any other host is refused with a reason naming it. Needs MXC or Seatbelt as `bashRunner` and no `bashImage`. Absent: the network is open. See [docs/sandboxing.md](sandboxing.md#the-network-only-named-hosts) |
| `sandbox.grants` | `"ask"` (default) or `"never"`. With a `bashRunner`, you are asked when a command connects to a host `allowedHosts` does not list (the connection waits for your answer), or when the agent needs a directory beyond the sandbox; allow it for that command or the rest of the session, or refuse. Only your click grants, and the agent directory and the configuration can never be granted. `"never"`: nobody is asked, the list alone decides. Settings do not edit it. See [docs/sandboxing.md](sandboxing.md#grants-beyond-the-sandbox-when-you-say-so) |
| `sandbox.bashFrom` | Hands bash to a sandboxing extension instead: its package source as pi lists it (`"npm:pi-landstrip"`) or the path of its file or directory. pi-outpost then supplies no `bash` of its own — which would otherwise shadow the extension's, since an application's tool wins over an extension's of the same name. The session refuses to start unless that extension registers `bash`, and a Settings change that would leave it without one is rolled back. Only while `allowBash` is on. See [Confining bash with an extension](#confining-bash-with-an-extension) |
| `sandboxLocks` | Which sandbox fields Settings may **not** change: `root`, `writableRoot`, `allowWrite`, `allowBash` |
| `workspaceLock` | Pin the server to one project: opening, closing and switching are refused, and no control is offered |
| `workspaceIdleTimeoutMs` | How long an unused project stays alive before it is retired (default `1800000` — 30 min; `0` never retires). A project running a turn, waiting for you, or ready for review is never retired |
| `openProjects` | The set of open projects. **Written by the server** when you open or close one — not hand-authored |
| `files.watch` | Watch the directories the file browser has listed, and those of the files being shown, so the tree and an open file or drawn diagram follow the workspace whoever changed it (default `true`). Set `false` where a watch is a liability — a network mount that emits no events, a spent inotify budget. The tree's ↻ control re-lists by hand either way |

### Confining bash with an extension

> **Installing a sandboxing extension is not enough.** Without `sandbox.bashFrom`, pi-outpost's own
> `bash` shadows the extension's confined one: the extension loads, reports its sandbox as on, and the
> agent's commands still run unconfined. pi-outpost warns when it sees this, in its log and in the
> browser. [docs/sandboxing.md](sandboxing.md) says what is and is not confined, and how to check it.

pi-outpost confines its file tools to the sandbox, but `bash` cannot be path-confined: once
`allowBash` is on, a command runs with everything the server's user can do. A sandboxing
extension such as [pi-landstrip](https://pi.dev/packages/pi-landstrip) supplies a `bash` that
runs inside an operating-system sandbox (seccomp on Linux) with its own file and network
policy. Install it with `pi install npm:pi-landstrip` (into the same agent directory the server
uses), then name it:

```json
{
  "sandbox": { "root": ".", "allowWrite": true, "allowBash": true, "bashFrom": "npm:pi-landstrip" }
}
```

Without `bashFrom`, the extension loads but its `bash` is shadowed by pi-outpost's own, and
commands run unconfined. With it, the session checks that the `bash` in place comes from that
extension and refuses to start otherwise, naming the `bash` it found. The extension's policy is
its own (pi-landstrip reads `~/.pi/agent/sandbox.json` and `.pi/sandbox.json`); pi-outpost does
not interpret it. The terminal panel, when enabled (`terminal.enabled`), is a separate shell that
no extension confines — unless `terminal.sandbox` names a sandbox runner, which then confines every
terminal to the sandbox (see [docs/sandboxing.md](sandboxing.md#recommended-setup)).
Otherwise leave it off where that matters, and lock it with `sandboxLocks.terminal`.

Without an extension, `sandbox.bashRunner` confines pi-outpost's own `bash` with the same runners as
the terminal: each command runs inside the runner, with the terminal's policy. On Windows 11 this is
the way that works today (MXC with Windows PowerShell, nothing to install); see
[docs/sandboxing.md](sandboxing.md#recommended-setup).

When a confined command needs one thing more — a host the allowlist does not name, a directory beside
the project — you are asked instead of widening the configuration: a connection to an unlisted host
waits while you decide, and a directory is asked for by the agent with the command that needs it. Allow
it for that command, for the session, or refuse. The
agent directory and the configuration can never be granted. See
[docs/sandboxing.md](sandboxing.md#grants-beyond-the-sandbox-when-you-say-so).

#### MXC comes with pi-outpost

MXC's executor (`wxc-exec.exe`, signed by Microsoft, MIT; on Linux `lxc-exec`; on Apple-silicon macOS `mxc-exec-mac`) ships in
[`@microsoft/mxc-sdk`](https://www.npmjs.com/package/@microsoft/mxc-sdk), which pi-outpost declares
as an **optional dependency**. In npm, *optional* does not mean *opt-in*: `npm install -g
pi-outpost`, `npx pi-outpost` and `npm ci` **install it by default**, with nothing to add. It only
means that an install which fails for that package does not fail pi-outpost's install, and that
`--omit=optional` (or `npm config set omit optional`) leaves it out. To use it, write the word
`"mxc"` instead of a path:

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

`"mxc"` resolves to the installed package's `wxc-exec.exe` for this machine's architecture
(`x64` or `arm64`). If it is not there, the server refuses to start and says so; reinstall
without `--omit=optional`:

```powershell
npm install -g pi-outpost --include=optional
```

The **standalone executable** has no `node_modules`: `"mxc"` looks for `wxc-exec.exe` **beside
`pi-outpost.exe`**. `pi-outpost build-exe` puts it there on Windows when the package is installed;
otherwise copy `node_modules\@microsoft\mxc-sdk\bin\x64\wxc-exec.exe` (`arm64` on ARM) next to
the executable.
The package is about 100 MB and is installed on every platform, though only Windows uses it; an
install that must stay small can omit it and name no `"mxc"`.

### Agent resources

| Key | Effect |
|-----|--------|
| `agentRuntime` | `{ "mode": "embedded" }` (default) keeps the pi SDK session in this process; `{ "mode": "rpc", "executable": "pi", "args": [] }` supervises a `pi --mode rpc` child. See [Agent runtimes](#agent-runtimes) |
| `agentRuntime.startupTimeoutMs` / `commandTimeoutMs` / `shutdownGraceMs` | RPC child startup, per-command and graceful-shutdown ceilings. Defaults: `60000`, `300000` and `5000` ms |
| `tools` | Tool allowlist when no sandbox is configured, e.g. `["read","grep","find","ls"]` |
| `noExtensions` / `extensionPaths` / `extensionScripts` | Disable extension discovery, or name extension files and directories the deployment loads |
| `userExtensionPaths` | Extension directories added from Settings. Written by the server; `extensionPaths` stays yours |
| `extensionLock` | Forbid adding or removing extension paths from Settings |
| `credentialsLock` | Forbid credential changes from the browser; provider states remain visible and CLI login/logout remain available |
| `noSkills` / `skillPaths` | Disable skill discovery, or name skill files and directories. `skillPaths` loads even under `noSkills`. Disabling matters for real isolation: skills otherwise also load from `~/.agents/skills` and from `.agents/skills` walked up from `cwd`, neither of which `agentDir` scopes |
| `userSkillPaths` | Skill directories added from Settings, loaded after `skillPaths` |
| `userSkillCollections` | Git repositories added as skill collections: `[{ "path", "managed", "enabledSkills": ["folder/skill", …] }]`. Only the listed skill directories load, after `userSkillPaths`. Written by the server |
| `noPromptTemplates` / `promptPaths` | Same for prompt templates (`agentDir` and the project's `cwd/.pi/prompts`) |
| `allowedModels` | Restrict the models sessions run on to these `{ "provider", "id" }` pairs: the switcher offers only them, a session starting on another model (the agent directory's default) is moved to the first, and a client asking for another is refused. Without it, every built-in model whose provider has auth is listed — often more variants than a deployment actually serves |
| `blockedCommands` | Slash commands users may neither see nor run: globs over the command's name, without the slash (`["setup*", "skill:internal-*"]`), matched regardless of case. A blocked command is left out of the composer's list, and a prompt invoking it anyway is refused by the server with a message that does not name it. The extension that registered it stays loaded — its hooks, tools and other commands carry on |
| `allowedCommands` | When set, the only slash commands offered and run; `blockedCommands` still wins. A message that only begins with a slash — `/tmp is full` — is still sent as a message |
| `thinkingLevels` | Declare what thinking levels a model accepts, for one the runtime cannot describe. See [Thinking levels](#thinking-levels) |
| `systemPrompt` / `systemPromptFile` | Replace pi's built-in system prompt entirely (mutually exclusive). Project context files, skills and `appendSystemPrompt` still layer on top |
| `appendSystemPrompt` | Extra paragraphs appended after the system prompt |
| `webContext` | Tell the agent its replies render in this interface — markdown, inline images, file links (default `true`) |
| `offline` | Never fetch remote model catalogs. On a host that cannot reach them, that request hangs and stalls every credential change by 20 s. Built-in and `models.json` providers are unaffected. `--offline` and `PI_OFFLINE` also turn it on |

### Documents

| Key | Effect |
|-----|--------|
| `pdf.maxBytes` | Largest PDF the viewer may load and `pdf_extract` may read (default `26214400` — 25 MB). Images shown inline (PNG, JPEG, GIF, WebP, SVG, AVIF) share this limit; every other file keeps the 1 MB limit |
| `docx.maxBytes` / `xlsx.maxBytes` / `pptx.maxBytes` | The same ceiling, per format, for the Office extractors |
| `mail.maxBytes` | The same ceiling for `mail_extract` (default `26214400` — 25 MB). A message carrying a deck is the size of the deck; what bounds one *call* is the body cap in the tool, since an attachment costs a path rather than its bytes |
| `docx.template` | The Word template (`.dotx` or `.docx`) the viewer's Word export can write into, relative to the configuration file. A file that is missing or unusable is reported when the export is used, not at startup |
| `office.renderer` | Which application `pptx_render` and `docx_render` draw with: `"auto"` (default — on Windows PowerPoint for decks and Word for documents, then LibreOffice, then ONLYOFFICE), `"powerpoint"`, `"word"`, `"libreoffice"` or `"onlyoffice"`. `"powerpoint"` and `"word"` each apply to their own kind of file; the other kind is drawn as with `"auto"` |
| `office.libreofficePath` / `office.onlyofficePath` | The `soffice` or `docbuilder` executable, when it is not where it installs by default. Relative to the configuration file |
| `office.renderTimeoutMs` | How long one rendering, or one `docx_compare` comparison, may take (default `120000`) |
| `pptx.renderer`, `pptx.libreofficePath`, `pptx.onlyofficePath`, `pptx.renderTimeoutMs` | Deprecated since 0.30: the 0.29 names of the `office.*` keys above. Still read, each named in a warning at startup; when both are set, the `office.*` key wins and the conflict is logged |
| `structuredExchange.maxBytes` | Largest structured-exchange document the viewer may open (default `8000000`, the widest ceiling any supported schema version declares). Each version's own ceiling is applied after the document says which one it claims, so a version 1 document is still bounded at its published 4 MB. Recognition is by the document's declared `schema`, never by its extension, so other JSON keeps the 1 MB preview limit. A larger value is clamped to the contract's |

### Server and interface

| Key | Effect |
|-----|--------|
| `server.port` | Port to listen on (default `3141`). `--port` and `PI_OUTPOST_PORT`/`PORT` override it |
| `server.host` | Address to bind (default `127.0.0.1` — only change this if you have read the security note above) |
| `server.allowedOrigins` | Extra exact Origins accepted on the WebSocket, and given CORS headers on the HTTP endpoints |
| `server.token` | Shared secret required on the WebSocket, `/branding`, `/files/raw` and `/files/docx-template` (`PI_OUTPOST_TOKEN` overrides). Mandatory in practice off loopback |
| `openBrowser` | Whether starting the server opens the interface (default: wherever a desktop session exists) |
| `openIn` | `"window"` (its own window, the default) or `"browser"` (a tab). `openBrowser` still decides *whether* |
| `branding` | `title` (default `"π"`), `welcome` message, `accentColor` |
| `branding.defaultTheme` | `"light"` \| `"dark"` \| `"system"` (default), used when the client has no stored preference |
| `branding.allowThemeToggle` | Show the theme toggle (default `true`). Set `false` when a host app drives the theme |
| `terminal.enabled` | Enable integrated interactive web terminal (default `false` — explicit opt-in only). See [Integrated Terminal](features.md#integrated-terminal) |
| `terminal.shell` | Path to the shell executable (default: PowerShell -> cmd on Windows; `$SHELL` -> `/bin/zsh` -> `/bin/bash` on Unix) |
| `terminal.shellArgs` | Arguments passed to the shell (default: `["-l"]` on Unix login shells) |
| `terminal.sandbox` | Path to a sandbox runner (landstrip's binary, or MXC's `wxc-exec.exe` on Windows 11, `lxc-exec` on Linux or `mxc-exec-mac` on Apple-silicon macOS, or `"seatbelt"` for macOS' own `sandbox-exec` on any Mac — `"mxc"` names the one installed with pi-outpost, see [MXC comes with pi-outpost](#mxc-comes-with-pi-outpost)) every terminal runs inside, confined to the sandbox root, with no keys in its environment. A missing or failing runner means no terminal, never an unconfined one. See [docs/sandboxing.md](sandboxing.md#recommended-setup) |
| `embed.workspaceControls` | What a mounted widget offers: `"settings"` (default, one project), `"root"` (a compact root chooser), `"projects"` (open/switch/close) |
| `updateCheck` / `updateRegistry` / `changelogNotice` | See [Staying up to date](deployment.md#staying-up-to-date) |
| `gitPath` | Path to the git executable. Unset, git is found on `PATH` and then where installers put it. See [Git](#git) |


Drag the terminal’s top border up or down to adjust its height; the browser remembers the setting. The focused border also accepts Up/Down and Home. Maximizing then restoring keeps the chosen height.

Choose an installed shell beside the terminal’s `+` button before opening a new tab. Existing tabs keep their shell. On Windows, PowerShell is the default unless `terminal.shell` is configured; Git Bash is offered only without terminal confinement. `Ctrl+C` copies selected output, or interrupts the command when nothing is selected. `Ctrl+V` and `Ctrl+Shift+V` paste into the terminal (`Cmd+C/V` on macOS). After a connection loss, open terminals start a new shell session and say so in their buffer; previous running processes are not resumed.

### Git

Git features need a git to run. It is looked for in this order:

1. `gitPath`, when the configuration names one
2. `git`, as `PATH` resolves it
3. The standard install locations — `C:\Program Files\Git\cmd\git.exe` and friends on
   Windows, `/usr/bin/git` and the Homebrew and Xcode paths on macOS, `/usr/bin/git` and
   `/usr/local/bin/git` on Linux

The third step exists because git is routinely installed and absent from the `PATH` a
server process inherits — a Windows machine where VS Code shows git perfectly while a
service launched from a shortcut cannot find it at all.

A `gitPath` that is not a runnable git fails startup, naming it. It never falls back to
another git: naming an executable is an instruction, and quietly running a different one
would answer questions about the wrong installation.

The git state follows changes made anywhere — a commit, checkout or reset from a terminal or
another tool updates the badges, the branch, the change gutter and an open commit map within
a moment, though
only the repository's own directory moved.

When git features are missing, **Settings says why**: the executable could not be run, this
project is not in a repository, or git refused it — with git's own message, which for the
common "detected dubious ownership" names both the directory and the remedy.

### Thinking levels

The thinking-level control offers only the levels the current model accepts — which the
runtime normally reports. For a model declared against your own endpoint it cannot: the
SDK does not recognise the name, the control falls back to offering everything, and a
model that cannot think at all gets a slider that goes to `xhigh` and snaps back.

Declare the answer instead:

```json
{
  "thinkingLevels": [
    { "provider": "maison", "levels": ["off"] },
    { "provider": "maison", "id": "big", "levels": ["off", "low", "medium"] }
  ]
}
```

An entry without `id` covers every model of that provider; where both could apply, the one
naming the model wins. Levels are normalised as a runtime-reported list is — unknown names
dropped, canonical order, `off` always available — and an entry naming no usable level
fails startup rather than leaving a model nothing can be asked of.

A declaration is **authoritative**: it replaces what the runtime reports, because the
setting exists precisely for the models the runtime is guessing about. A `set_thinking`
naming a level outside a declared set is refused rather than forwarded, whichever client
sends it.

Changing the model **settles** the level on the new model's scale: a session on `high`
moving to a model that stops at `low` lands on `low`, and one moving to a model that
accepts no thinking lands on `off` — never a step up, which would spend more effort than
was asked for. The interface is told what it settled at, so it cannot go on showing a
level the agent is not using. A model with a single accepted level says so in the control
rather than offering a slider with nowhere to go.

### Theming

Light and dark themes ship with the interface. Precedence: a local pick from the toggle
(persisted in `localStorage`) or an explicit override (the embed widget's `theme` option or
`setTheme()`, or a host page's `postMessage`) beats `branding.defaultTheme`, which falls
back to the OS preference.

The header's theme menu offers **Light**, **Dark** and **System**. System follows OS
color-scheme changes immediately; the browser remembers the selected preference.

### Agent runtimes

`agentRuntime.mode` decides what actually runs the agent. `embedded` (the default) keeps a
pi SDK session inside this process. `rpc` supervises a `pi --mode rpc` child — to match an
existing pi installation, or to isolate a crash.

With extensions enabled, the embedded session loads Pi's built-in `codemode`, `tool_search`
and MCP extensions too. Their activation follows Pi's settings and MCP configuration: add
`"defaultTools": ["+codemode", "+tool_search"]` to `~/.pi/agent/settings.json` to switch them
on. That setting is honoured with a sandbox too, for every tool except Pi's own built-ins —
the sandbox supplies its confined `read`/`write`/`edit`/… and a setting cannot bring back the
unconfined ones (a sandbox without `allowBash` stays without `bash`). A `tools` list in this
server's config replaces `defaultTools` entirely, so name `codemode` and `tool_search` there
if you use one.

The `codemode` card starts compact. Expand it to see the script, its nested calls
and their result, including while it is running. They remain in that card after
reloading the conversation.

**The embedded SDK runtime is the supported target; `rpc` is best effort.** Features are
designed, measured and proven against the SDK session. The RPC dialect gets what it can
express: where a capability has no equivalent there, it is reported as unavailable rather
than faked, and a feature may land for `embedded` first — or only. That is a deliberate
priority, not an oversight, and the list below is what it costs today.

pi-outpost appends `--mode rpc` and derives `--session-dir` itself, so `args` may contain
neither, nor `--tools`/`--system-prompt` (those come from `tools`/`systemPrompt`), nor any
flag that would make the child print something and exit. The rest of the configuration
travels to the child, and pi-outpost's own tools go with it, so the same file describes the
same agent either way.

Two things to know before switching: **`sandbox` cannot be combined with `rpc`** and the
pair is refused at load — the sandbox is a replacement toolset this server builds, and a
child builds its own; isolate it with a container or a dedicated user instead. And a few
features have no RPC equivalent and say so rather than failing quietly: storing credentials,
declaring a provider, changing the sandbox from Settings, tree navigation, and editing a
past message. Sessions are not auto-titled there either.

The child can be a Pi-derived agent rather than pi itself. [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent)
runs with `"executable": "prime-agent"` (or its source launcher, `prime-agent.sh`). Its
conversation tree is shown as one linear branch. Its only built-in tool is `ipython`, so a
`tools` list naming `read`, `write`, `grep`, `find` or `ls` is refused at startup. Its
schedules, heartbeats and agent-to-agent messages have no control in the interface. It
executes model-generated Python with your permissions and is not a sandbox either.
