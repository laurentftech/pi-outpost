# Scenario coverage

OpenLore had no analysis index for this branch; targeted inspection of `Header.tsx` and
the menu triggers stood in. Scenarios enumerated with
`rg '^#### Scenario:' openspec/changes/header-one-row`.

jsdom lays nothing out, so heights and overflow were measured in the running app
(`scripts/probes/header-statuses-server.mts`: a long project, a long branch, three
statuses): at 1600, 1300, 1000 and 800 px every header button measured 28 px on one
centre line with no overflow; the statuses inline at 1600, folded below, back inline on
widening; the folded list opened and closed.

| Scenario | Status | Test file and name |
|---|---|---|
| EveryControlIsOneHeight | covered | `ui/src/components/Header.test.tsx`: `EveryControlIsOneHeight: …` — every control the bar renders (at least 12, menus' items excluded), statuses included, carries the shared one-height, no-wrap style; a new control without it fails. Heights measured live as above. |
| ALongLabelIsCutNotWrapped | covered | `ui/src/components/Header.test.tsx`: `ALongLabelIsCutNotWrapped: …` — the project's name is a `truncate` span with the full name as the button's title; the branch label is a `truncate` span. |
| StatusesFoldWhenTheyDoNotFit | covered | `ui/src/components/Header.test.tsx`: `StatusesFoldWhenTheyDoNotFit: …` — with the bar narrower than its content, the statuses are not inline, "2 statuses" lists both in full, Escape closes it. |
| StatusesUnfoldWhenRoomReturns | covered | `ui/src/components/Header.test.tsx`: `StatusesUnfoldWhenRoomReturns: …` — 20 px more keeps them folded; well past it they return inline, and the list left open is closed. |
