# Scenario coverage

OpenLore's MCP server was not connected in this session; targeted inspection of
`update.ts`, `index.ts`, `config.ts`, both build scripts, `release.yml`, `UpdateNotice.tsx`
and `App.tsx` stood in.

Scenarios enumerated with `rg '^#### Scenario:' openspec/changes/embedded-changelog`.
Every test below carries an `openlore: scenario=<name> spec=update-changelog` annotation.

The running app was also driven (`scripts/probes/changelog-server.mts`: the real server
bundled like the npm package, version 0.44.0, this repository's `CHANGELOG.md` inlined, a
marker saying 0.43.0 ran before, update checks off). In the standalone app — the bench's
host page is a widget, where the notice is rightly absent, which was checked first — the
DOM read back "updated to 0.44.0 (from 0.43.0)", the 0.44.0 section rendered (`Added`
heading, bold lead-ins, PR links with `target=_blank`), and the release-notes link for
v0.44.0. Then: seven rapid toggles; dismiss and reload (gone); a fresh browser context in
dark mode (shown). No page error.

| Scenario | Status | Test file and name |
|---|---|---|
| WhatChangedIsShownAfterAnUpdate | covered | `server/test/versionsBundled.test.mjs`: `a bundle carries its changelog, and an update is announced from it with no network` — the real bundle with an inlined changelog, started over a 1.0.0 marker, sends `from`, `to` and exactly its own section over the socket; `server/test/changelog.test.ts`: `WhatChangedIsShownAfterAnUpdate: …` — exact sections between, newest first, the release URL and the marker; `ui/src/components/ChangesNotice.test.tsx`: `WhatChangedIsShownAfterAnUpdate: …` — both versions named, collapsed until asked, headings in order, Markdown rendered (`STRONG`, `Fixed` heading), links in a new tab. |
| TheNewsSurvivesARestart | covered | `server/test/changelog.test.ts`: `TheNewsSurvivesARestart: …` — the second run of the same version returns the same `from` and section. |
| NothingToSayWithoutAnUpdate | covered | `server/test/changelog.test.ts`: `NothingToSayWithoutAnUpdate: …` — first run (twice), downgrade (marker rewritten), and `dev` (nothing written) return `undefined`. |
| AnInstallationOlderThanTheMarkerIsToldAboutThisRelease | covered | `server/test/changelog.test.ts`: `AnInstallationOlderThanTheMarkerIsToldAboutThisRelease: …` — with the update-check cache present and no marker, `from` is the previous release in the file and only the running one's section is returned. |
| TheNewsIsDismissedPerVersion | covered | `ui/src/components/ChangesNotice.test.tsx`: `TheNewsIsDismissedPerVersion: …` — gone after dismissal and on remount, back for the next version. Also observed across a reload and a fresh context in the running app. |
| AWidgetShowsNoUpdateNews | covered | `ui/src/App.test.tsx`: `AWidgetShowsNoUpdateNews: …` — embedded with `outpostChanges` set, no notice; the standalone counterpart in the same block shows it. |
| TheNoticeCanBeTurnedOff | covered | `server/test/versionsBundled.test.mjs`: `changelogNotice off: the update is recorded and not announced` — the real bundle rewrites the marker to `{to, updatedFrom}` and sends no `outpost_changes`, in the snapshot or after; `server/test/config.test.ts`: `TheNoticeCanBeTurnedOff: …` — the key is read as a boolean and refused otherwise. |
| TheUpdateNoticeLinksItsReleaseNotes | covered | `server/test/update.test.ts`: `tells the interface about a newer version, …` — `releaseNotes` exactly the v0.27.0 release, for both channels that get a notice; `ui/src/components/UpdateNotice.test.tsx`: `TheUpdateNoticeLinksItsReleaseNotes: …` — the link's `href` and `target`. |
| AReleaseWithoutASectionIsRefused | covered | `scripts/changelog-section.test.mjs`: `AReleaseWithoutASectionIsRefused: …` — missing, empty and doubled sections throw (the doubled case found a real bug: the scan stopped at the next section); `the version the packages are at has its section, …`; `server/test/release-workflow.test.mjs`: `AReleaseWithoutASectionIsRefused: …` — the gate runs before `npm publish`, and the release is created with `--notes-file release-notes.md` ahead of `--generate-notes`. |
