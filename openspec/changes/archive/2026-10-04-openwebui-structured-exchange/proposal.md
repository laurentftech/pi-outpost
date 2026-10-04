# Proposal

## Why

The Open WebUI tool server (#274) shows planning timelines, but pi-outpost's structured exchange is
wider: graphs, sequences, tables, viewpoints, and proposals that show what a change would do. A model
in Open WebUI can describe an architecture or a data flow, but it cannot show one. Porting pi-outpost's
`present_structure` closes that gap. The contract, its validation and its rendering already exist
and are free of pi, so the cost is an adapter, not a second implementation.

## What Changes

- **A new tool, `show_structure`, on the planning server.** It takes any structured-exchange document
  — every kind (graph, sequence, table, timeline) and every version, including a proposal that names a
  target — and judges it with exactly the gate pi-outpost's `present_structure` applies.
  - **Accepted:** it is shown in the chat as the rendering pi-outpost draws. That includes diagrams,
    sequences, tables and timelines; viewpoints; a proposal as what it would change; the text view;
    and the exports the reader already has (SVG figure, Markdown, CSV and XLSX table).
  - **Refused:** the model receives pi-outpost's own diagnostics, so it can correct the document and
    call again within the turn.
- **Stateless, like `present_structure`.** Nothing is stored on the server. Open WebUI keeps the embed
  with the chat, and the document stays in the conversation as the tool call's argument. Storing and
  editing graphs over time, as plannings are, is a later change.
- **No approval action.** The contract states that this system shows proposals and does not apply
  them. A proposal is shown so a person can judge it, and nothing on the page offers to apply it.
- **One viewer for both tools.** The embedded viewer that draws plannings also draws structures. The
  trust boundary, the delivery (compressed, no `&`, sandboxed) and the image stay as #274 built them.
- **Teaching the model in the tool's own description,** since Open WebUI has no pi skill:
  - a complete, minimal example of each kind, and of a proposal;
  - examples taken from unrelated subjects, because weak models copy examples that resemble the
    request.

  Tests run every example.

**Out of scope, for later changes:**
- storing and editing graphs;
- project profiles and rules (`present_project_model`);
- writing figures and tables as files (needs a way to hand a file to the user);
- structured-exchange blocks inside a reply (needs an Open WebUI filter function);
- any apply action.

## Capabilities

### New Capabilities

- `openwebui-structured-exchange`: showing any validated structured-exchange document in an Open WebUI
  chat, with pi-outpost's verdicts and rendering, and nothing stored.

### Modified Capabilities

None. The structured-exchange contract and its rendering are reused unchanged. The planning server's
own requirements, archived from #274, are not changed: `show_structure` sits beside the planning tools
under the same trust boundary.

## Impact

- **`openwebui/src`:**
  - a new route and a generic judge, beside the planning one;
  - an extended OpenAPI description.
- **`openwebui/viewer`:** a second mode that mounts `StructuredExchangeDocument`. The bundle grows; how
  much is measured, and it stays compressed in the embed.
- **`ui/`:** nothing should need to change. If something does (for instance a prop that assumes a
  pi-outpost project), it is an additive, optional change, as `onSelect` was in #274.
- **Tests and docs:**
  - server tests;
  - browser tests in Open WebUI's sandbox, one per kind and for a proposal and the exports;
  - the image check;
  - `docs/openwebui.md` and `docs/openwebui-architecture.md`.
