# Scenario coverage — add-pptx-update

Capabilities: `pptx-presentations` (1 requirement, 5 scenarios), `agent` (1 requirement,
2 scenarios).

## pptx-presentations

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| ASlideIsReplacedAndTheOthersAreUntouched | covered | `server/test/pptxUpdate.test.ts` — "ASlideIsReplacedAndTheOthersAreUntouched: new content on its layout, every other slide byte-identical". On a five-slide deck, replaces slide 3 and asserts, for slides 1, 2, 4 and 5, that the slide, its relationships and every part it reaches (its picture included) are present with identical bytes; slide 3 stays on "Two Content" and shows exactly the new title and bullets; `changed` is `[3]`; the package passes `assertIntact` (relationships resolve, content types complete, nothing declared twice). |
| AnInsertedSlideUsesTheDecksLayouts | covered | `server/test/pptxUpdate.test.ts` — "AnInsertedSlideUsesTheDecksLayouts: after slide 2, on the deck's own layout, named in the report". Asserts six slides, the new one third with its content, its layout the deck's "Title and Content" part with unchanged bytes, `changed` `[3]`, and the report line naming the layout. `presentationToolsWire.test.mjs` shows the tool's answer naming the changed slides to render. |
| DeletingASlideSweepsWhatOnlyItUsed | covered | `server/test/pptxUpdate.test.ts` — "DeletingASlideSweepsWhatOnlyItUsed: the slide and its picture leave the package, which stays consistent". Asserts the slide, its relationships, its content type and its picture are gone, the remaining order, exactly four slide relationships, and `assertIntact`. |
| AnAmbiguousSlideTitleIsRefused | covered | `server/test/pptxUpdate.test.ts` — "AnAmbiguousSlideTitleIsRefused: the refusal lists the slides" asserts the message and the numbered slide list; "an ambiguous title writes nothing" asserts, through `pptx_update`, the refusal and that no output file exists. |
| TheOriginalIsKeptUnlessOverwriteIsAsked | covered | `server/test/pptxUpdate.test.ts` — "TheOriginalIsKeptUnlessOverwriteIsAsked: the result goes to output_path, the original stays". Asserts the original's bytes are unchanged after a write to `output_path`, the moved order in the result, refusals without `output_path` and onto an existing file (original still unchanged), and that `overwrite: true` replaces it. `presentationToolsWire.test.mjs` asserts the same over a real server. |

## agent

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| UpdateComesWithTheOtherPresentationTools | covered | `server/test/documentTools.test.ts` — "UpdateComesWithTheOtherPresentationTools…" asserts a `.pptx` prompt yields `pptx_extract, pptx_layouts, pptx_create, pptx_update, pptx_render`, spelled out. `server/test/presentationToolsWire.test.mjs` asserts over a real server that `pptx_update` is withheld, then sent with the others on the turn naming a template, and used end to end. |
| NoDeckUpdateInAReadOnlySandbox | covered | `server/test/sandbox-tools.test.ts` — "read-only by default" asserts the exact read-only list, without `pptx_update` (and `pptx_create`); "adds edit and write only when writing is allowed" asserts it appears with writing. |
