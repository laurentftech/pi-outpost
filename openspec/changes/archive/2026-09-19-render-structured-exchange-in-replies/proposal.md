## Why

Some models — gemma-4, seen in use — answer a request for a diagram or a model by writing the
structured-exchange document straight into their reply, as a ```` ```json ```` block declaring
`"schema": "urn:structured-exchange:…"`, instead of calling `present_structure`. The reader then gets a
wall of JSON where the same document, presented through the tool, would have been drawn. The document is
often valid; only the way it was delivered differs.

Separately, a plain code block in a reply can only be copied by selecting it by hand, or by copying the
whole message.

## What Changes

- **A structured-exchange block in a reply is drawn.** A complete ```` ```json ```` block whose JSON
  declares a structured-exchange schema is validated in the browser against the same contract as a
  presented document and, when it passes, rendered with the same view a presented document gets — graph,
  sequence or table, the reader's controls, the textual equivalent, derived exports — with its source one
  click away. Any other JSON block stays code.
- **Held to the project's profile, like a presented one.** In a project that registers profiles, the block
  carries the same statement a presented document carries — conforms, strays, or could not be checked —
  established by the server against the registry as it is when the reply is shown, live or restored.
- **A block that fails stays readable, and says why.** A block that declares the schema and fails
  validation, or declares a version this application does not implement, stays as code, with one line
  saying it is a structured-exchange document that could not be drawn, and the first reason.
- **While the reply streams**, a block that is not yet complete is shown as code; it is drawn once it is.
- **Copy on every code block.** Every code block in a reply gets a copy icon in its top-right corner.

Out of scope: telling the agent that its inline document was invalid (that needs another turn), and
handing an inline proposal on for approval through the embed API — both stay the tool's.

## Capabilities

### New Capabilities
- `structured-exchange-in-replies`: detecting, validating, rendering and profile-checking a
  structured-exchange document written in an assistant reply, and how it falls back.

### Modified Capabilities
- `components`: `AssistantMessage` offers a copy control on each code block.

## Impact

- `ui/src/components/Mermaid.tsx` (`MarkdownPre`, which already chooses a rendering per fenced block),
  a new inline structured-exchange block component reusing `StructuredExchangeDocument` and
  `readStructuredExchangeFile`, `CopyButton` (icon-only form).
- `server/src/index.ts`: finding structured-exchange blocks in assistant replies and announcing their
  profile statement, live and on snapshot; `shared/src/protocol.ts`: a statement keyed by the block.
- `ui/src/useAgent.ts`: holding those statements.
- Docs: `docs/structured-exchange.md` (what a reader sees when a document arrives inline).
