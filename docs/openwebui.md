# Plannings in Open WebUI

pi-outpost's planning timelines also run inside [Open WebUI](https://openwebui.com), with no
pi-outpost involved. A small server, the **planning server**, does three things:

- it keeps each user's plannings with every revision;
- it lets the model create, read and change them;
- it shows them in the chat as the interactive timeline pi-outpost draws. That covers scales,
  "fit", dependencies, closures, key dates and comparisons between revisions.

It uses the same structured-exchange contract as pi-outpost. A planning refused here is refused
there for the same reason, and every stored revision opens in pi-outpost as it is.

Checked against **Open WebUI v0.11.4**.

For the architecture, the trust model, token and key management and what is stored, see
[openwebui-architecture.md](openwebui-architecture.md).

- [How it fits together](#how-it-fits-together)
- [A demo in ten minutes](#a-demo-in-ten-minutes)
- [Turning it on for a model](#turning-it-on-for-a-model)
- [What users can ask](#what-users-can-ask)
- [Configuration](#configuration)
- [Identity: signed or plain](#identity-signed-or-plain)
- [Data, backups and upgrades](#data-backups-and-upgrades)
- [Without Docker](#without-docker)
- [Known limits](#known-limits)

## How it fits together

```
browser ──► Open WebUI ──(tool calls, bearer key + signed user)──► planning server ──► /data
               ▲                                                         │
               └──────────── the timeline, as HTML embedded in the chat ─┘
```

- **Open WebUI declares the server as a global tool server.** Open WebUI's backend calls it, never
  the browser, so the server publishes no port and needs no route from users' machines.
- **Every call carries two proofs:**
  - the connection's bearer key, which shows the call comes from Open WebUI;
  - the user Open WebUI acts for, signed with a second key.
- **Plannings are personal:** a user lists, reads and changes only their own.

## A demo in ten minutes

On any machine with Docker, for instance a VM:

```bash
mkdir openwebui-plannings && cd openwebui-plannings
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

1. Open `http://<machine>:3000`. The first account created is the administrator.
2. [Turn the planning tools on for a model](#turning-it-on-for-a-model).
3. Ask, for example: *"Crée un planning pour la refonte du site web : maquettes de mi-janvier à fin
   février 2027, revue de design le 5 mars, développement du 8 mars à fin mai, mise en ligne le 15
   juin. Le développement dépend de la revue. Montre-le-moi."*

The compose file runs two containers:
- Open WebUI on port 3000;
- the planning server (`ghcr.io/laurentftech/pi-outpost-plannings`), with no published port and its
  plannings in the `plannings` volume.

Open WebUI finds the planning server through `TOOL_SERVER_CONNECTIONS`. It reads that only on its
**first** start; afterwards the setting lives in *Admin Settings → Integrations → External Tool Servers*.

## Turning it on for a model

A global tool server is available to everyone, but a chat uses it only when it is switched on.
**For a demo:** the admin attaches it to the model, so every chat with that model has it:

1. Go to *Admin Settings → Models*, and edit the model, for instance `codestral-latest`.
2. Under *Tools*, tick **Plannings**.
3. Save.

**One chat at a time instead:** a user switches **Plannings** on from the chat's integrations menu
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

**In the timeline:**
- the reader changes scale (week, month, quarter, fit), hides dependencies, or draws one row per
  section;
- clicking a task or a milestone opens its details, and **pre-fills** the message box with a
  sentence naming it. It is never sent on its own: the user finishes the sentence ("…move it to
  June") and sends it.

**Edits are targeted:** the model changes a milestone by naming it, never by re-typing the whole
planning.
- A change made against an out-of-date revision is refused, and the model is told to read it again.
- A change that would break the planning (an end before its start, a date outside the range) is
  refused with the reason, and nothing is stored.

## Configuration

The planning server reads only its environment.

| Variable | Default | Meaning |
|---|---|---|
| `OWUI_PLANNING_SECRET` | — (required) | The bearer key of the tool server connection in Open WebUI. Requests without it are refused before anything else is read. |
| `OWUI_PLANNING_IDENTITY` | `signed` | `signed` or `plain`; see below. |
| `OWUI_PLANNING_IDENTITY_KEY` | — (required when signed) | Open WebUI's `FORWARD_USER_INFO_HEADER_JWT_SECRET`. |
| `OWUI_PLANNING_DATA_DIR` | `/data` in the image, `./planning-data` otherwise | Where plannings are stored. |
| `OWUI_PLANNING_HOST` | `0.0.0.0` in the image, `127.0.0.1` otherwise | Listening address. |
| `OWUI_PLANNING_PORT` | `8790` | Listening port. |
| `OWUI_PLANNING_MAX_BYTES` | `1000000` | Largest planning, in bytes of JSON. |
| `OWUI_PLANNING_MAX_REVISIONS` | `500` | Revisions kept per planning. Past it, updates are refused, never silently pruned. |
| `OWUI_PLANNING_MAX_PLANNINGS` | `200` | Plannings per user. |

The server refuses to start, and names the setting, when the secret is missing, or when it is in
signed mode without a key.

**On the Open WebUI side:**
- `ENABLE_FORWARD_USER_INFO_HEADERS=true`. Without it, no identity reaches the server and every
  planning request is refused;
- `FORWARD_USER_INFO_HEADER_JWT_SECRET` set to the same value as `OWUI_PLANNING_IDENTITY_KEY`;
- the tool server connection, either through `TOOL_SERVER_CONNECTIONS` (see the compose file) or by
  hand in *Admin Settings → Integrations → External Tool Servers*:
  - type OpenAPI;
  - URL `http://<planning server>:8790`, path `openapi.json`;
  - authentication *Bearer*, with `OWUI_PLANNING_SECRET`.

## Identity: signed or plain

| Mode | What Open WebUI sends | What the planning server trusts |
|---|---|---|
| **signed** (default, recommended) | `X-OpenWebUI-User-Jwt`, an HS256 token naming the user, valid five minutes | The token's signature, issuer (`open-webui`) and expiry. The user is the token's subject; plain user headers are ignored. |
| **plain** | `X-OpenWebUI-User-Id` and the other plain headers | The header, because the bearer key shows Open WebUI sent it |

Plain mode suits an Open WebUI that cannot be given `FORWARD_USER_INFO_HEADER_JWT_SECRET`. Note
that setting that variable affects every backend Open WebUI forwards users to, not only this one.
Plain mode is only as safe as the bearer key and the network between the two containers.

## Data, backups and upgrades

- **Storage:** each planning is a directory of revision files, `1.json`, `2.json`, …, plus a small
  `meta.json`, under a directory per user named by a hash of the user's id.
- **Backups:** a backup is a copy of the volume.
- **Opening a planning elsewhere:** any revision file opens in pi-outpost as a structured-exchange
  document.
- **Upgrading:** replace the image and keep the volume. Plannings outlive the container.
- **Images:** one tag per pi-outpost release, `ghcr.io/laurentftech/pi-outpost-plannings:<version>`;
  `latest` follows stable releases only.
- **Behind a mirror registry:** rebuild the image from the repository:

  ```bash
  docker build -f openwebui/Dockerfile -t pi-outpost-plannings .
  ```

## Without Docker

From a clone of the repository, with Node 24:

```bash
npm ci
npm run build --workspace @pi-outpost/openwebui
OWUI_PLANNING_SECRET=… OWUI_PLANNING_IDENTITY_KEY=… node openwebui/dist/server.mjs
```

`dist/server.mjs` is self-contained apart from `dist/viewer/`, which it embeds; copy both.

## Known limits

- **Embed size.** Each time a planning is shown, Open WebUI stores the timeline in the chat, about
  110 kB.
- **The model does not see the timeline.** Open WebUI hands the model only a note that an embed is
  on screen, so the model reads a planning with `get_planning`.
- **Plannings are personal.** Sharing within a team is not there yet.
- **Open WebUI v0.11.4 bug, worked around.** This version drops embeds that contain HTML entities
  (fixed upstream by `c7caa1421`, not released yet). The server ships the timeline compressed, with
  no entity in it, so it works on v0.11.4 and later alike.
