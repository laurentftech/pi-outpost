# settings-credits Specification

## Purpose
Give users accessible attribution for the project and its bundled third-party components, such as the draw.io viewer, from a Credits page in Settings that ships its notices with the widget.

## Requirements

### Requirement: SettingsCredits
Settings SHALL offer a bottom Credits subpage without requiring version metadata. It SHALL link to https://laurentftech.github.io/pi-outpost/, acknowledge draw.io and selected components with their roles, and offer one separate local Third-party notices view with full license texts, without nested accordions. Returning SHALL preserve pending settings; reopening SHALL show Settings.

#### Scenario: BrowseCredits
- **GIVEN** Settings is open without version metadata and has a pending edit
- **WHEN** the user opens Credits
- **THEN** the project website and draw.io attribution are available and the full Apache-2.0 license can be read in the separate Third-party notices view
- **AND** returning to Settings preserves the pending edit

#### Scenario: NavigateCreditsRepeatedly
- **GIVEN** the running widget
- **WHEN** the user repeatedly enters and leaves Credits, uses a short viewport, and closes and reopens Settings
- **THEN** the notices remain reachable by scrolling, no application error occurs, and reopening shows Settings

#### Scenario: SeparateNoticesFromCredits
- **GIVEN** the Credits page
- **THEN** it shows one project website link, understandable component roles, and one Third-party notices action without license accordions
- **WHEN** the user opens notices and returns to Credits
- **THEN** full license texts are available locally and the concise credits page is restored
