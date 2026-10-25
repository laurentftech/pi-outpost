# openwebui-embed-theme Specification

## Purpose
The light or dark theme in which the embeds of pi-outpost's Open WebUI tool server — plannings, structures, document cards and posters — are drawn, and how they follow a change of it.

## Requirements

### Requirement: EmbedsFollowOpenWebUIsTheme

When an embed can read the page Open WebUI draws it in, it SHALL draw in Open WebUI's own theme — dark when Open WebUI's root element carries the `dark` class, light otherwise — whatever the system's colour scheme.

#### Scenario: DarkOpenWebUIOnALightSystem
- **GIVEN** Open WebUI in a dark theme on a light system, with same-origin frames allowed
- **WHEN** a planning or a poster is shown
- **THEN** the embed is drawn dark

#### Scenario: LightOpenWebUIOnADarkSystem
- **GIVEN** Open WebUI in a light theme on a dark system, with same-origin frames allowed
- **WHEN** a planning or a poster is shown
- **THEN** the embed is drawn light

### Requirement: EmbedsFollowAThemeChange

An open embed SHALL follow a change of the theme it follows — Open WebUI's when it can read it, the system's otherwise — without being shown again.

#### Scenario: TheUserSwitchesOpenWebUIsTheme
- **GIVEN** a poster shown in a light Open WebUI, with same-origin frames allowed
- **WHEN** the user switches Open WebUI to dark
- **THEN** the poster editor turns dark, and the poster keeps its own colours

#### Scenario: TheSystemSwitchesWhileOpen
- **GIVEN** a planning shown with same-origin frames not allowed, on a light system
- **WHEN** the system switches to dark
- **THEN** the timeline is drawn dark

### Requirement: WithoutAccessTheSystemDecides

When the embed cannot read Open WebUI's page — Open WebUI's default frame, of an opaque origin — it SHALL follow the system's colour scheme, and reading SHALL never fail the embed.

#### Scenario: TheDefaultFrameFollowsTheSystem
- **GIVEN** Open WebUI's default frame and a dark system
- **WHEN** a document card is shown
- **THEN** it is drawn dark, and nothing is reported as an error

### Requirement: PosterSaveIsDisabledWithoutChanges

The shared poster editor SHALL disable its Save control when the opened poster has no unsaved changes, enable it when an editable change is made, and disable it again after a successful save. This SHALL apply in every integration that uses the shared editor.

#### Scenario: SaveIsAvailableOnlyForUnsavedChanges
- **GIVEN** a poster is open in an integration with saving enabled
- **WHEN** it is first opened, changed, and then saved successfully
- **THEN** Save is disabled, enabled, and disabled again in those respective states
