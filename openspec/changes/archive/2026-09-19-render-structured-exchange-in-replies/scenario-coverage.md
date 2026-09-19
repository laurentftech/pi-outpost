# Scenario coverage — render-structured-exchange-in-replies

Interface scenarios render the real `AssistantMessage` in jsdom with a reply's Markdown and read back what is drawn,
what stays code, and what the copy control writes. Profile scenarios run over a real server with a scripted RPC agent
whose restored and live replies carry ```` ```json ```` blocks, against a project registry on disk; the statement is
matched to its block by `replyBlockKey`, the key the interface computes. Block detection and keys are unit-tested in
`server/test/structuredExchangeReplyBlocks.test.ts`. All of it was also driven in the running standalone app.

## Capability: `structured-exchange-in-replies` (8 scenarios)

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| AValidBlockIsDrawn | covered | `ui/src/components/ReplyStructuredExchange.test.tsx` — "is drawn in place of the JSON, with its textual equivalent and its source": the block is drawn and no code block remains; the text equivalent names the elements and the relationship label; the envelope pane parses back to the document written |
| OrdinaryJsonStaysCode | covered | `ui/src/components/ReplyStructuredExchange.test.tsx` — "leaves JSON that declares no structured-exchange schema as code": no drawing and no refusal line, and the code block shows the JSON; "leaves a document in another fence language as code" |
| ARestoredReplyIsDrawnToo | covered | `server/test/replyStructuredConformance.test.mjs` — "a block in a restored reply, and one in a live reply, are each told whether they conform": the `hello` carries the restored reply with its block as written, and a statement keyed to it follows; `ui/src/components/ReplyStructuredExchange.test.tsx` — "draws the block in a restored reply as it did live" |
| AStreamingBlockIsDrawnWhenComplete | covered | `ui/src/components/ReplyStructuredExchange.test.tsx` — "stays code while it is still arriving, and is drawn once it is whole": half the document renders as a code block with no drawing and no refusal line; rerendered whole, it is drawn |
| AFailingBlockSaysWhy | covered | `ui/src/components/ReplyStructuredExchange.test.tsx` — "stays code under a line naming the first rule it breaks when it fails": an edge to an undeclared node yields the "could not be drawn" line naming it, the code block, and no drawing; "says a version it does not implement is why it is not drawn" |
| AConformingBlockSaysSo | covered | `server/test/replyStructuredConformance.test.mjs` — same test: the restored conforming block's statement is exactly `{ profile: "acme/requirements", state: "conforms", openValues: 0 }` (verified red with the announcement removed); `ui/src/components/ReplyStructuredExchange.test.tsx` — "carries the server's profile statement for exactly that block, and none without one" shows it on the drawn block |
| AStrayingBlockSaysSo | covered | `server/test/replyStructuredConformance.test.mjs` — same test: the live reply's block with a value outside the closed enumeration gets `state: "strays"` for `acme/requirements` after `assistant_end` |
| AProjectWithoutProfilesSaysNothing | covered | `server/test/replyStructuredConformance.test.mjs` — "a project that registers no profile says nothing about a block": no `reply_structured_conformance` arrives; `ui/src/components/ReplyStructuredExchange.test.tsx` — the block is drawn with no statement when none is held |

## Capability: `components` (1 scenario)

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| CopyingACodeBlock | covered | `ui/src/components/ReplyStructuredExchange.test.tsx` — "copies the block's content without its fence, and says it copied": the clipboard receives exactly the two lines of code, and the control's name becomes "Copied"; "offers one on each code block" counts one control per block |
