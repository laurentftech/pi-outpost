# Scenario coverage

All 10 `#### Scenario:` entries in `specs/agent/spec.md`, enumerated with
`rg '^#### Scenario:' openspec/changes/publish-a-document-extractor-when-a-document-arrives/`.
The requirement is ADDED, so every scenario is new work.

Test files:

- `server/test/documentTools.test.ts` (`unit`) — what a prompt is read to call for
- `server/test/documentToolsWire.test.mjs` (`wire`) — a real server and a real embedded
  session, asserting the tool list the **provider was sent**: what the snapshot claims the
  server published is a second-hand account, and what reached the model is what costs
  tokens and what can be called
- `verification.md` (`live`) — one run against a real model

| Scenario | Status | Where | What would fail |
|---|---|---|---|
| A code session publishes no extractor | covered | `wire`: "a document extractor is published when a document is named, and not before" — `server/test/documentToolsWire.test.mjs` | The workspace is created **with** a `report.docx`, and the snapshot must carry none of the four active while still carrying `read`. Publishing from workspace contents — the design this change rejects — fails here. |
| Naming a document publishes its extractor, before the turn | covered | `wire`: same test | The turn naming `report.docx` must reach the provider **already carrying** `docx_extract`. Publishing after dispatch, or from a queued read, leaves it absent from the request that named it. Corroborated by `live`, where the model called it on the first attempt. |
| An attached document publishes its extractor | covered | `unit`: "a mention is matched wherever a path can appear" — `server/test/documentTools.test.ts` | The composer appends an attachment as an `@path` mention and the server absolutises it, so the attachment case *is* the path case. `@/srv/projects/acme/report.pdf` must resolve to `pdf_extract`, and so must `report (1).pdf` and `report[final].docx` — the names a browser and a colleague actually produce. The first version of the matcher excluded parentheses and brackets and silently failed on exactly those; Codex caught it. |
| A tool published on a wrong guess is withdrawn when the turn ends | covered | `wire`: same test, third phase | A turn names the document and never calls the tool; the next request must not carry it. This caught a real bug: the idle check read the runtime *after* publishing, so nothing was ever counted and nothing was ever withdrawn. |
| A tool that was used survives the quiet turns around its work | covered | `wire`: same test, the five-turn loop | The provider is scripted to call `docx_extract` when the prompt says so; each of the next five turns must still be sent it — the turn that called it is not one of its idle turns, an off-by-one Codex caught. Withdrawing after use — the variant considered and rejected — fails on the first of them, and would strand an agent mid-extraction. |
| A tool nobody has wanted for five turns is forgotten | covered | `wire`: same test, sixth quiet turn | The fifth idle turn's request must not carry it. A tool kept for the session — the previous design — fails here, and with it the saving on every long conversation that opened one document early. |
| Naming the document again brings its extractor back | covered | `wire`: same test, last phase | After the withdrawal, a prompt naming `report.docx` must put it back. Without this the withdrawal would be a one-way door, and the failure it causes is silent: nothing tells an agent a tool has gone. |
| A workspace holding documents publishes nothing by itself | covered | `wire`: same test, first assertion | The same `report.docx` on disk, no prompt naming it, nothing published. |
| The word is not the path | covered | `unit`: "the word is not the path" | "convert this to PDF", "the pdf spec is long", "refactor src/pdf.ts", "docx handling is a mess" and "we support pdf, docx, xlsx and pptx" must all publish nothing. A matcher on the bare extension puts all four back into every conversation that merely discusses documents. |
| A runtime that cannot gate publishes them all | covered | `unit`: "the exported set is what the server withholds and republishes" — with `RpcRuntime.setToolPublished` returning `false` and `server/src/piOutpostTools.ts` registering all four | The RPC child registers every extractor and its runtime refuses to gate, so they are published throughout. A runtime that returned `true` without gating would be a lie no test could catch; it returns `false`. |

## Measurement

The four definitions are 8 249 characters of the 23 897 a session's tools come to. A session
that names no document therefore carries 15 648 characters of tools and 7 134 of system
prompt: **~5.7k tokens against ~7.8k**.

`server/scripts/probe-context-baseline.mts` (on the comparison branch) still reports the
undivided figure — it builds its own session with every tool active. It should learn the two
states when that branch lands.
