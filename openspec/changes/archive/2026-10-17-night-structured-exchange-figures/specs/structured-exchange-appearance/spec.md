## ADDED Requirements

### Requirement: FiguresFollowTheReadersTheme

A graph, sequence or timeline drawn in the viewer SHALL follow the page's light or dark
theme, as a Mermaid diagram does. In the dark theme its white ground SHALL be painted as
the dark ground of a Mermaid diagram, dark ink as light ink, and every other colour as a
night counterpart of the same hue. In the light theme every shape SHALL be painted exactly
the colour the figure carries.

#### Scenario: AFigureFollowsTheDarkTheme
- **WHEN** a graph, a sequence and a timeline are shown with the dark theme applied
- **THEN** each figure's ground is painted dark and its labels light, and no colour the figure carries is painted unchanged
- **AND** the timeline's frame around the drawing is dark too

#### Scenario: AFigureOnALightPageIsUnchanged
- **WHEN** the same figures are shown with the light theme applied
- **THEN** every shape is painted the colour the figure declares for it

### Requirement: AFigureLeavesInItsDayColours

A figure downloaded or copied from a dark page, and a figure written into a document,
SHALL carry its day colours and no theme-dependent paint.

#### Scenario: ADownloadedFigureKeepsItsDayColours
- **WHEN** the reader downloads a graph or a timeline from a dark page
- **THEN** the file carries the white ground and no theme-dependent colour

### Requirement: AKindKeepsItsColourAtNight

A kind's night colour, declared by the project or assigned automatically, SHALL keep its
hue, so it still matches its swatch in the key.

#### Scenario: AKindKeepsItsHueAtNight
- **WHEN** a kind is drawn in blue, orange, green, violet or red, declared or automatic
- **THEN** its night colour is the same hue, and its distance from the ground keeps a strong stroke strong and a pale fill pale

### Requirement: ATableKeyNamesItsRoleColours

The role key above a table SHALL show each role as a swatch outlined in that role's own
colour, distinct from the other roles' and standing off the page's background, in both
the light and the dark theme.

#### Scenario: ATableKeyShowsItsRoleColours
- **WHEN** a table whose rows declare change roles is shown, in the light theme and in the dark theme
- **THEN** each swatch in its key has an outline at least two pixels wide in a colour clearly distinct from the background and from the other roles' outlines
