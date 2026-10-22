# Scenario coverage

Inventory: rg '^#### Scenario:' openspec/ (saved in .tmp/scenario-inventory.txt). All three scenarios in this delta are applicable. Existing settings behavior is unchanged; all 52 SettingsMenu tests pass. OpenLore orient ran; graph/coverage unavailable, so targeted rg/source assertion review was used.

| Scenario | Status | Test and observed boundary |
|---|---|---|
| BrowseCredits | covered | `ui/src/components/SettingsMenu.test.tsx` — BrowseCredits: opens credits without versions and preserves settings on return. Exact project href, draw.io attribution, full Apache/MIT notices, preserved draft, Settings on reopen. |
| NavigateCreditsRepeatedly | covered | `scripts/probes/credits.mjs` — four notice/back cycles; scroll to final notice at 650×500; leave notices directly for settings; close/reopen mid-notices; DOM headings and no pageerrors. |
| SeparateNoticesFromCredits | covered | `SettingsMenu.test.tsx` BrowseCredits checks exactly one website link, no details elements, opens full notices and returns to acknowledgements. `scripts/probes/credits.mjs` checks understandable component role, separate notices heading and visible full license, restored credits heading and action. |

Validation after redesign: 52 unit tests pass; embed production build passes; real widget Playwright probe passes; strict OpenSpec validation passes. Screenshot reviewed for actual light-theme layout; DOM checks provide functional evidence.
