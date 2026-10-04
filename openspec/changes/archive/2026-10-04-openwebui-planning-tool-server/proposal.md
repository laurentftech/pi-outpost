# Proposal

## Why

Some IT department standardises on Open WebUI, and people will not install pi-outpost to get
planning timelines. The structured-exchange timeline — contract, validation, comparison and the
interactive viewer — is already independent of pi, so it can be offered inside Open WebUI without a
second implementation. A planning is an artifact maintained over weeks, not a one-off answer, so it
must live somewhere other than the chat history.

## What Changes

- A new package, an **OpenAPI tool server**, that Open WebUI declares as a global tool server. It
  reuses `shared/` for the version 3 timeline contract, validation and comparison, so a planning means
  the same thing — and is refused for the same reasons — in pi-outpost and in Open WebUI.
- **Stored, personal plannings.** Each planning belongs to the Open WebUI user who created it, is kept
  on the server in the same JSON document pi-outpost reads, and keeps every revision. A user sees and
  changes only their own plannings. Team sharing is out of scope.
- **Identity from Open WebUI, trusted only from Open WebUI.** The owner is taken from the user-info
  headers Open WebUI forwards; a request without the shared bearer secret is refused before any header
  is read.
- **Five tools for the model:** list, create, get, update and show. `update` applies targeted
  operations (add, change, move or remove a task, an item, a separator or a dependency) rather than a
  whole rewritten document, and every write is validated: a refused write changes nothing and returns
  the diagnostics.
- **The timeline in the conversation.** `show_planning` returns the interactive timeline as Open WebUI
  rich UI (inline HTML in a sandboxed frame), optionally compared to an earlier revision. A click on a
  task or milestone pre-fills the chat input with a prompt about it; it never submits on its own.
- **Configurable hosting**: listen address, storage directory, secret and limits come from
  configuration, since where the server runs is not decided yet.
- A prototype step settles two unknowns before the rendering choice is final: whether an embed
  survives reopening the chat, and whether a user's browser can reach the server (a light shell that
  loads the viewer, or the whole viewer inline).

## Capabilities

### New Capabilities

- `openwebui-planning-server`: a tool server that stores personal, revisioned structured-exchange
  plannings for Open WebUI users, edits them through validated targeted operations, and shows them as
  an interactive timeline in the conversation.

### Modified Capabilities

None. The version 3 timeline contract, its validation and its comparison are reused unchanged; the
tool server is a new consumer of them.

## Impact

- **New workspace package** beside `server/` (Node, Fastify), with its own build, tests and README.
- **`shared/`**: consumed as is. Any change found necessary there is a separate decision.
- **`ui/`**: a single-file build of `TimelineView` for the embed. The component itself is not meant to
  change; the build entry is new.
- **CI**: the new package's tests run with the others, Windows included.
- **Shipped as a container image.** The release workflow publishes it to `ghcr.io`, versioned like
  pi-outpost. Open WebUI deployments are container deployments, and the image is what an IT
  department adds next to Open WebUI. The `Dockerfile` stays in the repository, so it can be rebuilt
  behind a mirror registry. The package is not published to npm.
- **Docs**: a deployment page, with a complete `docker-compose` example run for real: Open WebUI's
  `TOOL_SERVER_CONNECTIONS`, `ENABLE_FORWARD_USER_INFO_HEADERS`, `FORWARD_USER_INFO_HEADER_JWT_SECRET`,
  and the two secrets.
