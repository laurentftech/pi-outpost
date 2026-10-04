# Tasks

## 1. One source

- [x] 1.1 Mark the pi-only passages in `skills/structured-exchange/references/`: the
  `write_structure_figure` line in `graphs-and-tables.md`, the `SKILL.md` pointer in
  `enriched-contract.md`, and the file-tool paragraph in `timelines.md`, between
  `<!-- only: pi-outpost -->` and `<!-- end -->`. Verify:
  - `server/test/structuredExchangeDocumentedExamples.test.ts` and `sandboxSkillRead.test.mjs` still
    pass;
  - `PiOutpostStillReadsTheWholePage`: a test reads the file and finds each passage between its
    markers.

## 2. The guide on pi-outpost's Open WebUI server

- [x] 2.1 Add `openwebui/src/guide.ts`: the topics table, the pages (read from `skills/` from
  source, and from `dist/guide/` beside `dist/server.mjs`), and the stripping of
  marked passages. Add `POST /read_structure_guide { topic? }` behind the trust hook. Verify with
  `openwebui/test/guide.test.ts`:
  - `TheIndexListsEveryTopic`, `ATopicReturnsItsPage`, `AnUnknownTopicListsTheTopics` and
    `ReadingTheGuideNeedsTheSecret`;
  - `AServedPageIsTheSourceWithoutPiOnlyPassages`: the served page equals the file with the marked
    blocks cut, byte for byte;
  - `NoServedPageNamesAPiOnlyTool`.
- [x] 2.2 Bundle the pages: `build:server` copies them to `dist/guide/` (see `design.md`), and the image check calls
  `read_structure_guide` for each topic against the bundled server. Verify: `image.sh` passes on a
  fresh build.

## 3. Pointing to it

- [x] 3.1 Compute the topic hint for a `show_structure` refusal, from the document's kind and the
  issues' rules and paths, as in `design.md`. Add `guide` and the sentence to the refusal. Verify
  `AProposalRefusalPointsToProposals` and `ATimelineRefusalPointsToTimelines`, and that the issues
  themselves are unchanged (still deep-equal to the gate's).
- [x] 3.2 Name the guide in the `show_structure` and `create_planning` descriptions. Extend the
  OpenAPI tests: seven tools, and `ShowStructureNamesTheGuide`.
- [x] 3.3 Live, on the compose stack with Codestral:
  - one request for a hard document: a version 2 requirements table with chapters and traceability;
  - one that should produce a proposal refusal.

  Record whether the model read the guide unprompted, after a refusal, or not at all, and what it
  then produced.

## 4. Documentation and coverage

- [x] 4.1 Update `docs/openwebui.md` (the tool, and how the model learns the format) and
  `docs/openwebui-architecture.md` (the guide shares its source with pi-outpost's skill, and is
  bundled at build). Note in `skills/structured-exchange/SKILL.md`'s maintainer comment, if it has
  one, or in `docs/development.md`, that the marked passages are left out of what Open WebUI's
  models read.
- [x] 4.2 Write `scenario-coverage.md` with every scenario covered. Run `npm run check:scenarios` and
  `openspec validate openwebui-structure-guide --strict`.
