## ADDED Requirements

### Requirement: TheViewFollowsTheHostTheme

The planning view SHALL draw in the theme the host states in its context, and SHALL
follow a change of that theme while it is open: in a dark host the card, the timeline
and the plannings list SHALL be dark with light text, and in a light host they SHALL be
light. A figure downloaded or copied from the view SHALL carry its light colours
whatever the host's theme.

#### Scenario: AViewFollowsADarkHost
- **WHEN** a planning is shown in a host whose theme is dark
- **THEN** the card and the timeline's ground are dark, and its labels light

#### Scenario: AViewFollowsALightHost
- **WHEN** a planning is shown in a host whose theme is light
- **THEN** the card and the timeline's ground are white, and its labels dark

#### Scenario: AViewFollowsAThemeSwitchedLive
- **WHEN** the host switches from light to dark and back while a planning is shown
- **THEN** the timeline turns dark, then light again, without being shown anew

#### Scenario: AListFollowsADarkHost
- **WHEN** the plannings list is shown in a host whose theme is dark
- **THEN** the card is dark and the plannings' titles light

#### Scenario: ADownloadFromADarkHostIsTheLightFigure
- **WHEN** the reader downloads the figure from a planning shown in a dark host
- **THEN** the saved SVG carries the white ground and no theme-dependent colour
