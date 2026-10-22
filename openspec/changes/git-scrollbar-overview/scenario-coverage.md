# Scenario coverage

Inventory: rg '^#### Scenario:' openspec/ saved to .tmp/scenario-inventory.txt. Main git scenarios describe existing server/repository/history behavior, unaffected by this UI extension. The existing git-change-gutter scenarios are preserved; its component and pure-diff suites also pass. OpenLore graph unavailable: orient CLI plus targeted rg/source assertion review used.

| Applicable scenario | Status | Tests and assertions |
|---|---|---|
| DistantChangesInOverview | covered | `CodeEditor.test.tsx` DistantChangesInOverview verifies three correct kinds and line numbers in 2000 lines, plus rail outside scroller; `scripts/probes/git-overview.mjs` verifies ordered physical positions, distinct colors, min-height, and EOF clamp in the actual widget. |
| NavigateFromOverview | covered | `CodeEditor.test.tsx` NavigateFromOverview (readOnly=false/true) checks selection and unchanged document/draft; `git-overview.mjs` click and Enter reach offscreen text in source/editor and disk remains unchanged. |
| OverviewFollowsCurrentDocument | covered | `CodeEditor.test.tsx` OverviewFollowsCurrentDocument checks addition/removal, clean HEAD and missing HEAD clear/hide markers. Existing TheMarksFollowTheDraft/TheGutterFollowsHead tests cover the shared state. `git-overview.mjs` types and undoes, switches to a clean file and back, closes viewer and verifies rail removal, reopens and verifies exactly three current markers. |
| OverviewSurvivesLayoutChanges | covered | `git-overview.mjs` uses a long wrapped line, opens HEAD peek, resizes viewport, checks rail/scroller heights and fixed rail position after scrolling; marker click reads expected offscreen text; native scrollTop is set/read and markers remain. |

Validation: 27 CodeEditor/gitGutter tests pass; embed production build passes; strict OpenSpec validation passes; real server/widget probe passes including transition pass and no page/plugin errors. Demo screenshot reviewed. All new paths use path.join and git test commits disable local signing; text comparisons normalize via existing CRLF-aware helpers.
