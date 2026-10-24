# pi-outpost in Open WebUI

pi-outpost's planning timelines and structured documents also run inside
[Open WebUI](https://openwebui.com), with no pi-outpost involved. A small server,
**pi-outpost's Open WebUI server** (*the server* below), does five things:

- it keeps each user's plannings with every revision;
- it lets the model create, read and change them;
- it shows them in the chat as the interactive timeline pi-outpost draws. That covers scales,
  "fit", dependencies, closures, key dates and comparisons between revisions;
- it shows the model's diagrams, sequences and tables as pi-outpost draws them, including a
  proposal as what it would change;
- it writes Word documents and PowerPoint decks, with their diagrams and pictures, for the user to
  download from the chat.

It uses the same structured-exchange contract as pi-outpost. A document refused here is refused
there for the same reason, and every stored planning revision opens in pi-outpost as it is. One
diagnostic is worded for plannings: when a planning's `schema` and `kind` are missing, wrong or
placed inside `data`, the answer names that envelope and the form to write, rather than what every
other kind of document would have needed.

Checked against **Open WebUI v0.11.4**.

For the architecture, the trust model, token and key management and what is stored, see
[openwebui-architecture.md](openwebui-architecture.md).

- [How it fits together](#how-it-fits-together)
- [A demo in ten minutes](#a-demo-in-ten-minutes)
- [Turning it on for a model](#turning-it-on-for-a-model)
- [What users can ask](#what-users-can-ask)
- [Word documents and PowerPoint decks](#word-documents-and-powerpoint-decks)
- [Posters](#posters)
- [Configuration](#configuration)
- [Identity: signed or plain](#identity-signed-or-plain)
- [Data, backups and upgrades](#data-backups-and-upgrades)
- [Without Docker](#without-docker)
- [Known limits](#known-limits)

## How it fits together

```
browser ──► Open WebUI ──(tool calls, bearer key + signed user)──► pi-outpost server ──► /data
               ▲                                                         │
               └──────────── the timeline, as HTML embedded in the chat ─┘
browser ───────── optional poster save (scoped capability) ────────────► /poster-save
```

- **Open WebUI declares the server as a global tool server.** Open WebUI's backend calls it, never
  the browser for ordinary tools. The Docker example binds pi-outpost to loopback by default; poster
  saving can optionally publish a capability-protected write route to the browser.
- **Every call carries two proofs:**
  - the connection's bearer key, which shows the call comes from Open WebUI;
  - the user Open WebUI acts for, signed with a second key.
- **Plannings are personal:** a user lists, reads and changes only their own.

## A demo in ten minutes

On any machine with Docker, for instance a VM:

```bash
mkdir openwebui-pi-outpost && cd openwebui-pi-outpost
curl -LO https://raw.githubusercontent.com/laurentftech/pi-outpost/main/openwebui/deploy/docker-compose.yml
curl -L -o .env https://raw.githubusercontent.com/laurentftech/pi-outpost/main/openwebui/deploy/.env.example
```

Fill in `.env`:
- three secrets, each from `openssl rand -hex 32`;
- the URL and key of an OpenAI-compatible model provider. Mistral and Gemini are given as
  examples.

Then:

```bash
docker compose up -d
```

**The image is published from the release that includes it.** To try a version not released yet,
build the image from a clone of the repository, then name it in `.env`:

```bash
git clone https://github.com/laurentftech/pi-outpost.git
cd pi-outpost && docker build -f openwebui/Dockerfile -t pi-outpost-openwebui .
# in .env, next to docker-compose.yml:
OUTPOST_IMAGE=pi-outpost-openwebui
```

**Exposure:** `OPEN_WEBUI_PORT` decides where Open WebUI listens.
- By default it listens on every interface, which suits a VM others connect to.
- `OPEN_WEBUI_PORT=127.0.0.1:3000` keeps it to the machine itself.

1. Open `http://<machine>:3000`. The first account created is the administrator.
2. [Turn the planning tools on for a model](#turning-it-on-for-a-model).
3. Ask, for example: *"Crée un planning pour la refonte du site web : maquettes de mi-janvier à fin
   février 2027, revue de design le 5 mars, développement du 8 mars à fin mai, mise en ligne le 15
   juin. Le développement dépend de la revue. Montre-le-moi."*

The compose file runs two containers:
- Open WebUI on port 3000;
- pi-outpost's server (`ghcr.io/laurentftech/pi-outpost-openwebui`), with its plannings and posters
  in the `pi-outpost-data` volume. Its port is bound to `127.0.0.1` by default. To save poster edits
  from another device, configure the browser URL and explicitly bind the port to the LAN as described
  under [Saving retouches](#posters).

Open WebUI finds the server through `TOOL_SERVER_CONNECTIONS`. It reads that only on its
**first** start; afterwards the setting lives in *Admin Settings → Integrations → External Tool Servers*.

## Turning it on for a model

A global tool server is available to everyone, but a chat uses it only when it is switched on.
**For a demo:** the admin attaches it to the model, so every chat with that model has it:

1. Go to *Admin Settings → Models*, and edit the model, for instance `codestral-latest`.
2. Under *Tools*, tick **pi-outpost**.
3. Save.

**One chat at a time instead:** a user switches **pi-outpost** on from the chat's integrations menu
(the tools button under the message box).

**Users must see the model too.** Open WebUI hides models from plain users until the admin
grants access: *Admin Settings → Models*, the model, *Visibility* (or access), and open it to users
or to a group. The planning tools are open to every user through the `access_grants` in the
compose file. Without a grant, Open WebUI keeps a tool server to admins only.

A model needs tool calling. Codestral, Mistral Medium and Gemini Flash all work.

## What users can ask

| They say | The model calls |
|---|---|
| "Create a planning for…", with phases, dates and what depends on what | `create_planning`, then `show_planning` |
| "Show me the drone programme" | `list_plannings`, then `show_planning` |
| "Move the CDR two weeks later", "add a test phase after integration" | `get_planning`, `update_planning`, then `show_planning` compared with the previous revision |
| "What changed since last week's version?" | `show_planning` with `compare_to` |
| "Draw the order process", "show the architecture of…", "who talks to whom when…", "put this in a table" | `show_structure`: a graph, a sequence or a table |
| "Propose replacing X by Y in this architecture" | `show_structure` with a proposal: additions, changes and removals marked |
| "Write me a report on…", "put this in a Word document" | `create_document` |
| "Make slides for the review", "a PowerPoint deck on…" | `create_presentation` |
| "Use our company template" | `list_templates`, then `create_document` or `create_presentation` with it |
| "Add a slide on the budget after the second one", "rewrite the risks section" | `update_presentation` or `update_document` (with `list_documents` first when needed) |

**How the model learns the format.** Open WebUI's models have no skill to read, so the planning
server teaches them in three places:
- **The tool descriptions:** the shapes, and a complete example of each kind.
- **`read_structure_guide`:** the reference pages of pi-outpost's own structured-exchange skill, one
  topic per job: graphs and tables, proposals, timelines, the enriched version 2 contract. Same
  source as pi-outpost's skill, less the passages about pi-outpost's file tools.
- **Refusals:** each one says what was wrong and which guide topic explains it. In practice this is
  where the guide gets read. A model that has just been refused reads the page it is pointed to,
  then corrects its document within the same reply.

Nothing has to be installed for this: the guide comes with the server, in the server's version.

**In the timeline:**
- the reader changes scale (week, month, quarter, fit), hides dependencies, or draws one row per
  section;
- clicking a task or a milestone opens its details, and **pre-fills** the message box with a
  sentence naming it. It is never sent on its own: the user finishes the sentence ("…move it to
  June") and sends it.

**Diagrams, sequences and tables:**
- They are drawn by pi-outpost's own rendering:
  - graphs, which can be enlarged, turned and narrowed to a viewpoint the document declares;
  - sequences;
  - tables, with their row roles;
  - a text view of each;
  - the document as written.
- **Downloads:** the reader can download a diagram as SVG, and a table as Markdown, CSV or XLSX.
- **Nothing is stored:** the document stays in the conversation, as the argument of the model's
  call.
- **A proposal is shown, never applied.** It marks what it would add, change and remove, for the user
  to judge, and nothing on the page applies it.
- **Refusals:** a document the contract refuses is not shown. The model receives the reason and
  usually corrects it within the same reply.

**Edits are targeted:** the model changes a milestone by naming it, never by re-typing the whole
planning.
- A change made against an out-of-date revision is refused, and the model is told to read it again.
- A change that would break the planning (an end before its start, a date outside the range) is
  refused with the reason, and nothing is stored.

## Word documents and PowerPoint decks

The model writes a Word document from Markdown (`create_document`) or a deck from a list of slides
(`create_presentation`). The answer is a card in the chat with the file's name, its outline (headings
or slide titles), its figures, and a **Download** button.

- **Built with pi-outpost's own builders**, in a template's styles: headings, lists, tables, links,
  quotes, code and equations in Word; titles, bullets, native tables and native charts in PowerPoint.
- **Diagrams are drawn as pictures in their place:**
  - a Mermaid diagram, written as a ` ```mermaid ` fence (Word) or a slide's `mermaid`;
  - a structured-exchange graph, sequence or timeline, written as a ` ```json ` fence (Word) or a
    slide's `diagram`, drawn exactly as `show_structure` draws it; a structured-exchange table
    becomes a native table.

  Each is an SVG picture with a PNG behind it. Word and PowerPoint 2016 and later show the SVG, sharp
  at any zoom; LibreOffice, Google Docs and older Office show the PNG.
- **Pictures travel in the call** as `data:` URIs: PNG, JPEG or GIF. The server fetches nothing: a
  picture given as a web address is refused, and the model is asked for its bytes. The chat's
  uploaded files are not reachable: Open WebUI does not hand them to a tool server.
- **Templates:** without one, a built-in style close to Word's and PowerPoint's own blank document.
  An administrator can offer the organisation's templates (`.dotx`, `.docx`, `.potx`, `.pptx`) by
  putting them in a folder the server reads at `OUTPOST_TEMPLATES_DIR`. In the compose file that is
  `./templates` next to it (`OUTPOST_TEMPLATES` in `.env` to move it), mounted read-only. The model
  names a template by its file name, never by a path.
- **Changing a file written earlier:** the server keeps each user's last files under their names, so
  the model changes one by naming what to change — a slide by its number or title, a section by its
  heading — with `update_presentation` or `update_document`; the rest stays as it was, and the user
  gets the changed file in a new card. `list_documents` shows the model what is kept. A user keeps up
  to `OUTPOST_MAX_DOCUMENTS` files (20), each for `OUTPOST_DOCUMENT_DAYS` days (30).
- **Refusals:** a diagram the contract refuses, a Mermaid source that does not parse, a picture that
  is not accepted or a template that does not exist refuses the whole call, with what to correct. The
  model usually corrects it within the same reply. A document is never written with a part missing.

Mermaid is drawn by Mermaid 12 inside the server, without a browser; its layout is close to what the
browser draws, not identical.

## Posters

The model composes a poster, a worksheet or a slide in HTML and CSS (`create_poster`) and shows it
(`show_poster`): the answer is the poster in an editor, in the chat. The same editor as pi-outpost's
file viewer and the Claude Desktop extension.

- **Downloads:** **↓ word** gives an A4 (or A3) page with narrow margins, to print; **↓ powerpoint**
  one 16:9 slide, to show; **↓ html** the page itself. The poster travels as a picture at print
  resolution, built in the browser: the server is not called.
- **Theme and editing:** the embed follows Open WebUI's theme when **iframe Sandbox Allow Same Origin** is enabled, including live theme switches; otherwise it follows the system theme.
- **Retouching needs a setting.** Open WebUI draws a tool's embed in a frame that cannot reach the
  editor's canvas unless the user turns on **iframe Sandbox Allow Same Origin** in their settings.
  Without it the poster is shown as it is, with its downloads, and the embed says so. With it, the
  user can correct texts, move pictograms and change colours before downloading. The embed carries
  its own Content-Security-Policy — only its two scripts run, by their hashes, and network access is
  limited to the configured pi-outpost origin.
- **Saving retouches:** set `OUTPOST_PUBLIC_URL` to the browser-reachable pi-outpost origin and
  `OUTPOST_WEBUI_ORIGIN` to the exact Open WebUI browser origin. The compose file binds pi-outpost
  to loopback by default; for other devices on the LAN, set `OUTPOST_PUBLISH=0.0.0.0:8790:8790`
  and use the host's LAN IP in both URLs. For HTTPS Open WebUI, pi-outpost must also be served over
  HTTPS (usually through a reverse proxy). A save capability is scoped to one user, poster and base
  revision; the server bearer secret is never sent to the browser. Saving creates a new revision
  that `get_poster` returns to the model. The capability is a write-only bearer permission carried
  in that chat embed: anyone who can access a shared chat can use it to make one save to that poster
  before the revision advances, but it does not let them read poster contents. Old chat embeds
  conflict after a newer save; ask the model to show the poster again to get a fresh editor.
- **Kept per user,** as plannings are, with every revision (`list_posters`, `get_poster`).

## Configuration

The server reads only its environment.

| Variable | Default | Meaning |
|---|---|---|
| `OUTPOST_SECRET` | — (required) | The bearer key of the tool server connection in Open WebUI. Requests without it are refused before anything else is read. |
| `OUTPOST_IDENTITY` | `signed` | `signed` or `plain`; see below. |
| `OUTPOST_IDENTITY_KEY` | — (required when signed) | Open WebUI's `FORWARD_USER_INFO_HEADER_JWT_SECRET`. |
| `OUTPOST_PUBLIC_URL` | — (saving disabled) | Browser-reachable pi-outpost origin, e.g. `http://192.168.1.4:8790`. Must be paired with `OUTPOST_WEBUI_ORIGIN`. |
| `OUTPOST_WEBUI_ORIGIN` | — (saving disabled) | Exact browser origin allowed to save poster edits, e.g. `http://192.168.1.4:3000`. Must be paired with `OUTPOST_PUBLIC_URL`. |
| `OUTPOST_DATA_DIR` | `/data` in the image, `./planning-data` otherwise | Where plannings are stored. |
| `OUTPOST_HOST` | `0.0.0.0` in the image, `127.0.0.1` otherwise | Listening address. |
| `OUTPOST_PORT` | `8790` | Listening port. |
| `OUTPOST_MAX_PLANNING_BYTES` | `1000000` | Largest planning, in bytes of JSON. |
| `OUTPOST_MAX_REVISIONS` | `500` | Revisions kept per planning. Past it, updates are refused, never silently pruned. |
| `OUTPOST_MAX_PLANNINGS` | `200` | Plannings per user. |
| `OUTPOST_TEMPLATES_DIR` | — (no templates) | A folder of Word and PowerPoint templates the model may name. Read-only; only files directly in it are offered. |
| `OUTPOST_MAX_FILE_BYTES` | `5242880` (5 MB) | Largest Word or PowerPoint file written. Larger results are refused with the size, since each one is stored in the chat. |
| `OUTPOST_MAX_IMAGE_BYTES` | `1048576` (1 MB) | Largest picture a call may give, once decoded. |
| `OUTPOST_MAX_DOCUMENTS` | `20` | Word and PowerPoint files kept per user for later changes; the oldest go first. |
| `OUTPOST_DOCUMENT_DAYS` | `30` | Days a kept file stays after it was last written. |

The server refuses to start, and names the setting, when the secret is missing, or when it is in
signed mode without a key.

**On the Open WebUI side:**
- `ENABLE_FORWARD_USER_INFO_HEADERS=true`. Without it, no identity reaches the server and every
  planning request is refused;
- `FORWARD_USER_INFO_HEADER_JWT_SECRET` set to the same value as `OUTPOST_IDENTITY_KEY`;
- the tool server connection, either through `TOOL_SERVER_CONNECTIONS` (see the compose file) or by
  hand in *Admin Settings → Integrations → External Tool Servers*:
  - type OpenAPI;
  - URL `http://<server>:8790`, path `openapi.json`;
  - authentication *Bearer*, with `OUTPOST_SECRET`.

## Identity: signed or plain

| Mode | What Open WebUI sends | What the server trusts |
|---|---|---|
| **signed** (default, recommended) | `X-OpenWebUI-User-Jwt`, an HS256 token naming the user, valid five minutes | The token's signature, issuer (`open-webui`) and expiry. The user is the token's subject; plain user headers are ignored. |
| **plain** | `X-OpenWebUI-User-Id` and the other plain headers | The header, because the bearer key shows Open WebUI sent it |

Plain mode suits an Open WebUI that cannot be given `FORWARD_USER_INFO_HEADER_JWT_SECRET`. Note
that setting that variable affects every backend Open WebUI forwards users to, not only this one.
Plain mode is only as safe as the bearer key and the network between the two containers.

## Data, backups and upgrades

- **Storage:** each planning is a directory of revision files, `1.json`, `2.json`, …, plus a small
  `meta.json`, under a directory per user named by a hash of the user's id. Kept Word and PowerPoint
  files are under `documents/`, and posters under `posters/`, a directory per user named the same
  way; each revision of a poster is one file.
- **User isolation and encryption:** Open WebUI identity (signed by default) scopes planning and poster reads and
  writes to one user; another authenticated user cannot access them through these tools. The files
  and volume backups are **not encrypted at rest**: they are plain JSON/binary files. Anyone with
  access to the Docker volume, host or its backups can read them. Use encrypted host/volume storage
  and protect backups when those administrative access paths are in scope.
- **Backups:** a backup is a copy of the volume.
- **Opening a planning elsewhere:** any revision file opens in pi-outpost as a structured-exchange
  document.
- **Upgrading:** replace the image and keep the volume. Plannings outlive the container.
- **Images:** one tag per pi-outpost release, `ghcr.io/laurentftech/pi-outpost-openwebui:<version>`;
  `latest` follows stable releases only.
- **Behind a mirror registry:** rebuild the image from the repository:

  ```bash
  docker build -f openwebui/Dockerfile -t pi-outpost-openwebui .
  ```

## Without Docker

From a clone of the repository, with Node 24:

```bash
npm ci
npm run build --workspace @pi-outpost/openwebui
OUTPOST_SECRET=… OUTPOST_IDENTITY_KEY=… node openwebui/dist/server.mjs
```

`dist/server.mjs` embeds `dist/viewer/` and starts `dist/mermaid-worker.mjs` to draw Mermaid; copy
all three. Three packages cannot be bundled and must be installed beside them: `jsdom`,
`@napi-rs/canvas` and `@resvg/resvg-js` (`npm ci` installs them; the image copies them with
`openwebui/scripts/copy-runtime-modules.mjs`). Diagram labels need a font: the image installs Liberation
Sans, which has Arial's metrics, so Word on Windows draws the labels at the widths they were laid out
at; elsewhere, Arial or any installed sans-serif face is used.

## Known limits

- **Embed size.** Each time a planning is shown, Open WebUI stores the timeline in the chat, about
  110 kB.
  A poster's embed carries its editor: about 425 kB each time one is shown.
- **The model does not see the timeline.** Open WebUI hands the model only a note that an embed is
  on screen, so the model reads a planning with `get_planning`.
- **Plannings are personal.** Sharing within a team is not there yet.
- **Documents live in the chat.** Each Word or PowerPoint file is stored by Open WebUI in the
  conversation that asked for it, up to `OUTPOST_MAX_FILE_BYTES`. The server's own copy is a working
  copy for changes, dropped after its days or past its count, not an archive to download again.
- **Pictures cost the model tokens.** A picture's bytes are written by the model into its call, so
  documents with large pictures are slow and expensive to produce.
- **Uploaded documents cannot be changed.** Updating a `.docx` or `.pptx` the user attached, and
  checking pages visually, are not available here.
- **Open WebUI v0.11.4 bug, worked around.** This version drops embeds that contain HTML entities
  (fixed upstream by `c7caa1421`, not released yet). The server ships the timeline compressed, with
  no entity in it, so it works on v0.11.4 and later alike.
