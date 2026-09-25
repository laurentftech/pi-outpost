# How-to

Short recipes for the things people actually set out to do. Each one is
self-contained: the configuration it needs, the command that proves it works, and the
caution that goes with it. The [README](../README.md) has the reference — every key,
every flag.

- [Let the agent write in one folder only](#let-the-agent-write-in-one-folder-only)
- [Give the agent a shell](#give-the-agent-a-shell)
- [Work on several projects at once](#work-on-several-projects-at-once)
- [Use a local or self-hosted model](#use-a-local-or-self-hosted-model)
- [Reach it from your phone or another machine](#reach-it-from-your-phone-or-another-machine)
- [Run it permanently on a Linux server](#run-it-permanently-on-a-linux-server)
- [Keep several setups side by side](#keep-several-setups-side-by-side)
- [Hand it to someone who has no Node](#hand-it-to-someone-who-has-no-node)
- [Teach the agent something](#teach-the-agent-something)
- [Restrict which models can be picked](#restrict-which-models-can-be-picked)
- [Let the agent read a big PDF, Word or Excel file](#let-the-agent-read-a-big-pdf-word-or-excel-file)
- [Make a PowerPoint deck from a template](#make-a-powerpoint-deck-from-a-template)
- [Lock down a shared deployment](#lock-down-a-shared-deployment)
- [Put it inside your own web app](#put-it-inside-your-own-web-app)
- [Use an existing pi installation](#use-an-existing-pi-installation)
- [When something does not work](#when-something-does-not-work)

## Let the agent write in one folder only

The most common shape: it reads your whole project, and may only change one part of
it.

```json
{
  "cwd": "/home/me/projects/site",
  "sandbox": {
    "root": "/home/me/projects/site",
    "allowWrite": true,
    "writableRoot": "/home/me/projects/site/src",
    "allowBash": false
  }
}
```

`root` is what it can read (symlinks resolved, nothing above it reachable);
`writableRoot` is the only place `edit` and `write` may touch. In the file browser,
everything outside the writable zone is dimmed, so you can see the boundary rather
than discover it.

Check it took effect: `pi-outpost config` prints the sandbox it resolved, and every
start logs it too.

## Give the agent a shell

```json
{ "sandbox": { "root": "/home/me/projects/site", "allowWrite": true, "allowBash": true } }
```

Be deliberate about this one. **Bash cannot be path-confined**: `allowBash` gives the
agent everything the account running the server can do, inside the sandbox or not.
Where that matters, run pi-outpost as a dedicated user, or in a container, and treat
the sandbox as being that boundary rather than the `sandbox` key.

To grant it for yourself while preventing anyone from turning it on from the browser:

```json
{ "sandboxLocks": { "allowBash": true } }
```

A lock is refused by the server, not merely hidden by the interface.

## Work on several projects at once

Nothing to configure. The project control in the header opens one: browse the
server's directories, pick it, and it is usable immediately — the set survives
restarts.

Each project gets its own agent, sandbox, file tree and session history. Its sandbox
is its own directory, with the permissions of the configured `sandbox` — write, bash —
but not its `root` or `writableRoot`, which belong to the `cwd` project. With several
projects open, Settings accordingly shows **Agent permissions** and the folder the
project is confined to, not a root to edit; a permission applied there takes effect in
that project at once and in projects opened after. Switching
never disturbs the others: a turn you leave running finishes, and its result is
waiting when you come back. The selector distinguishes stopped, starting, idle,
working, waiting for you, and ready for review. Waiting means the agent needs an
answer. Ready for review is derived from its persisted Work Plan: every task is done
or awaiting review, and at least one awaits review. It is not inferred merely because
a turn ended.

Both actionable states raise the existing attention count. If the browser tab is in
the background, the notification names the project and whether it needs an answer or
is ready for review, but never includes plan or workspace content. Switching to the
project does not clear the state; acknowledge the result in the conversation, or ask
for meaningful follow-up work.

For a small side action while a long task runs — a question about the code, a quick
fix — use the **+** on the project's row to start a **side session**: a second agent on
the same project, in a fresh conversation on the model the project is using, working at
the same time. It sits under its
project in the selector and is closed the same way. It shares the project's directory,
sandbox and resources, like a second terminal on the same repository: nothing keeps the
two agents' edits apart, so give them separate files. A conversation can be open in only
one session at a time — the session list says where it is — and a side session nobody has
used for the idle period is closed rather than retired, its conversation kept. Settings
applied from any session reach every session of the project, and wait while another of
them is running a turn.

Use **Outcome** in the header to review the selected project's recorded result without
reconstructing it from the conversation. It shows Work Plan progress, explicit evidence, and
changed files for that project only. A partial repository read or missing verification stays
visible as partial, unavailable, or not recorded; it is never upgraded to success. Task and file
entries open their existing detail views. Switching projects closes the drawer and discards the
old project's response; reopening Outcome asks the project now selected.

Two knobs, if the defaults do not suit:

```json
{
  "workspaceIdleTimeoutMs": 1800000,
  "workspaceLock": false
}
```

`workspaceIdleTimeoutMs` is how long an unused project stays alive before it is
retired and rebuilt on next use (`0` never retires; a project running a turn is never
retired). Waiting and ready-for-review projects are retained too. `workspaceLock: true`
pins the server to one project and removes the controls entirely. Use it for a deployment,
embedded or standalone, whose project root must not change.

## Use a local or self-hosted model

Ollama, LM Studio, vLLM, SGLang, a corporate gateway — anything speaking the OpenAI
API.

**If pi-outpost has no usable model yet** (a fresh `agentDir`, no provider environment
variable), it shows the setup screen: pick the *OpenAI-compatible endpoint* tab and
fill in a name, the base URL, a key and one model id.

| Server | Base URL | Key |
|---|---|---|
| Ollama | `http://127.0.0.1:11434/v1` | anything non-empty |
| LM Studio | `http://127.0.0.1:1234/v1` | anything non-empty |
| vLLM / SGLang | `http://host:8000/v1` | whatever it was started with |

If every turn then fails with an error that names nothing useful, untick the two
**compatibility** boxes: many such servers reject the `developer` role and the
`reasoning_effort` field pi sends to reasoning-capable models.

**If you already have a working provider**, the setup screen does not come back — it
only appears when no model can answer. Write the endpoint into
`<agentDir>/models.json` yourself, which is the same file the screen writes:

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://127.0.0.1:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "compat": { "supportsDeveloperRole": false, "supportsReasoningEffort": false },
      "models": [{ "id": "qwen3:14b" }]
    }
  }
}
```

That file holds a key: keep it readable by you alone (`chmod 600`). Restart, and the
model appears in the switcher.

On a machine that cannot reach the public model catalogs, add `"offline": true` —
otherwise every credential change waits 20 s for a fetch that will never arrive.
Locally declared models are unaffected.

## Reach it from your phone or another machine

Three security decisions, and all three are needed. The example also spells out the default
port because the same value appears in the allowed origin and browser URL:

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 3141,
    "token": "…",
    "allowedOrigins": ["http://192.168.1.10:3141"]
  }
}
```

1. **`host`** off `127.0.0.1`, and **`port`** names the port used below. `3141` is the
   default, but spelling it out keeps the listen address and browser origin visibly aligned.
   The server refuses to bind off loopback without a
   token, so this alone will not start.
2. **`token`** — a long random secret, `openssl rand -hex 32`. Prefer the
   `PI_OUTPOST_TOKEN` environment variable, which overrides the file and keeps the
   secret out of it. There is no `--token` flag on purpose: argv is readable by anyone
   who can list processes.
3. **`allowedOrigins`** with the exact origin *you will type in the browser*. Only
   `localhost` and `127.0.0.1` are trusted automatically, so a connection from
   `http://192.168.1.10:3141` is rejected as a forbidden origin until you list it.

Then open `http://192.168.1.10:3141/?token=<secret>` once. The token is stored locally
and stripped from the URL.

There is no transport encryption here: put it behind a reverse proxy with TLS, or on a
Tailscale network, before it crosses anything you do not control. And remember what
you are exposing — an agent that can read your files, and write or run commands if you
granted it that.

## Run it permanently on a Linux server

Install the package, locate the installed binary, and create a dedicated identity and
directories. The paths below are examples; use the home and binary paths chosen by your
distribution and npm installation.

```bash
npm install -g pi-outpost
command -v pi-outpost             # use this exact path in ExecStart below
sudo useradd --system --create-home --shell /usr/sbin/nologin pi-outpost
sudo install -d -o pi-outpost -g pi-outpost /etc/pi-outpost
sudo install -d -o pi-outpost -g pi-outpost /var/lib/pi-outpost/agent
sudo install -d -o pi-outpost -g pi-outpost /srv/pi-outpost/workspace
```

Create `/etc/pi-outpost/config.json`, owned by `pi-outpost`, so the setup commands and the
service deliberately use the same configuration and agent directory:

```json
{
  "cwd": "/srv/pi-outpost/workspace",
  "agentDir": "/var/lib/pi-outpost/agent",
  "sandbox": {
    "root": "/srv/pi-outpost/workspace",
    "allowWrite": false,
    "allowBash": false
  },
  "server": { "host": "127.0.0.1", "port": 3141 }
}
```

Then apply the promised ownership and permissions:

```bash
sudo chown pi-outpost:pi-outpost /etc/pi-outpost/config.json
sudo chmod 600 /etc/pi-outpost/config.json
```

Store the model credential as the service identity. Replace `/usr/local/bin/pi-outpost` with
the path printed by `command -v`:

```bash
sudo -u pi-outpost env PI_OUTPOST_CONFIG=/etc/pi-outpost/config.json \
  /usr/local/bin/pi-outpost login --provider anthropic
```

Generate a token with `openssl rand -hex 32`. Create `/etc/pi-outpost/environment`, put a
single `PI_OUTPOST_TOKEN=<paste the generated hex value>` line in it, and make it readable
only by root:

```bash
openssl rand -hex 32
sudo touch /etc/pi-outpost/environment
sudo chown root:root /etc/pi-outpost/environment
sudo chmod 600 /etc/pi-outpost/environment
sudoedit /etc/pi-outpost/environment
```

Then create `/etc/systemd/system/pi-outpost.service`:

```ini
[Unit]
Description=pi-outpost
After=network-online.target

[Service]
User=pi-outpost
Environment=PI_OUTPOST_CONFIG=/etc/pi-outpost/config.json
EnvironmentFile=/etc/pi-outpost/environment
ExecStart=/usr/local/bin/pi-outpost --no-open
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

The system manager reads the environment file, so it can remain owned by root with mode
`0600`; do not put the token directly in the world-readable unit. A headless host opens no
browser anyway — pi-outpost only opens one where a desktop session exists — but `--no-open`
says so explicitly.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now pi-outpost
sudo systemctl status pi-outpost
```

From a checkout rather than a package, `npm run start` is the equivalent single
command: it builds the interface once and serves everything from one process.

## Keep several setups side by side

A profile is an ordinary configuration file living in
`~/.config/pi-outpost/profiles/`:

```bash
mkdir -p ~/.config/pi-outpost/profiles
cp pi-outpost.config.json ~/.config/pi-outpost/profiles/work.json
pi-outpost --profile work     # from anywhere
```

`$PI_OUTPOST_PROFILE` does the same without the flag. Give each profile its own
`server.port` if you want two running at once, and its own `agentDir` if their
sessions and credentials should not mix.

## Hand it to someone who has no Node

Download the executable for their platform from
[Releases](https://github.com/laurentftech/pi-outpost/releases) — server and interface
are inside it, nothing to install. On macOS and Linux it needs `chmod +x` first, since a
release download carries no execute bit. It is unsigned, so macOS blocks a fresh download
outright and Windows SmartScreen warns on first launch;
[`sea-packaging.md`](sea-packaging.md) covers clearing both, and building one yourself
with `pi-outpost build-exe`.

Ship a configuration file beside it (`pi-outpost.config.json` in the directory they
launch from) so they never see a start that refuses. Double-clicked, it opens the
interface in a window of its own; if it fails before listening, the window waits for a
keypress instead of vanishing with the message.

Tell them to install it from the browser too: the interface declares itself as an app,
so it lands in the dock or taskbar with its own icon and opens without an address bar.

## Teach the agent something

| What | Where | Loaded from |
|---|---|---|
| Skills | `skillPaths`, or the Settings menu | Files or directories; `skillPaths` loads even under `noSkills` |
| Prompt templates | `promptPaths`, plus what is auto-discovered from `agentDir` and the project's `cwd/.pi/prompts` | Available as `/` commands in the composer |
| Extensions | `extensionPaths`, `extensionScripts`, or the Settings menu | A directory is enough — its extensions are discovered |

```json
{
  "skillPaths": ["/srv/shared/skills/house-style"],
  "promptPaths": ["./my-prompts"]
}
```

Paths are resolved against the configuration file's directory, and are automatically
made readable to the agent even when they sit outside the sandbox root.

Open **Settings → Manage agent resources** to add either a local folder or a Git
repository. A local folder writes to `userSkillPaths` or `userExtensionPaths`, and loads
everything in it. For Git, enter the clone address and confirm or edit the suggested local
folder. Managed suggestions live under `<user config dir>/resource-repositories/`.

A Git repository is added as a **skill collection**: the preview lists every `SKILL.md` in
it, grouped by the folders the repository keeps them in, and **every skill starts off**.
Turn on the ones you want — one switch per skill, **All on** / **All off** for the whole
repository or for one folder — then **Save** to add the repository. Later changes in the
repository's pane are staged and take effect with **Apply**; either way the session is
replaced once with exactly those skills. Nothing from the repository is loaded until a skill is turned on, and a skill
that arrives later through an update stays off. The skills that are on are listed at the top
of the repository, each with **Turn off**; **Search skills** and **Only on** narrow a large
collection, and the repository list shows how many are on. A repository is named after its
`origin`, not after the local folder it was cloned into. Copies of the same skill in different
folders are listed as the repository ships them. The selection is stored under
`userSkillCollections`. Extension roots (`extensions/`, `.pi/extensions/`,
`.agents/extensions/`) are still selected as roots. A repository added before collections
existed keeps loading everything under its skill roots.

**Remove repository** unregisters a repository as a whole — its skills, extensions and
selection — after a confirmation. For a clone pi-outpost made, or one inside the managed
folder, it also **deletes the clone from disk**, local changes included; that cannot be
undone. A repository you pointed at elsewhere is unregistered and its files are kept. A
repository that supplies a path from the configuration file cannot be removed here.

Both flows rebuild the session at once — no server restart — and never alter paths declared
by the deployment. Extension folders warn that they execute code; an extension-bearing or
mixed Git repository also requires revision-specific confirmation before updating.
`extensionLock` still permits skill-only enrollment from a mixed preview, but blocks
extension activation and updates of the mixed repository as a unit. The enrollment warning
is browser-side acknowledgement rather than access control; `extensionLock` is the
server-side boundary. Update confirmation is revision-bound and checked by the server.

The Git updater only performs a clean fast-forward to the assessed upstream revision. Fix
dirty, detached, ahead, diverged, or missing-upstream states in an external terminal, then
use **Check** again. It never commits, stashes, discards, rebases, pushes, switches branches,
runs repository hooks, or initializes/updates submodules. Clone and fetch cannot prompt;
configured credential helpers or SSH agents may authenticate non-interactively. If Git
succeeds but a workspace reload fails, the clone stays advanced and the manager reports
the partial reload instead of attempting a destructive rollback.

With the RPC runtime, missing skill source paths and the unavailable extension inventory
are shown under **Provenance unavailable**. They stay visible but cannot be grouped or
updated until the child runtime supplies filesystem provenance.

For real isolation, remember that skills also load from `~/.agents/skills` and from
`.agents/skills` walked up from `cwd`, neither of which `agentDir` scopes: that is
what `noSkills` is for.

## Restrict which models can be picked

```json
{
  "allowedModels": [
    { "provider": "anthropic", "id": "claude-sonnet-5" },
    { "provider": "ollama", "id": "qwen3:14b" }
  ]
}
```

Without it the switcher lists every built-in model whose provider has credentials —
usually far more variants than a given deployment actually serves.

## Let the agent read a big PDF, Word or Excel file

Nothing to enable: `pdf_extract`, `docx_extract`, `xlsx_extract` and `pptx_extract`
are available wherever `read` is, need no shell and no external binary, and are
confined to the sandbox root like every other file tool. Drop the document into the
composer and it is uploaded into the workspace and attached as a path, which is what
those tools take.

The ceiling is 25 MB per format, raise it if your documents are bigger:

```json
{ "pdf": { "maxBytes": 52428800 }, "xlsx": { "maxBytes": 52428800 } }
```

For a long document, ask for `output_path`: the extractor writes the whole thing to a
workspace file and returns a summary, instead of spending the context on it twice.

## Make a PowerPoint deck from a template

Name the template in your prompt — `Make the steering-committee deck from brand.potx, using
report.docx` — or load the skill with `/skill:pptx-from-template`. Either one gives the agent four
tools and the bundled skill tells it how to use them:

1. `pptx_layouts` lists the template's layouts (a `.potx`, or a `.pptx` whose design you want).
2. `pptx_create` writes a new `.pptx`: each slide takes a layout, and its title, subtitle,
   bullets and picture go into that layout's placeholders, so the template styles them. A slide
   can carry a native table (in the template's table style) or a native chart — column, bar,
   line or pie, in the theme's colours, with its data in an embedded workbook so PowerPoint's
   *Edit Data* works. The template's own sample slides are left out. Pictures can be PNG, JPEG,
   GIF or SVG.
3. `pptx_update` changes an existing deck: replace a slide's content, insert a slide after one,
   delete or move one — slides named by number or by title. Every slide it does not touch stays
   exactly as it was, and what a deleted slide alone used (its pictures, charts, notes) leaves
   with it. It writes to a new file unless you ask it to overwrite the original.
4. `pptx_render` has an office application draw the deck and hands the agent a picture of every
   slide — or only the ones it asks for, such as the slides an update changed — plus a list of the
   text that is on a slide but not visible (overflow, clipping). The agent fixes what it sees and
   rebuilds, before telling you the deck is done. Ask for a PDF and it saves the rendering too.

Rendering needs one of these installed where the server runs:

- **PowerPoint**, on Windows — used first, through COM automation. It is the reference: what
  your audience will open the deck with. PowerPoint is never closed under you if you had a deck
  open in it.
- **LibreOffice**, anywhere — found in its standard location or on `PATH`.
- **ONLYOFFICE Document Builder** (`docbuilder`).

To force one, or to point at an executable installed elsewhere:

```json
{ "office": { "renderer": "libreoffice", "libreofficePath": "C:/Tools/LibreOffice/program/soffice.com" } }
```

These keys were `pptx.renderer`, `pptx.libreofficePath`, `pptx.onlyofficePath` and
`pptx.renderTimeoutMs` in 0.29: they still work, and the server names each one at startup with its
`office` replacement. The same settings draw Word documents.

LibreOffice and ONLYOFFICE substitute fonts they do not have, so their line breaks can differ a
little from PowerPoint's; the agent is told to leave room rather than trust a render that only just
fits. Building needs a writable workspace: in a read-only sandbox `pptx_create` and `pptx_update`
are not offered.
Speaker notes are not written yet, and charts are limited to those four types — the agent says so
rather than faking them.

## Write a Word document from a template

Name the template in your prompt — `Write the quarterly report from house.dotx` — or load the skill
with `/skill:docx-from-template`. Naming a `.docx` brings the same tools, with `docx_extract` to read
it. The bundled skill teaches the agent the loop:

1. `docx_styles` reads the template (`.dotx`, or a `.docx` whose look you want): which of its styles
   the headings, paragraphs, lists and tables will wear, whether it numbers its headings, and
   whether it has a cover page, a header and footer, and a table of contents.
2. `docx_create` writes Markdown into it. `#` becomes the template's first heading level, `##` the
   second, and so on, found by style name — so a template saved by a French Word, whose heading
   styles have the ids `Titre1`, `Titre2`…, works as one saved by an English Word. Lists, tables, pictures from the workspace, links and LaTeX equations (as native
   Word equations) come along; the template's styles, numbering, margins, header, footer and theme
   apply to all of it. The template's sample text is left out; its cover page and table of
   contents are kept when asked, and Word refreshes the table of contents on opening.
3. `docx_update` changes an existing document, one section at a time, sections named by their
   heading (`"Scope"`, or `"Scope > Out of scope"` when a name repeats): replace a section's body,
   insert a section after one, append, or delete. The changes are **tracked** by default, in the
   name of pi-outpost, so whoever owns the document accepts or rejects them in Word;
   `track_changes: false` writes them directly. Everything outside the edited sections is left
   byte for byte as it was, and a section holding changes nobody has accepted yet is refused.
4. `docx_render` has an office application draw the document and returns the pages as pictures,
   the chapters as the PDF's bookmarks — the headings as Word sees them, with their numbers when
   the template numbers them — and any body paragraph that reached no page.

Rendering uses the same applications and settings as decks, with **Word** first on Windows: it
opens a read-only copy of the document, invisibly, and never closes a document you have open in
it. Creating and updating need a writable workspace: in a read-only sandbox `docx_create` and
`docx_update` are not offered.

Footnotes, comments, text boxes and section changes (landscape pages, columns) are not written, and
a mermaid diagram is written as its source; the agent says what is missing rather than faking it.

### Export from the viewer into your template

Point `docx.template` at the template everyone should use:

```json
{ "docx": { "template": "templates/house.dotx" } }
```

The path is relative to the configuration file. The viewer's Word export then offers a second
button, **⤓ word · template**, that writes the open document into it. The document is built in
the browser as before, diagrams included, and the server carries it into the template. The plain
export stays beside it: a template that is missing or cannot be used is reported on its own
button, and never blocks the other.

## Lock down a shared deployment

For a server other people connect to, decide what the browser may change:

```json
{
  "sandboxLocks": { "root": true, "writableRoot": true, "allowWrite": true, "allowBash": true },
  "extensionLock": true,
  "workspaceLock": true,
  "noSkills": false
}
```

- `sandboxLocks` freezes the sandbox fields, individually
- `extensionLock` forbids adding extension directories — that is loading *code*, which
  is why it is separate from skill paths, and why skill paths stay editable under it
- `workspaceLock` pins the server to one project

All of it is enforced by the server: a client that sends the request anyway is
refused, nothing is persisted and no session is rebuilt. Add `server.token`, and read
the security note in the README before binding off loopback.

## Put it inside your own web app

```bash
npm install @pi-outpost/embed
```

```js
import { mount } from "@pi-outpost/embed";

const widget = mount(document.getElementById("assistant"), {
  serverUrl: "https://outpost.internal",
  token: currentUser.outpostToken,   // no token screen for your users
  workspace: "/srv/projects/acme",   // which project this widget shows
  theme: "dark",
});
```

Server side, two settings decide what the widget is:

```json
{
  "server": { "allowedOrigins": ["https://your-app.example.com"] },
  "embed": { "workspaceControls": "settings" },
  "workspaceLock": true
}
```

`allowedOrigins` must list your host page's origin — the widget's WebSocket carries
*that* origin, not pi-outpost's, and the same list now grants CORS on the HTTP routes,
so a cross-origin widget works without a proxy in front.
`embed.workspaceControls` chooses what it offers around the project: `settings` (one
project, root editable through Settings only), `root` (a compact root chooser) or
`projects` (the full open/switch/close controls).

## Use an existing pi installation

```json
{ "agentRuntime": { "mode": "rpc", "executable": "pi", "args": [] } }
```

pi-outpost then supervises a `pi --mode rpc` child instead of running the SDK
in-process — to match an installation you already maintain, or to isolate a crash. It
appends `--mode rpc` and derives `--session-dir` itself, and passes the rest of the
configuration (skills, extensions, prompt templates, tools, system prompt) to the
child, so the same file describes the same agent either way.

Two things to know first: **`sandbox` cannot be combined with `rpc`** — the pair is
refused at load, because the sandbox is a toolset this server builds and a child builds
its own; isolate it with a container or a dedicated user instead. And a few features
have no RPC equivalent and say so rather than failing quietly: storing credentials,
declaring a provider, changing the sandbox from Settings, tree navigation, editing a
past message, and automatic session titles.

## When something does not work

| What you see | What it is |
|---|---|
| `no configuration file found` | pi-outpost never starts without one. `pi-outpost init`, or `init --global` |
| `cannot start: … is already in use` | Something else holds the port. `--port <n>` |
| The setup screen keeps coming back | No provider can answer. `pi-outpost config` shows which `agentDir` it reads. Built-in provider credentials live in `<agentDir>/auth.json`; custom provider declarations and keys live in `<agentDir>/models.json` |
| A bare `fetch failed` | A TLS-inspecting proxy. `export NODE_EXTRA_CA_CERTS=/path/to/corp-ca.pem` |
| Every turn fails on your own endpoint | The compatibility flags. Untick both, or set `compat` in `models.json` |
| Each credential change hangs ~20 s | Remote model catalogs are unreachable. `"offline": true` |
| A remote browser cannot connect | The origin is not allowed. Add the exact origin you type to `server.allowedOrigins`; the log line names it |
| The file tree does not follow changes | Watching may be off (`files.watch`) or the filesystem emits no events. The tree's ↻ control re-lists by hand |
| Settings will not change the sandbox | Either a `sandboxLocks` entry, or the RPC runtime, which has no sandbox to change |
| Not sure which file is in force | `pi-outpost config` prints the resolved configuration and where it came from |
