# Design

## Context

**Prototype, 2026-10-04, throwaway, in the session's scratch area:**
- `@modelcontextprotocol/server` 2.0.0 and `@modelcontextprotocol/ext-apps` 2.0.3 (`registerAppTool`,
  `registerAppResource`; `useApp` on the view side);
- pi-outpost's `TimelineView` and `judgePlanning`, bundled with esbuild (server) and
  `vite-plugin-singlefile` (view, 540 kB, 154 kB gzipped).

**Observed in the reference `basic-host`:**
- the view draws the timeline from the `tool-result`'s `structuredContent`;
- `autoResize` sets the frame to the content;
- `requestDisplayMode("fullscreen")` is granted;
- the theme arrives in the host context;
- `updateModelContext` is accepted.

**Observed in Claude Desktop 2.19675, free plan, installed from a `.mcpb`:**
- the timeline, its scales and full screen work;
- the model never learned of a click, so `update-model-context` does not reach it;
- the directory field's default `${HOME}/Documents/Plannings` greyed out the *Select* button;
- Claude Desktop's bundled Node.js ran the server built with `--target=node20`.

**MCP Apps spec (2026-01-26):**
- a tool may set `_meta.ui.visibility` to `["app"]`; the host then hides it from the model and lets
  only the server's views call it;
- `ui/message` *sends* a user message, which triggers a turn, and is not used here.

**`openwebui/src`** already holds `planning.ts` (gate, item naming), `operations.ts`, `guide.ts`,
`structure.ts` and, in `openapi.ts`, the descriptions and examples.

## Goals / Non-Goals

**Goals:**
- For one person on her Mac: install by double-click, plannings in her folder, the interactive
  timeline, and edits that "it" can refer to.
- The same core as the Open WebUI server, with no copy.

**Non-Goals:** everything in the proposal's out-of-scope list. In particular, no `ui/message`, and no
dark redraw of the timeline.

## Decisions

### A shared `apps-core/` package

- **`@pi-outpost/apps-core`** (private workspace) receives, unchanged in behaviour:
  - `planning.ts`, `operations.ts`, `guide.ts`, `structure.ts`;
  - a new `descriptions.ts` that holds what `openapi.ts` holds today: tool descriptions,
    `CREATION_EXAMPLE`, `UPDATE_EXAMPLE`, `STRUCTURE_EXAMPLES`;
  - `viewer.css`.
- **The guide pages:** `apps-core` also owns the page copy at build, which `openwebui/` and `mcp/`
  both run.
- **`openwebui/`** imports from it. Its tests do not change, and they are the proof the move changed
  nothing.
- **Storage stays per server:** Open WebUI's is per user and hashed; the MCP server's is one person's
  readable folder. Only the operations on a document are shared.
- **Rejected, `mcp/` importing `openwebui/src` directly:** it would make one server's internals the
  other's API.

### Local storage

```
<folder>/Travaux maison.planning.json          current document, pretty-printed (readable)
<folder>/.history/travaux-maison/1.json …      every revision, written once (wx)
<folder>/.history/travaux-maison/meta.json     id, title, current revision, file name, dates
```

- **The id** is a slug of the title (`travaux-maison`), made unique with `-2`, `-3`.
- **The file name** is the title, sanitised: no `/`, `\`, `..`, or control characters, length
  capped. It resolves inside the folder, checked after resolving.
- **Writes:**
  - a new revision is written to history (`wx`);
  - then the planning file and `meta.json` are replaced atomically (temporary file, then rename);
  - updates to one planning are serialised.
- **Edited by hand:** the file is judged on read. An invalid file is reported, with the gate's
  diagnostics, and an update starts from the last valid revision in history. The listing shows such
  a planning as unreadable, never drops it.
- **Starting:**
  - the folder comes from `PLANNINGS_DIR`, set by the `.mcpb` from the user's choice;
  - it is created if missing;
  - it must be absolute; the server refuses a missing or relative one, naming `PLANNINGS_DIR`.

### Tools

| Tool | Visible to | Answer |
|---|---|---|
| `list_plannings` | model | text: titles, ids, revisions, and unreadable ones with why |
| `create_planning` | model | text: id, title, revision 1 |
| `get_planning` | model | text: the document, the revision, **the current selection** |
| `update_planning` | model | text: the new revision; or the refusal |
| `show_planning` | model, app | text summary; `structuredContent` `{id, title, revision, data, comparedWith?}`; `_meta.ui.resourceUri: ui://pi-outpost/planning.html` |
| `read_structure_guide` | model | text: the page |
| `select_in_planning` | **app only** | records `{id, task?, item?}` or clears it |

- Descriptions come from `apps-core/descriptions.ts`, the same text as the Open WebUI server's.
- Answers are text (and structured content), not HTML: MCP hosts show the view from the resource and
  hand the model the text.
- **The selection** lives in the server process (a map from planning id to selection, with a time).
  The host starts one process per conversation, or keeps one; either way a selection made in the
  view is there when the model reads next.
  - `get_planning` reports it as *"Selected in the view: milestone "CDR" (a2-cdr) of task A2,
    2 minutes ago"*.
  - An update that removes the selected item clears it.

### The view

- **The entry:** `mcp/viewer/main.tsx`, with `useApp`.
  - `ontoolresult` draws `TimelineView` from `structuredContent`, with `compareTimelines` applied
    server-side when `comparedWith` is set;
  - `onSelect` sends `app.callServerTool("select_in_planning", …)` and `app.updateModelContext(…)`;
  - a full-screen button calls `requestDisplayMode`.
- **Theme:** taken from the host context. In a dark host the timeline is drawn as a light card with
  dark text, readable as observed, rather than redrawn dark.
- **Build:** single-file Vite build, with React deduplicated and the CSS from `apps-core`. The
  resource declares no CSP domains: everything is inline.
- **Size:** about 540 kB. It is fetched once, as a resource, not stored in the conversation each time.

### The bundle

- **`mcp/manifest.json`** (manifest 0.3):
  - `server.type: node`, entry `server/index.mjs`, started with `--stdio`;
  - `user_config.plannings_dir`: `type: "directory"`, required, **no default**, described as
    "Choose or create a folder for your plannings";
  - `env.PLANNINGS_DIR: ${user_config.plannings_dir}`;
  - `compatibility.platforms` set to darwin and win32.
- **`npm run pack -w @pi-outpost/mcp`** bundles the server (esbuild, `--target=node20`, the same
  `require` banner as `openwebui`), builds the view, copies the guide pages, and runs `mcpb pack` to
  `mcp/dist/pi-outpost-plannings.mcpb`.
- **CI:** build, `mcpb validate`, and a stdio smoke test of the bundled server with a temporary
  folder. That is the `TheBundledServerAnswersOverStdio` scenario.
- **Release:** the `attach` job adds the `.mcpb` to the GitHub Release.

## Risks / Trade-offs

- **A host process per conversation** loses the selection between conversations. It is only meant
  for the next turn.
- **`callServerTool` from the view** is in the spec, but Claude Desktop's support is unverified: the
  prototype did not exercise it. The live round tests it first. If it fails, the fallback is the
  person naming the item, as today.
- **Files edited by hand** can conflict with an update in flight. Single user, serialised writes, and
  the revision check make that a refusal, not a loss.
- **Claude Desktop's Node.js version** is unknown, so the bundle targets node20, which the prototype
  ran on.
- **Extracting the core touches `openwebui/`.** Its unchanged test suite and image check are the
  guard.

## Migration Plan

- `apps-core` extraction first, released with no behaviour change.
- Then `mcp/`.
- Users of the Open WebUI server see nothing.

## Open Questions

None blocking. Whether `callServerTool` works in Claude Desktop is settled by the first live task.
