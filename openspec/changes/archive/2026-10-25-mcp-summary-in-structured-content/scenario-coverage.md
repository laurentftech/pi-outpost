# Scenario coverage

OpenLore had no analysis index for this branch; targeted inspection of `mcp/src/server.ts`
showed `show_planning` is the only tool whose text and structured content differ.

Scenarios enumerated with `rg '^#### Scenario:' openspec/changes/mcp-summary-in-structured-content`.
The three carried over from the modified requirement keep their tests, rerun on this branch
(`e2e/mcp-app.spec.ts`, 17 passed, with the view rebuilt). The new one is checked at the
server's MCP boundary, through a real client, and was also checked live: Claude Code 2.1.303,
run against the built bundle, handed its model the structured content with `summary` in it.

| Scenario | Status | Test file and name |
|---|---|---|
| TheViewDrawsTheShownPlanning | covered | `e2e/mcp-app.spec.ts`: `TheViewDrawsTheShownPlanning: every task and item of the current revision`; the model's summary in `mcp/test/tools.test.ts`: `show_planning hands the view the planning and the model a summary` — text matched against the planning's title, id, revision, task count and period. |
| AComparisonIsDrawn | covered | `e2e/mcp-app.spec.ts`: `AComparisonIsDrawn: the moved milestone's previous and current positions`. |
| TheViewNeedsNoNetwork | covered | `mcp/test/tools.test.ts`: `TheViewNeedsNoNetwork` — the resource's CSP declares no domain and the page references no external resource. |
| TheSummaryReachesAHostThatReadsStructuredContent | covered | `mcp/test/tools.test.ts`: `TheSummaryReachesAHostThatReadsStructuredContent` — `structuredContent.summary` equals the text exactly, for a valid planning and for a file edited into an invalid one, whose text carries the "edited outside into an invalid planning" note. |
