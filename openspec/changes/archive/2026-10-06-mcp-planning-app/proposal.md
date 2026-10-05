# Proposal

## Why

Planning timelines work in pi-outpost and in Open WebUI, but not in the assistants most people already
use: Claude and ChatGPT. **MCP Apps**, the MCP extension for interactive UIs in a conversation
(2026-01-26, co-designed by Anthropic and OpenAI), lets one server show the same interactive timeline
in any host that supports it.

The first user is one person on her Mac who wants help building plannings. A prototype on
2026-10-04 confirmed that, in Claude Desktop on a free plan:
- a local MCP server installed from a `.mcpb` shows pi-outpost's interactive timeline in the
  conversation, with its scales and full screen;
- the host does **not** pass `ui/update-model-context` on to the model, so a click on the timeline
  went unnoticed;
- the directory picker refused a default of `${HOME}/Documents/Plannings`.

## What Changes

- **A new `mcp/` package:** a local MCP server, started by the host over stdio, offering
  `list_plannings`, `create_planning`, `get_planning`, `update_planning`, `show_planning` and
  `read_structure_guide`.
  - `show_planning` declares an MCP Apps view (`ui://`) that draws the planning with pi-outpost's
    `TimelineView`, optionally compared with an earlier revision.
- **Plannings live in a folder the user picks:**
  - one readable file per planning, the current version, which a person can open, copy or back up;
  - every revision kept in a hidden history folder beside it.

  No account, no secret, no network.
- **The selection reaches the model through the server, not the host.** A click on a task or a
  milestone calls a tool only the view can call (`visibility: ["app"]`), which records the
  selection. `get_planning` returns it, so "move it a week" finds what "it" is. `update-model-context`
  is still sent, for hosts that pass it on.
- **One core, shared with `openwebui/`:**
  - the timeline gate;
  - the targeted update operations;
  - the guide;
  - the tool descriptions and their examples.

  These move into a shared package that both servers import. Neither server copies the other.
- **Installation by double-click:** a `.mcpb` with a folder picker that has no default, so the user
  picks or creates the folder. The server creates the folder if needed. CI builds the `.mcpb` and
  validates it, and each release attaches it.

**Out of scope, for later changes:**
- diagrams and tables (`show_structure`);
- editing directly in the timeline;
- remote HTTP mode, OAuth, several users;
- ChatGPT;
- Open WebUI through MCP;
- a fully dark timeline: in a dark host, the timeline stays a readable light card, as it already
  does in pi-outpost.

## Capabilities

### New Capabilities

- `mcp-planning-app`: a local MCP App that keeps a person's plannings in a folder they pick, edits
  them through validated targeted operations, shows them as an interactive timeline in MCP Apps hosts,
  and lets the model know what the person selected.

### Modified Capabilities

None at the requirement level. Moving the shared core out of `openwebui/` changes no observable
behaviour of the Open WebUI server: its specs are unchanged and its tests must keep passing as they
are.

## Impact

- **New packages:**
  - `apps-core/` (`@pi-outpost/apps-core`, private): the shared core, extracted from `openwebui/src`;
  - `mcp/` (`@pi-outpost/mcp`, private): the MCP server, its MCP Apps view, the `.mcpb` manifest and
    build.
- **`openwebui/`** imports the core instead of holding it, with no behaviour change.
- **Dependencies:** `@modelcontextprotocol/server` and `@modelcontextprotocol/ext-apps` (official
  SDKs). The `mcpb` CLI is run on demand at a pinned version when packing, not installed.
- **CI and release:** build the `.mcpb`, validate it, smoke-test it over stdio, and attach it to the
  GitHub Release.
- **Docs:** `docs/claude-desktop.md`, written for the person installing it, and a README entry.
