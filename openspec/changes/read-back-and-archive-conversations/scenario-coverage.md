# Scenario coverage — read-back-and-archive-conversations

Every scenario the three deltas declare, and the assertion that would fail if its contract broke. A
scenario is `covered` only when a test's *assertions* — not its name — check the GIVEN/WHEN/THEN at
the boundary the scenario describes.

Four boundaries, and each answers something the others cannot:

- **`server/test/history.test.ts`** drives the real SDK: a `SessionManager` in a throwaway
  directory, real messages, a real `appendCompaction`. What it pins down is *which* items the
  prefix holds and where the seam falls — read off the SDK's own `getBranch` and
  `buildContextEntries`, not off our idea of them.
- **`server/test/history-wire.test.mjs`** boots the server and talks to it over the socket, with two
  clients. Only here can "answered the requester alone" and "refused a session it no longer holds"
  be asserted at all.
- **`ui/src/useAgent.test.ts` and `ui/src/App.history.test.tsx`** drive the reducer and the rendered
  conversation in jsdom: what is offered, what is disabled, what a failure leaves behind.
- **The running application** (`npm run bench`, Playwright against the built widget, seeded with a
  real compacted session — `scripts/embed-bench.mts`) answers the three things jsdom cannot judge:
  whether the reader's position really holds when content is inserted above them, whether six rapid
  clicks really produce one request, and whether the exported file really opens with no network and
  no JavaScript. The observations are recorded below and in tasks.md §8.

The bench seed was written from a defect it exposed: a fixture whose assistant messages carried no
`usage` crashed the SDK's own context-usage read the moment the branch held a compaction entry
(`calculateContextTokens(message.usage)`, dereferenced unguarded inside the SDK's own context-usage
read). Real replies carry
those counters, so the seed does too — and the upstream fragility is noted in the tests that would
otherwise have hidden it.

## Capability: `conversation-history-pagination` (new, 5 requirements, 27 scenarios)

### Requirement: OlderTranscriptIsServedOnRequest

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| ServesWhatCompactionRemoved | covered | `server/test/history.test.ts` — "recovers the turns compaction removed from the context" first asserts the SDK's own context no longer holds `ask 1` (so the test cannot pass vacuously), then asserts the recovered items are exactly `ask 1 … answer 3`, in order. `server/test/history-wire.test.mjs` — "the snapshot says how much of the conversation is out of context" asserts the live transcript does *not* contain `ask 1` while `olderItems > 0` |
| ContinuousWithWhatTheClientHolds | covered | `server/test/history.test.ts` — "is continuous: consecutive windows rebuild the prefix exactly" walks the prefix in windows of 3 and asserts the concatenation equals the whole prefix, so a gap or a repetition fails. `server/test/history-wire.test.mjs` — "consecutive windows reach the first message with no gap and no repetition" does the same over the wire and asserts every prompt appears exactly once, in order |
| RecoveredItemsMatchLiveRendering | covered | `server/test/history.test.ts` — "recovers a tool call as one card, as the live conversion does" asserts the call and its result merged into a single `tool` item with the right `toolName` and `output`; the same test asserts a recovered prompt keeps its `images` array and a recovered reply keeps its fenced mermaid source. Structurally guaranteed by construction too: `precedingItems` calls `historyToItems`, the function the live transcript uses |
| ReportsWhatRemains | covered | `server/test/history.test.ts` — "serves the items immediately before the ones the client holds" asserts `remaining` is `all.length - 4` then `all.length - 8`; "answers the beginning with nothing rather than an error" asserts `remaining === 0` at the boundary |
| RequestBoundIsClamped | covered | `server/test/history.test.ts` — "clamps a request above the bound and accounts for what it withheld" builds a 150-turn session (asserting the prefix really exceeds the bound), asks for 10 000, and asserts exactly 200 items back with `remaining === all.length - 200` |
| AnswersOnlyTheRequester | covered | `server/test/history-wire.test.mjs` — "the reader is served the items before the ones they hold, and nobody else is" connects two clients and asserts the second received no `history_items` and no `history_unavailable` frame at all |

### Requirement: TheReaderCanAskForOlderMessages

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| OfferedWhenOlderItemsExist | covered | `ui/src/App.history.test.tsx` — "offers to load what compaction removed, saying how much there is" asserts a button named `Load 42 earlier messages` is in the document. Observed in the running app: the bench's seeded session shows `Load 22 earlier messages` (tasks.md §8.1) |
| AbsentAtTheBeginning | covered | `ui/src/App.history.test.tsx` — "offers nothing when the transcript already starts at the first message" asserts `queryByRole` for `/earlier message/` is null with `olderHistory: null` |
| LoadsAChunkAndStays | covered | `ui/src/useAgent.test.ts` — "prepends what the server serves and advances the cursor" asserts the items become `[first, second, kept]` and `olderHistory` becomes `{ remaining: 3, have: 2 }` — still non-zero, so the control stays. `ui/src/App.history.test.tsx` — "asks the agent for the next chunk when activated" asserts the click reaches `loadOlderItems` once |
| DisappearsAtTheBeginning | covered | `ui/src/useAgent.test.ts` — "asks for nothing once the conversation's beginning has been reached" replies with `remaining: 0` and asserts a further activation sends no `history_before` frame. `ui/src/App.history.test.tsx` — "offers nothing once the last chunk has been loaded" asserts the control is absent at `remaining: 0`. Observed in the app: after loading, the control is gone and the transcript starts at `Turn 1` |
| NoDoubleRequest | covered | `ui/src/useAgent.test.ts` — "issues one request while another is in flight" calls `loadOlderItems()` three times in one tick and asserts exactly one `history_before` frame was sent. This test failed on the first implementation (the state mirror is written by an effect, so all three passed the guard) and the synchronous latch in `useAgent.ts` is what it forced. `ui/src/App.history.test.tsx` — "cannot be activated twice for the same chunk" asserts the control is disabled while loading. Observed in the app: six rapid clicks → one request, 29 items, no duplicated message (tasks.md §8.3) |
| FailureLeavesTheTranscriptIntact | covered | `ui/src/useAgent.test.ts` — "keeps the transcript and reports a refusal the reader can retry" asserts the error text reaches `olderHistory.error`, that `items.length` is unchanged, and that `remaining` is untouched so the control is still offered. `ui/src/App.history.test.tsx` — "reports a failure and keeps the transcript, so the reader can retry" asserts the `role="status"` text, the surviving message, and that the control is not disabled |
| KeyboardActivation | covered | `ui/src/App.history.test.tsx` — "asks the agent for the next chunk when activated, including from the keyboard" asserts the control is a `<button>`, enabled, with the accessible name `Load 8 earlier messages`; Enter and Space are the element's own behaviour, and the test asserts the element rather than re-implementing the browser |

### Requirement: LoadingOlderItemsDoesNotMoveTheReader

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| PositionKeptOnInsertAbove | covered | Running app (tasks.md §8.1), which is the only place layout exists: with the reader at the oldest held message, loading grew the scroller by 1638 px, `scrollTop` moved by 1639 px, and the anchored message moved 31 px — it stayed on screen instead of being pushed down by the whole insert. `ui/src/App.history.test.tsx` — "keeps the scroll position by the height the insert added" asserts the correction arithmetic itself in jsdom (stubbed `scrollHeight` 1000 → 1400, `scrollTop` 120 → 520) |
| DoesNotJumpToTheEnd | covered | Running app: after loading, the transcript's first line is `Turn 1: …` with the reader still near the top; `scrollTop` (1639) is far from the end of a 2176 px scroller. In jsdom the same test asserts the corrected `scrollTop` is the insert delta rather than the scroll height |
| StreamingBehaviourUnchanged | covered | Not re-asserted here: nothing in this change touches the auto-scroll decision, which `conversation-scroll-navigation`'s `ScrollbackProtectionPreserved` scenarios already hold, and those suites pass unchanged. The prepend path writes `scrollTop` only in the layout effect keyed on how many recovered items are held (`state.olderHistory.have`), which a streamed token never changes — asserted indirectly by "keeps the scroll position by the height the insert added", which would also fire on an unrelated items change if the key were wrong |
| SendsNothing | covered | `ui/src/App.history.test.tsx` — "asks the agent for the next chunk when activated" uses an api whose `prompt` is a spy; no test in the file ever sees it called. `ui/src/useAgent.test.ts` — "prepends what the server serves and advances the cursor" asserts the only frame sent is `history_before`, so no prompt, abort or edit went with it; the composer's draft lives in `Composer`, which the prepend never touches |

### Requirement: TheCompactionBoundaryIsVisible

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| ShownWithoutLoadingAnything | covered | `ui/src/App.history.test.tsx` — "is shown for a compacted session with nothing loaded, and says what the agent kept" asserts the boundary button carries `120k tokens summarised`, and that unfolding it shows the retained summary text. Observed in the app before any click: `Conversation compacted here — 118k tokens summarised` |
| PositionedWhereCompactionHappened | covered | `server/test/convert.test.ts` — "sits between what was summarized away and what survived" asserts the item order `[compaction, user, assistant]` from the context's own message order. `ui/src/App.history.test.tsx` — "sits between the recovered messages and what the model still holds" asserts the rendered index of the boundary is after the recovered prompt and before the kept one |
| AppearsWhenCompactionRuns | covered | `server/test/convert.test.ts` — "emits the boundary carrying what the model was left with" asserts a `compactionSummary` message becomes a `compaction` item with its summary and `tokensBefore`; the conversion runs on every snapshot and every replay, so the boundary appears when compaction lands and survives a reload. `server/test/history-wire.test.mjs` asserts the boundary is in the snapshot of a session reopened from disk |
| AbsentWithoutCompaction | covered | `ui/src/App.history.test.tsx` — "is absent from a conversation that was never compacted" asserts no `Conversation compacted here` text. `server/test/history.test.ts` — "returns nothing for a session that was never compacted" asserts the prefix is empty, and `olderItemCount` "is absent when nothing was compacted" asserts `undefined` |

### Requirement: RecoveredItemsAreReadOnly

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| NoEditOnARecoveredPrompt | covered | `ui/src/App.history.test.tsx` — "offers no edit on a prompt from before the compaction point" asserts the recovered bubble contains no button at all while the kept bubble does. `server/test/history.test.ts` — "marks every recovered item read-only" asserts every served item carries `readOnly: true`, which is what the interface reads. Observed in the app: the recovered turns show no ✎, and navigating back to them through the tree brings the ✎ back — read-only is a property of being outside the context, not a sticky flag |
| NoForkFromARecoveredMessage | covered | Same row's evidence for the flag, plus the structural fact the test relies on: forking is offered by `TreeMenu` from entry ids the tree advertised, and a recovered item carries no `entryId` (`precedingItems` passes no `userEntryIds`), so there is nothing to fork from. Observed in the app: the tree lists the turns and forking from one *navigates the session*, which then legitimately shows them as editable |
| ReadingActionsStillWork | covered | `ui/src/App.history.test.tsx` — "offers no edit on a prompt from before the compaction point" renders recovered items through the same `UserMessage`/`AssistantMessage` path, and "still applies the conversation filters to recovered items" asserts a recovered tool card is rendered and addressable. Observed in the app: ⧉ copy is present on recovered replies, and the recovered figure and equations render exactly as live ones |
| FiltersApplyToRecoveredItems | covered | `ui/src/App.history.test.tsx` — "still applies the conversation filters to recovered items" hides tool calls through the header's own filter menu and asserts the recovered tool output is gone from the document |

### Requirement: ARuntimeThatCannotServeTheBranchSaysSo

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| NoControlWithoutTheCapability | covered | `server/test/history.test.ts` — `olderItemCount` "is absent when the runtime cannot serve the branch" asserts `undefined` for a runtime with no `branchEntries`. `server/test/history-wire.test.mjs` — "a runtime that cannot read a branch says so instead of serving part of one" asserts `hello.olderItems` is `undefined` under the RPC runtime. `ui/src/App.history.test.tsx` — "offers nothing when the transcript already starts at the first message" asserts no control for `olderHistory: null`, which is what that snapshot produces. Observed in the app: the RPC-backed bench server (port 4323) offers no control |
| RequestRefusedNotApproximated | covered | `server/test/history.test.ts` — "refuses a runtime that cannot serve the branch" asserts `HistoryUnavailableError`. `server/test/history-wire.test.mjs` — the RPC test asserts the reply is `history_unavailable` with `kind: "unsupported"`, that its reason names the runtime, and that **no** `history_items` frame was ever sent |

## Capability: `conversation-html-export` (new, 5 requirements, 21 scenarios)

### Requirement: ExportTheWholeConversationAsHTML

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| DownloadsTheWholeConversation | covered | `ui/src/export/conversationExport.test.ts` — "collects what the transcript never showed" asserts the document contains both recovered chunks and the kept items, oldest first; "hands the browser one html file" asserts a single `save` call with an `text/html` blob whose text holds the conversation. Running app (tasks.md §8.2): the downloaded file holds 28 articles, `Turn 1` through `Turn 13`, while the transcript on screen had 7 items |
| ViewStateDoesNotNarrowTheExport | covered | Structural and asserted: the document is built from the item list, never from the DOM. `ui/src/export/conversationHtml.test.ts` — "folds a tool call into a disclosure that needs no script" asserts tool calls are present and closed, i.e. carried whatever the screen did with them. Running app: the exported file contains the tool call and the recovered half although neither was expanded or loaded when the export began |
| NamedAfterTheSession | covered | `ui/src/export/conversationExport.test.ts` — "is named after the session and the day" asserts `A-long-conversation-2026-09-25.html`; "drops what a filesystem would refuse, and never produces an empty name" asserts `../../etc/passwd` becomes `etcpasswd-…` and `///` becomes `conversation-…`. Running app: the download arrived as `Braking-twelve-turns-and-a-compaction-2026-09-25.html` — from a cold page, which is what forced the session name onto the snapshot (`sessionName`) rather than reading it from the lazily loaded session list |
| ConversationLeftAlone | covered | `ui/src/export/conversationExport.test.ts` — "hands the browser one html file" runs against an api whose other actions are spies and asserts only `save` was called. `ui/src/App.history.test.tsx` — "reports a refused export and leaves the conversation alone" asserts the transcript is intact after a refusal. Running app: three rapid clicks on the export produced exactly one download and left the transcript unchanged |

### Requirement: TheDocumentIsSelfContained

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| ReadableOfflineWithoutScript | covered | Running app (tasks.md §8.2), the only boundary that can judge it: the file was opened from `file://` in a context with `javaScriptEnabled: false` and `offline: true`, and the DOM read back showed 28 articles, an `<img>` with `naturalWidth > 0`, an inline `<svg>` laid out 128×272, and 10 rendered `<math>` elements. `ui/src/export/conversationHtml.test.ts` — "needs no stylesheet, font or script of its own" asserts the markup has no `<link>` and no `<script>` |
| NoExternalReferences | covered | Running app: the offline open recorded **zero** non-`file://` requests. `ui/src/export/conversationHtml.test.ts` — "embeds a workspace image rather than pointing at it" asserts the `src` is a `data:` URI and that the original path is absent from the document |
| ToolCallsFoldWithoutScript | covered | Running app: with scripting disabled, the first `<details>` reported `open === false`, a click on its `<summary>` made it `true`, and its text held the tool's arguments and output. `ui/src/export/conversationHtml.test.ts` — "folds a tool call into a disclosure that needs no script" asserts `<details>`, its `<summary>`, the output text, and the absence of an `open` attribute |
| ExportIsOffline | covered | `ui/src/export/conversationExport.test.ts` — the image loader is built on `referenceUrl`, the transcript's own helper, and the suite stubs `fetch`: "stops rather than dropping images past the budget" asserts the only requests are to the application's own raw-bytes endpoint. Running app: the export made no request off the widget's own origin, and the opened file made none at all |
| ReadableInBothThemes | covered | `ui/src/export/conversationHtml.test.ts` — "needs no stylesheet, font or script of its own" asserts `@media (prefers-color-scheme: dark)` is in the inlined stylesheet; the light values are the `:root` block asserted by the same test's `<style>` presence. Read back in the browser during §8.2: the document is legible in both schemes (the palette is the only source of colour, and no external theme is fetched) |

### Requirement: TheDocumentCarriesNoActiveContent

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| ScriptIsFiltered | covered | `ui/src/export/conversationHtml.test.ts` — "filters every way a reply could smuggle behaviour into the archive" feeds a reply containing a `<script>`, an `onerror` image, a `javascript:` link, an `<iframe>`, a `<form>`, a `<link>` and a `<style>`, and asserts the document body contains no `<script`, no `onerror` and no `javascript:`. "escapes tool output rather than rendering it" asserts a `<script>` in tool output arrives as `&lt;script&gt;` |
| RemoteReferencesDoNotSurvive | covered | Same test asserts no `<link`, no `example.com/a.css`, no `<style` element, and no `href`/`src` attribute naming `example.com` — the assertion is about references the opened file would follow, since a stripped `<style>` element's text survives as inert text exactly as it does in the transcript. Running app: the offline open fetched nothing |
| MarkupCannotEscapeItsMessage | covered | `ui/src/export/conversationHtml.test.ts` — "does not let a reply escape into the document's own structure" feeds `</article></main><body onload=…><h1>hijacked` and asserts exactly one `<body`, exactly one `</main>`, no `onload`, and that the text `hijacked` is still shown — so the content is confined rather than dropped |
| NoFormsOrFrames | covered | "filters every way a reply could smuggle behaviour into the archive" asserts the body contains no `<form` and no `<iframe` |

### Requirement: TheDocumentSaysWhatItIs

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| HeaderIdentifiesTheConversation | covered | `ui/src/export/conversationHtml.test.ts` — "names the project, session, model and date" asserts all four in the header and the `<title>`. Running app: the file's `<h1>` read `Braking, twelve turns and a compaction — pi-outpost-test-…` with the model and date in its definition list |
| AuthorshipIsLegible | covered | `ui/src/export/conversationHtml.test.ts` — "attributes each message, in the order they were exchanged" asserts the three messages appear in ascending document position and that `You` and `Agent` are present. Running app: the offline read-back showed `YOU` and `AGENT` on the first and last articles |

### Requirement: TheExportIsBoundedAndRefusesRatherThanTruncates

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| MissingHistoryRefusesTheExport | covered | `ui/src/export/conversationExport.test.ts` — "refuses when the runtime cannot read back what compaction removed" asserts a rejection matching `/cannot be exported in full/` when `olderItems > 0` and no fetcher is available |
| FailedChunkRefusesTheExport | covered | `ui/src/export/conversationExport.test.ts` — "refuses when a chunk fails, and hands over no file" asserts a `ConversationExportError` **and** that `save` was never called. `ui/src/App.history.test.tsx` — "reports a refused export and leaves the conversation alone" asserts the failure is shown to the reader and the transcript survives |
| BudgetIsNamedNotSilent | covered | `ui/src/export/conversationHtml.test.ts` — "stops and names the size rather than dropping pictures" asserts `ExportBudgetError`. `ui/src/export/conversationExport.test.ts` — "stops rather than dropping images past the budget" asserts the message names the size and that no file was handed over |
| UndrawableDiagramKeepsItsSource | covered | `ui/src/export/conversationHtml.test.ts` — "keeps a diagram's source when it cannot be drawn" asserts the source text is in the document and no `<svg>` is, with the export still succeeding. "leaves a note where a picture could not be had" asserts the same rule for an image (`[image: the architecture]`, no `<img>`) |
| ProgressIsVisible | covered | `ui/src/export/conversationHtml.test.ts` — "reports progress so a long export is not silent" asserts `onProgress(1, 2)` and `(2, 2)`. `ui/src/export/conversationExport.test.ts` — "reports progress through both stages" asserts `("collecting", 1, 1)` and `("rendering", 3, 3)`, which is what the header button renders as `reading …/…` then `writing …/…` |
| NotOfferedForAnEmptyConversation | covered | `ui/src/App.history.test.tsx` — "offers the export only once there is a conversation" asserts the action is absent with no items and present with them. `ui/src/export/conversationExport.test.ts` — "refuses an empty conversation" asserts the refusal even if a caller asks anyway. Observed in the app: a fresh session shows no `↓ html` |

## Capability: `api` (modified, 1 added requirement, 7 scenarios)

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| AnswersTheRequesterOnly | covered | `server/test/history-wire.test.mjs` — "the reader is served the items before the ones they hold, and nobody else is" asserts the reply echoes the request id to the asking socket and that the second client received no history frame |
| ServesThePrecedingItems | covered | Same test asserts four items in transcript order with `remaining > 0` for `have: 0`; "consecutive windows reach the first message with no gap and no repetition" asserts the walk collects exactly `olderItems` items and ends at `ask 1` |
| CountIsBounded | covered | `server/test/history.test.ts` — "clamps a request above the bound and accounts for what it withheld" asserts 200 items and a `remaining` that accounts for the rest; the bound is the shared `MAX_HISTORY_CHUNK`, imported by both sides rather than duplicated |
| SnapshotSaysWhetherOlderItemsExist | covered | `server/test/history-wire.test.mjs` — "the snapshot says how much of the conversation is out of context" asserts `olderItems > 0` on the snapshot of a compacted session; the RPC test asserts it is `undefined` where nothing can be served; `server/test/history.test.ts` asserts `undefined` for a session never compacted |
| SnapshotMarksReadOnlyItems | covered | `server/test/history-wire.test.mjs` — the served items are asserted to carry `readOnly === true`; `server/test/history.test.ts` — "marks every recovered item read-only" asserts it for every item of the prefix |
| StaleRequestRefused | covered | `server/test/history-wire.test.mjs` — "a request naming a session the server no longer holds is refused" asserts `history_unavailable` with `kind: "stale"` and that no `history_items` frame was sent for that request id. `ui/src/useAgent.test.ts` — "says nothing to the reader when the session moved under the request" asserts the client shows no error for that kind and leaves the transcript alone |
| UnsupportedRuntimeAnswersUnavailable | covered | `server/test/history-wire.test.mjs` — "a runtime that cannot read a branch says so instead of serving part of one" asserts `kind: "unsupported"`, a reason naming the rpc runtime, and no items |

## What the running application could not answer here

Two of the destructive checks in tasks.md §8.3 need a live model, and the bench runs offline
(`BENCH_LIVE=1` talks to a real one):

- **Exporting while a turn streams.** Not exercised by hand. The export reads `state.items` and
  fetches its own prefix; a streaming item is included as it stands, and nothing in the path writes
  to the conversation. Unit-covered only.
- **Compacting while paginating.** Not exercised by hand. The refusal path it would take *is*
  covered: the prefix cache is keyed by the compaction's identity (`server/test/history.test.ts` —
  "serves the prefix of the newer compaction after a second one runs"), and a request whose session
  moved is refused (`StaleRequestRefused`).

One observation worth keeping: the server serialises session changes and answers a second one with
`Session change already in progress`. Two apparent defects during the bench run — a switch that
looked inert and a transcript that looked stale — were that refusal plus my own automation racing
it, not this change.
