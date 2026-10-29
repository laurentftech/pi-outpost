# Scenario coverage

| Scenario | Coverage | Assertion evidence |
|---|---|---|
| The tools are absent until searched | covered | `server/test/deferredToolsWire.test.mjs` — “The embedded runtime loads each diagram, poster and structure tool on demand” asserts none of the six is declared before search and that each expected tool appears after its purpose query. `server/test/deferredTools.test.ts` has a purpose-query case for each tool. |
| The RPC runtime also defers the tools | covered | `server/test/deferredToolsWire.test.mjs` — “The RPC child loads each diagram, poster and structure tool on demand” makes the same before/after declaration assertions against the RPC runtime. |
| Guidance names the deferred tool families | covered | `server/test/system-prompt.test.ts` — “says where the deferred tools are only where tool_search can load them” asserts the composed guidance includes diagram, poster and structured-exchange families and `tool_search`. |
| Guidance is absent when tool search is unavailable | covered | `server/test/system-prompt.test.ts` — “says where the deferred tools are only where tool_search can load them” asserts the guidance is absent with `noExtensions` and with a `read`-only tool allowlist. |
