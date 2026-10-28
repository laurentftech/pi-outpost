# Tasks

## 1. Deferred registration and discovery

- [x] 1.1 Verify the six requested names are included in the shared deferred inventory and add assertions that each registered definition has `deferred` exposure while unrelated tools keep their existing exposure; run the focused deferred-tools test.
- [x] 1.2 Add real `tool_search` ranker cases for purpose-based queries for each of `drawio_check`, `poster_check`, `poster_pictures`, `compare_timelines`, `write_structure_figure` and `write_structure_table`; run those cases and assert each expected tool is loaded.
- [x] 1.3 Verify embedded and RPC sessions declare none of the six before loading and declare the selected tool after `tool_search`; run the focused runtime-registration tests.

## 2. Guidance and cost documentation

- [x] 2.1 Update the product-owned deferred-tools guidance to name diagram, poster and structured-exchange tools and test that it is present only when `tool_search` is available.
- [x] 2.2 Update the context probe and `docs/comparison.md` with the measured resting tool inventory and prompt cost; verify the documented counts against the registered tool definitions.

## 3. Running application verification

- [x] 3.1 In the running app, exercise an agent request for each tool family and inspect the session transcript to confirm the needed tool is loaded through `tool_search` and then called successfully.
