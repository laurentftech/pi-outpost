## ADDED Requirements

### Requirement: ADiagramInAPosterIsTouchedUpFromIt

In pi-outpost, double-clicking a picture naming a draw.io diagram (`data-drawio`) SHALL open that diagram's named page for touch-up over the poster, with the touch-ups the file viewer offers and a way to open it in draw.io desktop. The poster SHALL stay open beneath, unchanged until the touch-up is closed. A diagram that cannot be read SHALL be named with its reason, and nothing opened.

#### Scenario: DoubleClickOpensTheDiagramsPage
- **GIVEN** a poster holding a picture of the second page of a two-page diagram
- **WHEN** the person double-clicks the picture
- **THEN** that page opens for touch-up over the poster, not the first page and not a file chooser

#### Scenario: TheDiagramCanGoToDrawioDesktop
- **WHEN** the person asks, from the touch-up, to open the diagram in draw.io desktop
- **THEN** the diagram's file is opened with draw.io desktop, where the server can

#### Scenario: AMissingDiagramSaysWhy
- **GIVEN** a picture naming a diagram that no longer exists
- **WHEN** the person double-clicks it
- **THEN** the editor names the diagram it could not open, and the picture is unchanged

### Requirement: TheTouchedUpPageReplacesItsPictures

Closing a diagram's touch-up after it was saved SHALL put the page as now drawn into every picture of the poster showing that page, as unsaved changes. Each picture SHALL keep its place and width, its height following the page's new proportions. Closed without a save, the poster SHALL be unchanged.

#### Scenario: TheSavedPageReplacesThePicture
- **GIVEN** a diagram opened from the poster, a box moved and the diagram saved
- **WHEN** the touch-up is closed
- **THEN** the picture shows the box at its new place, at the same place and width in the poster, and the poster has unsaved changes

#### Scenario: EveryPictureOfThePageIsReplaced
- **GIVEN** two pictures of the same page, and one of another page of the same diagram
- **WHEN** that page is touched up from one of them, saved and closed
- **THEN** both pictures of that page show the new drawing, and the other page's picture is unchanged

#### Scenario: ATallerPageKeepsTheWidth
- **GIVEN** a page that became taller in the touch-up
- **WHEN** it replaces its picture
- **THEN** the picture keeps its width and grows in height, in the page's new proportions

#### Scenario: NothingSavedNothingChanged
- **GIVEN** a diagram opened from the poster and touched up but not saved
- **WHEN** the person closes it and agrees to drop the touch-ups
- **THEN** the pictures and the poster are unchanged, with no unsaved changes

### Requirement: TheTouchUpFollowsItsFile

While a diagram is open for touch-up from a poster, a change saved to its file from elsewhere — draw.io desktop, the agent — SHALL be drawn in it, unless it holds unsaved touch-ups; and closing it SHALL put the page as saved last into the poster.

#### Scenario: ASaveFromDrawioDesktopReachesThePoster
- **GIVEN** a diagram opened from the poster and, from it, in draw.io desktop
- **WHEN** a box is moved in draw.io desktop and saved, then the touch-up is closed
- **THEN** the touch-up showed the moved box, and the poster's picture shows it too
