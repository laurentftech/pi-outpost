## 1. Shared

- [x] 1.1 Add `structuredExchangeBlocks(markdown)` (the ```` ```json ```` blocks declaring a structured-exchange schema) and `replyBlockKey(text)` to shared; verify with unit tests covering nested fences, other languages, and unterminated blocks

## 2. Interface

- [x] 2.1 Draw a valid structured-exchange block in `MarkdownPre` with `StructuredExchangeDocument`, source reachable; keep other JSON as code; verify `AValidBlockIsDrawn`, `OrdinaryJsonStaysCode` in component tests
- [x] 2.2 Show a failing or unsupported block as code under one line naming the first issue, and an incomplete block as code; verify `AFailingBlockSaysWhy`, `AStreamingBlockIsDrawnWhenComplete`
- [x] 2.3 Add the icon-only `CopyButton` and a copy control on every code block; verify `CopyingACodeBlock` (clipboard content without fence, confirmation shown)

## 3. Profile statement

- [x] 3.1 Announce `reply_structured_conformance` for blocks in finished assistant messages and in restored history; hold statements by key in `useAgent` and show them on the block; verify `AConformingBlockSaysSo`, `AStrayingBlockSaysSo`, `AProjectWithoutProfilesSaysNothing`, `ARestoredReplyIsDrawnToo` in a server test and component tests

## 4. Running app, docs, coverage

- [x] 4.1 Drive it in the running app (bench): a reply with a valid block, a failing one, ordinary JSON, a streaming block, copy on a code block; then monkey-test — switch conversations mid-stream, a very large block, two identical blocks, a project whose registry breaks
- [x] 4.2 Update `docs/structured-exchange.md`; verify links
- [x] 4.3 Write `scenario-coverage.md` with every scenario `covered`; run `npm run check:scenarios` and `openspec validate render-structured-exchange-in-replies --strict`
