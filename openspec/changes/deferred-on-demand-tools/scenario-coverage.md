# Scenario coverage

Inventory: `rg '^#### Scenario:' openspec/changes/deferred-on-demand-tools/` lists 27 scenarios: 8 from the three added requirements, and 19 carried by the two modified ones. All 27 are below. OpenLore's `orient` was not available (`npx` would not install it without a prompt), so the surface was found with `rg` over `server/src` and the SDK's tool-search extension. The on-demand set is imported from production (`DEFERRED_TOOLS`), not listed by hand. Wire tests run a real server and a real session, and assert what the provider was sent (`server/test/fixtures/scripted-tools-provider.mjs` records the declared tools, whether the prompt carries the hint, and the tool results).

## Added requirements

| Scenario | Status | Tests and assertions |
|---|---|---|
| A code session declares none, and can still reach them | covered | `server/test/deferredToolsWire.test.mjs` "A code session declares none, and can still reach them": the first request declares no tool of `DEFERRED_TOOLS`. The extension tool in `server/test/fixtures/reach-xlsx-extension.mjs` calls `xlsx_extract` through `ctx.executeTool()`, and the result handed back starts `isError=false` and holds the workbook as a table. A withheld `direct` tool, the state before this change, comes back as an unknown-tool error. |
| Searching loads the tool for the next call | covered | `server/test/deferredToolsWire.test.mjs` "Searching loads the tool for the next call": `xlsx_extract` is absent from the request that calls `tool_search`, and declared on the next request of the same turn. |
| A user's words find each kind | covered | `server/test/deferredTools.test.ts` "A user's words find each kind": the real `tool_search` (SDK `createToolSearchExtension`, its BM25 ranker) over every definition the RPC child registers, deferred, at the default limit. "Excel", "Word document", "PowerPoint", "PDF", "Outlook email", "read an Excel spreadsheet" and "project model" each load their tool. With "Excel" removed from `xlsx_extract`'s description the "Excel" case fails, as checked. |
| The system prompt says where the tools are | covered | `server/test/deferredToolsWire.test.mjs` "A code session declares none, and can still reach them" asserts `tool_search` declared and the hint in the prompt the provider received. `server/test/system-prompt.test.ts` asserts the composition order, the line naming Word, Excel, PowerPoint, PDF, email and the project model, and its absence under an allowlist that leaves `tool_search` out. `server/test/sandboxDefaultTools.test.mjs` asserts `tool_search` active in a sandboxed session without `defaultTools`. |
| Without extensions nothing is added | covered | `server/test/deferredToolsWire.test.mjs` "Without extensions nothing is added": with `noExtensions`, the request declares no `tool_search` and the prompt has no hint. `server/test/system-prompt.test.ts` "says where the deferred tools are only where tool_search can load them" asserts the same composition with `noExtensions: true`. |
| A loaded tool survives the turn that loaded it | covered | `server/test/deferredToolsWire.test.mjs` "A loaded tool survives the turn that loaded it": a turn searches "Excel" then calls `xlsx_extract`, and the next turn's request still declares it. With the `tool_end` enrolment removed it fails, as checked: the reassertion withdraws the untracked tool. |
| A loaded tool nobody calls is withdrawn | covered | `server/test/deferredToolsWire.test.mjs` "A loaded tool nobody calls is withdrawn": a search for "PDF document" declares `pdf_extract` and the rest of what it loaded; the next turn declares none of them. |
| The RPC child loads and keeps a searched tool | covered | `server/test/deferredToolsWire.test.mjs` "The RPC child loads and keeps a searched tool, and declares none before", over a real `pi --mode rpc` child: `xlsx_extract` is declared on the request after the search, and still on the next turn. `server/test/piOutpostTools.test.ts` "registers the same tools when the env var is set" asserts every `DEFERRED_TOOLS` definition registered `deferred`, every other one unchanged, and `tool_search` switched on once at `session_start`. |

## Modified requirement: A document extractor is published when a document arrives

These rules are unchanged; publishing a deferred tool goes through the same `setActiveToolsByName`, and the existing suites pass on it.

| Scenario | Status | Tests and assertions |
|---|---|---|
| A code session publishes no extractor | covered | `server/test/documentToolsWire.test.mjs` "a document extractor is published when a document is named, and not before": a workspace holding `report.docx`, and none of the four extractors active in the snapshot nor sent in the first request. |
| Naming a document publishes its extractor, before the turn | covered | `server/test/documentToolsWire.test.mjs`, same test: the turn naming `report.docx` reaches the provider carrying `docx_extract`, and not the other kinds. |
| An attached document publishes its extractor | covered | `server/test/documentTools.test.ts` "a mention is matched wherever a path can appear": an `@path` attachment mention resolves to its extractor. |
| Naming an email publishes the mail extractor | covered | `server/test/documentTools.test.ts` "a named message publishes the mail extractor and nothing else"; over the wire, request 0 of `server/test/mailToolsWire.test.mjs`. |
| An unpacked attachment publishes its extractor within the turn | covered | `server/test/mailToolsWire.test.mjs` "unpacking an attachment publishes its extractor inside the turn": request 1 of the same turn carries `pptx_extract` and `pdf_extract`. |
| Only the kinds actually written are published | covered | `server/test/mailToolsWire.test.mjs` asserts `xlsx_extract` absent; `server/test/documentTools.test.ts` "only the kinds actually written". |
| A path the agent merely names publishes nothing | covered | `server/test/documentTools.test.ts` "a path the agent merely names publishes nothing": `ls` on a `.xlsx`, `read` on a `.pdf`, `find` on a `.msg`. |
| A tool published on a wrong guess is withdrawn when the turn ends | covered | `server/test/documentToolsWire.test.mjs`, third phase: named and never called, the next request carries none of the Word tools. |
| A tool that was used survives the quiet turns around its work | covered | `server/test/documentToolsWire.test.mjs`, the five-turn loop: each request still carries `docx_extract`. |
| A tool nobody has wanted for five turns is forgotten | covered | `server/test/documentToolsWire.test.mjs`, sixth quiet turn: `docx_extract` is no longer sent. |
| Naming the document again brings its extractor back | covered | `server/test/documentToolsWire.test.mjs`, last phase: naming `report.docx` again republishes it. The new way back, by search, is *Searching loads the tool for the next call* above. |
| A workspace holding documents publishes nothing by itself | covered | `server/test/documentToolsWire.test.mjs`, first assertion: `report.docx` on disk, nothing published. |
| The word is not the path | covered | `server/test/documentTools.test.ts` "the word is not the path": prose about PDFs and Word files publishes nothing. |
| A runtime that cannot gate publishes them all | covered | Its title is kept (see design §7); its body now says the RPC runtime declares none of them and declares `tool_search`. `server/test/deferredToolsWire.test.mjs` "The RPC child loads and keeps a searched tool, and declares none before" asserts, over a real child, no `DEFERRED_TOOLS` tool and `tool_search` in the first request, with the hint. |

## Modified requirement: Presentation tools are published with a template or their skill

| Scenario | Status | Tests and assertions |
|---|---|---|
| ACodeSessionPublishesNoPresentationTool | covered | `server/test/presentationToolsWire.test.mjs` "the presentation tools are withheld until a template is named": absent from the fresh session's active tools and from the request of a prompt naming nothing. |
| NamingATemplatePublishesThePresentationTools | covered | `server/test/presentationToolsWire.test.mjs`, same test: the three reach the provider on the turn naming `brand.potx`, and `pptx_extract` does not. |
| LoadingTheSkillPublishesThemInTheTurn | covered | `server/test/presentationToolsWire.test.mjs` "loading the skill publishes the tools inside the same turn". |
| AgentSideTriggersNeverRepublishTheExtractor | covered | `server/test/documentTools.test.ts` "a tool call reaching a deck or a template publishes the presentation tools, never the extractor". |
| TheRpcChildRegistersThePresentationTools | covered | `server/test/piOutpostTools.test.ts` "registers the same tools when the env var is set": the three follow `pptx_extract`, and are registered `deferred` like it. |

## Running app

`web` built, the server started through the test harness with the scripted provider, Chromium driven with Playwright. A prompt whose path is escaped, so it names no `.xlsx`, scripts a search for "read an Excel spreadsheet" and then `xlsx_extract` on the workbook. Results:
- The first request declared no on-demand tool, but did declare `tool_search`, and its prompt carried the hint.
- The next two requests declared `xlsx_extract` and the other tools the search loaded, and the extractor returned the workbook as a table. The tool cards for both calls are in the DOM.
- Two prompts fired back to back declared only `xlsx_extract`, the one that was used.
- A new session declared no on-demand tool, and still declared `tool_search` with the hint.
- No page errors.

What this cannot show is whether a real model thinks of searching. The provider is scripted, and no model credentials were available to this run.
