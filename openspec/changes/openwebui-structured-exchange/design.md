# Design

## Context

- **pi-outpost's `present_structure`** (`server/src/structuredExchangeTool.ts`) takes a document as a
  JSON string, plus a required `summary`.
  - **The gate:** `parseSerializedStructuredExchange` with the committed schema and the deployment's
    limits. In a project that registers profiles, `holdToProfile` follows; with no registry (state
    `none`) the core contract alone applies.
  - **Refused:** the rule and the pointer go back to the model.
  - **Accepted:** the interface renders the document with `StructuredExchangeDocument`.
- **`StructuredExchangeDocument`** (`ui/src/presentations/StructuredExchangeView.tsx`) needs:
  - an `envelope`, already validated;
  - its `source`;
  - optional `rawOutput` and `conformance`;
  - a `dispatch`, used only to open a file a document points at (`openFile`);
  - `StructuredAppearanceContext`, which is optional: no provider means default colours.

  It owns every kind's rendering, viewpoints, the proposal rendering, the text view and the exports
  (`downloadMarkdown`, `downloadCsv`, `downloadXlsx`, and SVG through the figure code shared with the
  server).
- **The planning server (#274)** has:
  - a trust hook that runs before every route;
  - an OpenAPI document built from `openapi.ts`;
  - the embed technique (`embed.ts`: gzipped and base64-encoded payloads, a bootstrap with no `&`);
  - one Vite entry, `openwebui/viewer/main.tsx`, mounting `TimelineView`.
- **Open WebUI v0.11.4:**
  - it shows an inline HTML tool answer in an iframe with `sandbox="allow-scripts allow-popups
    allow-downloads"`;
  - it hands the model only "Embedded UI result is active", never the answer;
  - the tool call's arguments stay in the conversation, so the model can read back the document it
    showed.

## Goals / Non-Goals

**Goals:**
- Parity with `present_structure` for what a reader sees and what a model is told.
- No second implementation: the gate, the rendering and the exports are imported.
- A model in Open WebUI writes valid documents of each kind from the tool description alone.

**Non-Goals:**
- Storing documents, or targeted edits of graphs.
- Profiles and rules.
- Applying a proposal. The contract says no approval action exists here.
- Writing figures or tables as files.
- Structured-exchange fences inside replies.

## Decisions

### `show_structure` beside the planning tools, not a generalised store

- **Choice:** a stateless route `POST /show_structure { document, summary? }`. It sits behind the
  existing trust hook; the identity is required although nothing is stored, so that the server has
  one rule and no exception.
- **Rationale:** it is `present_structure`'s behaviour. Generalising the planning store to every kind
  would mean designing targeted edits per kind, which belongs to a later change.
- **Alternative rejected:** a stateless route outside the trust hook. It would be the server's only
  unauthenticated surface besides the OpenAPI document, for no gain.

### The gate is pi-outpost's, without profiles

- **Choice:** `parseSerializedStructuredExchange(serialized, checkStructuredExchangeSchema)` with the
  contract's own ceilings. This is what pi-outpost does in a project that registers no profiles.
- **Documents naming a profile:** a `profile` named by a version 2 document is not enforced, exactly
  as in such a project.
- **Input:** an object, or a string holding JSON. A string is parsed through the same function
  (`parseSerializedStructuredExchange` takes the string), so the byte ceiling applies before
  `JSON.parse`. Weak models send either form.

### `summary` is optional here

pi-outpost requires a summary because the structured payload never reaches the model again. In Open
WebUI the payload is the tool call's argument, which stays in the conversation. A required summary
would be a cost with no reason, so it is accepted and ignored for display.

### One viewer, two modes

- **The entry:** `viewer/main.tsx` reads `{ mode: "planning" | "structure", … }` from the payload:
  - `planning` mounts `TimelineView` as today, with `onSelect` prompting;
  - `structure` mounts `StructuredExchangeDocument`, with `source` (the validated document,
    stringified), `rawOutput` absent, and a `dispatch` that ignores `openFile` (no project files
    here).
- **The page:** the same bootstrap and packing as #274, so the "no `&`" property and the sandbox
  behaviour hold for both modes.
- **Size:** the bundle grows (table exports, viewpoints, sequence rendering). It is measured in the
  first task. If the gzipped embed passes about 400 kB, the XLSX export is split out and loaded only
  on use, from the same page — never from the network.
- **No prompt pre-fill for structures in this change.** The rendering has no selection callback to
  hook. Adding one is a separate, additive `ui/` change if it is wanted.

### No apply, said in the description

The description tells the model that a proposal is shown for the user to judge, and that applying it
is not something this tool does. That way it does not claim "the change has been applied".

### Examples from unrelated subjects

The description carries a minimal:
- graph (a library's lending process);
- sequence (a parcel locker exchange);
- table (lab sample tracking);
- proposal (a change to the graph).

None resembles a typical request (#274's finding: Codestral copied a resembling example's labels and
dates). The tests run each example taken from the published document.

## Risks / Trade-offs

- **Bundle size.** Each show stores the embed in the chat. Mitigation: measure, then split the XLSX
  export if needed.
- **The rendering assumes a project in places.** `dispatch`, and resource targets that link to files.
  Mitigation: an `openFile` dispatch that does nothing. Links to files in a document render as text
  where nothing can open them. Checked in the browser tests.
- **Downloads in a sandboxed, opaque-origin frame.** `allow-downloads` is set by Open WebUI, but a
  blob-URL download from an opaque origin is checked in a real browser, not assumed.
- **Model quality.** Graphs and sequences are larger to write than plannings. Mitigation: the
  refusal loop, examples in the description, and one live run per kind with Codestral.

## Migration Plan

Additive. `show_planning` is unchanged for users. The viewer gains a mode, and older embeds stored in
chats keep working, since each embed carries its own viewer.

## Open Questions

None blocking. Whether to store and edit graphs, as plannings are, is left to a later change once this
one is used.
