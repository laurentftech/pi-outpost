## Context

See proposal.md for the motivation. What the approach rests on:

- `MarkdownPre` (`ui/src/components/Mermaid.tsx`) already decides, per fenced block of a reply, whether
  to draw it (Mermaid) or show it as code. It is the one place a block's rendering is chosen.
- The browser already validates the whole core contract — schema and semantic rules — through
  `checkStructuredExchangeSchemaInBrowser`. `readStructuredExchangeFile` (used by the file viewer) tells
  "not a structured-exchange document" from "a version we do not implement" from "declares the schema and
  fails it", which is exactly the three-way split a reply block needs.
- `StructuredExchangeDocument` (`ui/src/presentations/StructuredExchangeView.tsx`) renders a validated
  envelope with its controls, textual equivalent, exports and conformance statement.
- Profile conformance is established only by the server (`structuredConformanceFor`), against the project
  registry as it is now, and announced after the message that carried the document
  (`announceStructuredConformance`, keyed by `toolCallId`). Assistant items carry no id.

## Goals / Non-Goals

**Goals:**
- The same view, validation and profile statement for a document whether it arrived through the tool or
  inline. Nothing a reader relies on for a presented document is missing from an inline one.

**Non-Goals:**
- Feeding diagnostics back to the agent — the tool already does that, and doing it for inline blocks needs
  another turn.
- Approval hand-off (embed `onApproval` and similar) for inline proposals.
- Detecting documents outside a ```` ```json ```` fence, or in other fence languages.

## Decisions

### Detection and validation in the browser, in `MarkdownPre`

For a fenced block whose `code` child has `language-json`, `MarkdownPre` passes the text to
`readStructuredExchangeFile`. A valid document is drawn with `StructuredExchangeDocument`; "not ours" is
code; "unsupported version" or "invalid" is code under one line naming the first issue. An incomplete
block during streaming is not parseable JSON, so it reads as "not ours" and stays code until it is
complete — no streaming flag is needed, and no half document is ever drawn.

*Alternative: validate on the server and send the envelope.* Rejected: the browser validator is the one
every presented document already goes through, and a server round trip would add a message for something
the client can decide alone.

### Profile statement keyed by the block's content

The server finds the same blocks in each finished assistant message and in restored history (a shared
`structuredExchangeBlocks(markdown)` that both sides use, so they cannot disagree about what a block is),
runs `structuredConformanceFor` on them, and announces each statement as
`{ type: "reply_structured_conformance", key, conformance }` — after the message, like the tool's. The key
is a short content hash (`replyBlockKey(text)`, FNV-1a over the exact block text, in shared). The client
keeps `key → conformance` and hands it to the block that hashes to it.

A content key rather than a position: assistant items have no id, and a position (message index, block
index) shifts with compaction, forks and history trimming. Two identical blocks share one statement,
which is right — the statement depends on the document and the registry, nothing else.

### Copy control on code blocks

`CopyButton` gains an icon-only form (`⧉`, `✓` once copied, labelled "Copy code"). `MarkdownPre` wraps a
code block in a positioned container and places it in the top-right corner. The copied text is the
block's code content, read the way `mermaidCode` reads a Mermaid block, so the fence and info string are
never included.

## Risks / Trade-offs

- [A reader cannot tell an inline document from a presented one] → acceptable: both went through the same
  validation, and the source is reachable. The profile statement is the same.
- [Hashing every JSON block on every render] → only ```` ```json ```` blocks, memoised per text.
- [The model is never told its inline document was wrong] → the failing block says why to the reader; the
  tool remains the path that corrects the agent.
