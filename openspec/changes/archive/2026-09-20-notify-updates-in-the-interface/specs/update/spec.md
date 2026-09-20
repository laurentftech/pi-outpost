## ADDED Requirements

### Requirement: TheInterfaceSaysANewerVersionExists

When the startup check has found a newer published pi-outpost, the standalone interface SHALL show a notice naming the running version and the newer one, and saying how to move to it with the instruction the update command gives for this installation — `pi-outpost update` for a global npm install, the download page for a standalone executable — with a control that copies a command. The notice SHALL be dismissible, and a dismissed notice SHALL stay dismissed for that version and appear again for a later one. The interface SHALL NOT install anything. No notice SHALL be shown when the running version is current, when the check failed or was not made — `updateCheck` off, `offline`, or a checkout — or in an embedded widget, whose reader does not run the server.

#### Scenario: ANewerVersionIsAnnouncedInTheInterface
- **GIVEN** a global npm installation running 0.26.0, and a published 0.27.0
- **WHEN** the standalone interface is opened
- **THEN** it shows a notice that pi-outpost 0.27.0 is available, running 0.26.0, with `pi-outpost update` and a control that copies it

#### Scenario: ADismissedNoticeStaysDismissedForThatVersion
- **GIVEN** a notice for 0.27.0 that the user dismissed
- **WHEN** the interface is opened again, and later when 0.28.0 is published
- **THEN** no notice is shown for 0.27.0, and a notice is shown for 0.28.0

#### Scenario: NoNoticeWithoutANewerVersion
- **WHEN** the running version is the newest, the check failed, or checking is off
- **THEN** no notice is shown

#### Scenario: AWidgetShowsNoNotice
- **GIVEN** a newer published version
- **WHEN** an embedded widget is shown
- **THEN** it carries no update notice
