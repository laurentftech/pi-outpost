# update-changelog Specification

## Purpose
What a person who just updated pi-outpost is told about the new version: the changelog that
ships inside it, shown offline after an update, the release notes linked from the notice of a
newer version, and the release rule that keeps every published version described.

## Requirements

### Requirement: BundledChangelog

pi-outpost SHALL ship its `CHANGELOG.md`, and after an update the standalone interface
SHALL show, offline, the version it came from and the sections newer than it up to the
running one, for as long as that version runs, dismissible per browser. A first run, a
downgrade, a source checkout, a widget, and `changelogNotice: false` SHALL show none.

#### Scenario: WhatChangedIsShownAfterAnUpdate
- **GIVEN** pi-outpost last ran at an older version
- **WHEN** the updated version starts and the standalone interface opens
- **THEN** it names both versions and, when asked, shows each changelog section between them, rendered, newest first

#### Scenario: TheNewsSurvivesARestart
- **GIVEN** an update was announced
- **WHEN** the same version starts again
- **THEN** the same update is still announced

#### Scenario: NothingToSayWithoutAnUpdate
- **WHEN** pi-outpost runs for the first time, or at an older version than before, or from a source checkout
- **THEN** no update news is announced

#### Scenario: AnInstallationOlderThanTheMarkerIsToldAboutThisRelease
- **GIVEN** pi-outpost ran with this agent directory before it remembered versions
- **WHEN** a version that remembers them starts
- **THEN** the running release's own section is announced, as an update from the release before it

#### Scenario: TheNewsIsDismissedPerVersion
- **WHEN** the news of an update is dismissed in a browser
- **THEN** that browser does not show it again for that version, and shows the next update's

#### Scenario: AWidgetShowsNoUpdateNews
- **WHEN** the interface runs as an embedded widget
- **THEN** no update news is shown

#### Scenario: TheNoticeCanBeTurnedOff
- **GIVEN** the configuration sets `changelogNotice` to false
- **WHEN** an updated version starts
- **THEN** the update is recorded and no update news is announced

### Requirement: ReleaseNotesLink

The notice of a newer version SHALL link that version's release notes.

#### Scenario: TheUpdateNoticeLinksItsReleaseNotes
- **WHEN** a newer version is announced
- **THEN** the notice links that version's GitHub Release, opening outside the app

### Requirement: EveryReleaseIsInTheChangelog

A release SHALL NOT be published unless the changelog has a non-empty section for its
version; that section SHALL be the GitHub Release's notes.

#### Scenario: AReleaseWithoutASectionIsRefused
- **WHEN** a version is tagged that the changelog has no section for, an empty one, or two
- **THEN** the release workflow stops before anything is published, and a bump of the packages to that version fails the script tests
