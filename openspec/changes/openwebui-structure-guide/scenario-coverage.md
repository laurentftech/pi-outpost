# Scenario coverage — openwebui-structure-guide

## openwebui-structure-guide

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| TheIndexListsEveryTopic | covered | `openwebui/test/guide.test.ts` — "TheIndexListsEveryTopic": with no topic, the answer lists exactly `GUIDE_TOPICS`' topics in order, each with a purpose of more than 20 characters, and says how to ask for one. |
| ATopicReturnsItsPage | covered | Same file — "ATopicReturnsItsPage and AServedPageIsTheSourceWithoutPiOnlyPassages": each listed topic answers 200 with its own topic and its page. `openwebui/test/image.sh` reads every topic from the bundled server, so the pages copied to `dist/guide/` are served. |
| AnUnknownTopicListsTheTopics | covered | Same file — "AnUnknownTopicListsTheTopics": "mindmaps", "figures" (a page that exists in the source but is not served) and `42` each give 404 "no guide topic" with the full topic list. |
| ReadingTheGuideNeedsTheSecret | covered | Same file — "ReadingTheGuideNeedsTheSecret": no bearer, a wrong one, and no identity each give 401 without page content; nothing is written. |
| AServedPageIsTheSourceWithoutPiOnlyPassages | covered | Same file — the served page equals the source file with each marked block cut out, every other byte identical. A second test checks that `withoutPiOnlyPassages` keeps CRLF endings and refuses an unclosed passage. |
| NoServedPageNamesAPiOnlyTool | covered | Same file — "NoServedPageNamesAPiOnlyTool": no served page contains `write_structure_figure`, `write_structure_table`, `compare_timelines`, `present_structure` or `present_project_model`. `image.sh` checks the same against the bundled server. |
| PiOutpostStillReadsTheWholePage | covered | Same file — "PiOutpostStillReadsTheWholePage": in the source files, each of the five pi-only passages is still present and sits between a begin marker and an end marker, with no marker pair closed in between. `server/test/structuredExchangeDocumentedExamples.test.ts` and `server/test/sandboxSkillRead.test.mjs` pass unchanged (90 tests run with them). |
| AProposalRefusalPointsToProposals | covered | Same file — "AProposalRefusalPointsToProposals": `change-without-target`, `removal-without-target` and `change-without-reference` each give a refusal with `guide: "proposals"` and an error naming `read_structure_guide` with topic "proposals". `openwebui/test/structures.test.ts` still asserts that the refusal's issues deep-equal the gate's. |
| ATableProposalPointsToRowRoles | covered | Same file — "ATableProposalPointsToRowRoles": `table-with-target` and `table-with-removal` point to "graphs-and-tables", and that page teaches row roles. Live: after this fix, Codestral read that page after a refused table proposal and showed the table with `changed` and `removed` rows (`live-run.md`). |
| ATimelineRefusalPointsToTimelines | covered | Same file — "ATimelineRefusalPointsToTimelines": an inverted activity, and a timeline with a target, both point to "timelines". |
| ShowStructureNamesTheGuide | covered | `openwebui/test/openapi.test.ts` — "ShowStructureNamesTheGuide": the published `show_structure` description names `read_structure_guide` and all four topics, `create_planning`'s names the "timelines" topic, and the guide tool's `topic` enum is exactly the four topics. "TheDescriptionNamesTheFiveTools" now lists seven operations, including `read_structure_guide`. |
