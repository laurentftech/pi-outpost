# Tasks

## 1. Viewer: a structure mode

- [x] 1.1 Give `openwebui/viewer/main.tsx` the two modes from `design.md`:
  - `structure` mounts `StructuredExchangeDocument`, with a no-op `openFile` dispatch;
  - `planning` keeps today's behaviour.

  Build it and record the gzipped embed size for a small graph in `design.md`. Split the XLSX export
  only if the embed passes about 400 kB. Verify: `npm run build:viewer`, and the size is recorded.
- [x] 1.2 Extend `e2e/openwebui-embed.spec.ts` to show, in Open WebUI's sandbox (opaque origin):
  - a graph: every element and relationship drawn, and a viewpoint selectable when declared;
  - a sequence: every participant and message;
  - a table: every row;
  - a timeline: every task and item;
  - a proposal: additions, changes and removals marked differently, every element present, no
    control that applies it, no message sent to the parent.

  Also, through the frame's own controls:
  - download the SVG figure and the table's Markdown, then compare each file with pi-outpost's export
    of the same document;
  - check that the reported height follows the content.

  Name the tests after `AGraphIsShown`, `EveryKindIsShown`,
  `AdditionsChangesAndRemovalsAreDistinguishable`, `AFigureIsDownloadedFromTheEmbed` and
  `ATableIsDownloadedFromTheEmbed`. Fix anything in `ui/` only additively, with its own test there.

## 2. The `show_structure` route

- [x] 2.1 Add a generic judge next to the planning one (object or JSON string, the contract's gate,
  no profiles), and `POST /show_structure` returning the embed, or the diagnostics.

  Verify with `openwebui/test/structures.test.ts`:
  - `AnEarlierVersionIsShown`;
  - `ADocumentGivenAsAStringIsShown`;
  - `ADanglingRelationshipIsRefused`, with diagnostics equal to `parseSerializedStructuredExchange`'s
    for the same document;
  - `AChangeWithoutATargetIsRefused`;
  - `ADocumentTooLargeIsRefused`;
  - `TheEmbeddedDocumentEqualsTheOneValidated`, a deep-equal that includes key order;
  - `ShowingWritesNothing`;
  - `ShowingWithoutTheSecretIsRefused`.

  Run the valid conformance fixtures of every version and kind through it: all are accepted.
- [x] 2.2 Add `show_structure` to the image check in `openwebui/test/image.sh`: a graph is embedded by
  the bundled server. Verify: the script passes against a freshly built image.

## 3. Teaching the model

- [x] 3.1 Write the `show_structure` description:
  - the four kinds;
  - a proposal versus a description, with the inert default: an omission is never a removal, and
    fields beside a reference describe and do not change;
  - nothing is applied;
  - the examples from `design.md`.

  Extend the `openapi.ts` tests: the description now names six tools, and `EveryExampleIsShown` takes
  each example from the published document and shows it.
- [x] 3.2 Run the stack from `openwebui/deploy` with Codestral, and drive it as a user:
  - a request for a process diagram, then a sequence and a table, in French;
  - a "propose this change" on the diagram;
  - one request designed to make the model write an invalid document first.

  Read back the embeds and the tool calls, and record in this change what the model did, including
  whether it corrected itself after a refusal. Then a breaking pass: an oversized document, a
  document as a string with trailing text, a proposal against nothing, rapid repeated shows.

## 4. Documentation and coverage

- [x] 4.1 Update `docs/openwebui.md`: the new tool, what users can ask, and that proposals are shown and
  not applied. Update `docs/openwebui-architecture.md`: the route, the viewer's two modes, and that
  showing stores nothing. Verify: links and anchors resolve.
- [x] 4.2 Write `scenario-coverage.md` with every scenario covered. Run `npm run check:scenarios` and
  `openspec validate openwebui-structured-exchange --strict`.
