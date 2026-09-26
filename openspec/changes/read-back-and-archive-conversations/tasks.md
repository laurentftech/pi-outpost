# Tasks

## 1. Protocol and runtime surface

- [x] 1.1 Add `history_before` and its reply to `shared/src/protocol.ts`, with the server-side bound on `count` as a shared constant, and verify the shared package type-checks and the constant is imported by both sides rather than duplicated
- [x] 1.2 Add the compaction-boundary `ChatItem` kind and the read-only flag on items to `shared/src/protocol.ts`, and verify existing clients type-check unchanged (both fields optional)
- [x] 1.3 Add the snapshot's count of preceding items, and verify a snapshot built for a never-compacted session omits it
- [x] 1.4 Add an optional branch-entries capability to `AgentRuntime` (`server/src/agentRuntime.ts`) alongside `navigateTree?`, and verify the Pi RPC runtime compiles without implementing it

## 2. Server: serve the conversation's own branch

- [x] 2.1 Implement the branch-entries capability on the embedded runtime over `sessionManager.getBranch(leafId)`, and verify with a server test that it returns entries from before a compaction point that `contextEntries()` omits
- [x] 2.2 Convert the pre-context prefix into items through `historyToItems`, and verify a test asserts a recovered tool call, image reference and diagram produce the same items as the live conversion of the same messages
- [x] 2.3 Cache the prefix item list per session file and leaf id, invalidated on `compaction_end`, leaf move and session change, and verify a test that compacts, then asks again, gets the new prefix rather than the cached one
- [x] 2.4 Handle `history_before` in `server/src/index.ts`: serve the window before `have`, clamp `count`, report what remains, answer only the requesting socket — verify with a two-client harness test that the second client's transcript is untouched
- [x] 2.5 Refuse a stale request (session switched, forked or compacted since) and verify the refusal names the reason and sends no items
- [x] 2.6 Answer `history_before` with an unavailability reply on a runtime without the capability, and verify a test asserts no partial branch is returned

## 3. The compaction boundary in the transcript

- [x] 3.1 Stop skipping compaction summaries in `server/src/convert.ts` and emit the boundary item carrying the retained summary; verify a convert test places it between the summarised prefix and the kept items
- [x] 3.2 Render the boundary in the conversation, and verify a component test shows it for a compacted session with no items loaded and shows nothing for a session that was never compacted

## 4. Reading back in the interface

- [x] 4.1 Add the older-items request and reducer handling to `ui/src/useAgent.ts` (prepend, remaining count, in-flight guard, failure leaves the transcript intact), and verify unit tests cover a successful prepend, a double activation and a failed request
- [x] 4.2 Add the control above the transcript with its accessible name, present only while items remain, and verify a test asserts its absence at the beginning of a conversation and after the last chunk loads
- [x] 4.3 Preserve the reading position across a prepend by restoring the scroll offset from the scroll-height delta, and verify a test asserts the previously oldest item keeps its screen position and that the view does not jump to the end
- [x] 4.4 Hide the control where the runtime lacks the capability, and verify a test with an unavailable-capability snapshot offers no control

## 5. Recovered items are read-only

- [x] 5.1 Disable the edit and fork actions on items carrying the read-only flag, and verify tests assert neither action is offered on a recovered user message while copy, file-open and figure-enlarge still work
- [x] 5.2 Verify the conversation filters apply to recovered items, with a test that hides tools and reasoning over a transcript containing recovered items of both kinds

## 6. The HTML document

- [x] 6.1 Add `rehype-stringify` (or `hast-util-to-html`) to `ui/package.json` and verify the export module is reached only through a dynamic import, by checking the built main chunk does not contain it
- [x] 6.2 Write the conversation-to-HTML renderer over the item model: user, assistant, tool and boundary items, authorship in reading order, tool calls as folded `<details>`, and verify unit tests over each item kind
- [x] 6.3 Run message markup through the transcript's own pipeline (`remark-gfm`, `remark-math`, `rehype-raw`, `rehype-sanitize` with `chatHtmlSchema`) with KaTeX emitting MathML, and verify tests assert a script, an inline handler, a `javascript:` URL, a form, an iframe and a remote stylesheet reference are all absent from the output while an equation renders as MathML
- [x] 6.4 Verify with a test that markup in a message cannot close an element the document opened or inject an attribute outside its own message
- [x] 6.5 Embed workspace images as `data:` URIs through `loadReferencedImage`, and diagrams as inline SVG with styles inlined through `mermaidToImage`, and verify tests assert the document references nothing outside itself and that an undrawable diagram leaves its source text
- [x] 6.6 Write the document's inline stylesheet with a `prefers-color-scheme` dark variant and verify a test asserts both colour schemes are defined and no external font or stylesheet is linked
- [x] 6.7 Write the document header (project, session, date, model) and verify a test asserts each is present

## 7. Exporting

- [x] 7.1 Fetch the whole history for the export independently of the loaded window, looping `history_before` until nothing remains, and verify a test asserts the exported document contains items the transcript never displayed
- [x] 7.2 Refuse the export when history cannot be completed (unavailable capability, failed chunk): report it and hand over no file — verify tests for both paths
- [x] 7.3 Bound the embedded content and, past the budget, stop and name what exceeded it; verify a test asserts no document is produced with images silently missing
- [x] 7.4 Add the export action with its in-progress state, absent for an empty conversation, naming the download after the session; verify a test asserts the file name, the progress state, and that the conversation, its draft and its session are untouched

## 8. The running application

- [x] 8.1 Rebuild `web`, then `@pi-outpost/embed`, then `build:e2e-host`, run `npm run bench`, and drive a real compacted conversation: load older messages repeatedly to the first message, and read back the DOM to confirm the reading position never moved and the boundary sits where compaction happened
- [x] 8.2 Export from the bench and open the downloaded file from disk with no network and scripting disabled, verifying by reading the rendered DOM that the whole conversation, its images, diagrams and equations are shown
- [x] 8.3 Monkey-test the transitions: spam the load-more control, switch project and session mid-request, fork and navigate the tree with older items loaded, export while a turn is streaming, compact while paginating, and abort an export midway — report what broke, reading back the DOM after each burst
- [x] 8.4 Verify no stale-context defect: with two projects open, load older items in one and confirm the other's transcript and export are unaffected, and that an export started in one project cannot be handed a file built from the other's history

## 9. Documentation, coverage and validation

- [ ] 9.1 Reread every new test for the Windows failures listed in CLAUDE.md (paths built as strings, line endings, spawning) and verify expected paths are built with `path.join`
- [ ] 9.2 Update `README.md`'s feature list and the conversation documentation for reading back and for the HTML export, and verify documented behaviour against the implementation
- [ ] 9.3 Write `openspec/changes/read-back-and-archive-conversations/scenario-coverage.md` classifying every `#### Scenario:` of the three deltas, enumerated with `rg '^#### Scenario:' openspec/changes/read-back-and-archive-conversations/specs/`, and verify `npm run check:scenarios` passes
- [ ] 9.4 Run `npm run lint`, the server and ui suites, and `npx openspec validate read-back-and-archive-conversations --strict`, and verify all pass
