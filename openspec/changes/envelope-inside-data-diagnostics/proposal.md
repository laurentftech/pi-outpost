## Why

An Open WebUI model created a planning with `schema`, `kind` and `title` inside `data`. The answer
listed eight diagnostics: `data` lacked `nodes` and `edges`, `participants` and `messages`, `columns`,
and carried properties it should not. Without a top-level `schema` the document is judged as
version 1, and without a top-level `kind` every form `data` can take reports why it is not that form.
Each reason is true; none is the fix, and the model, reading about nodes and edges, was lost.

The same document shown with `show_structure`, presented by pi-outpost's agent, or given to the
reference validator gets the same eight reasons.

## What Changes

- **The contract's gate** (`checkStructuredExchangeSchema`, through `misplacedEnvelopeIssues` in
  `shared/src/structuredExchangeDocument.ts`): when `schema` or `kind` is inside `data` and not beside
  it, the refusal leads with `envelope-inside-data` at `/data/schema` or `/data/kind`, saying it
  belongs beside `data`. Purely additive: every other diagnostic stays, in the same order after it,
  and no verdict moves. pi-outpost's `present_structure`, Open WebUI's `show_structure` and the
  reference validator all get it, since they run that gate.
- **The planning gate** (`judgePlanning`, shared by the Open WebUI and MCP servers), where a planning
  can only be a version 3 timeline and the other forms' diagnostics are never useful:
  - a misplaced `schema`/`kind` → the same `envelope-inside-data`, worded for a planning with the form
    to write, then the contract's diagnostics for the planning with its envelope in place, so every
    fix arrives in one answer;
  - `kind` other than `timeline` or `schema` other than version 3, missing or wrong, wherever found →
    `planning-is-a-timeline` alone, naming the field and the form to write.
  What a planning server accepts and refuses does not change; only its diagnostics for a wrong
  envelope differ from pi-outpost's.
- **The guide a refusal points to** (`guideTopicFor`): read the kind and version from inside `data`
  when the envelope is there, so a misplaced timeline is sent to the timelines page rather than the
  graphs page.

## Impact

- `shared/src/structuredExchangeDocument.ts` (`misplacedEnvelopeIssues`),
  `shared/src/structuredExchangeSchemaNode.ts`, `apps-core/src/planning.ts`, `apps-core/src/guide.ts`.
- The browser check is untouched: it gives a verdict, not diagnostics.
- Tests: `server/test/structuredExchangeEnvelopeInsideData.test.ts`,
  `server/test/structuredExchangeTool.test.ts`, `server/test/structuredExchangeValidatorCli.test.ts`,
  `openwebui/test/structures.test.ts`, `openwebui/test/guide.test.ts`, `openwebui/test/plannings.test.ts`, `mcp/test/tools.test.ts`.
- Conformance suite: unchanged; no case carries an envelope inside `data`, and every verdict holds.
- Documentation: `docs/openwebui.md` (the planning-specific wording beside the promise of
  pi-outpost's reasons), `docs/structured-exchange.md` and `shared/conformance/README.md` (the new
  diagnostic).
