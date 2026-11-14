# Spec Delta

## ADDED Requirements

### Requirement: TopBarSpansTheWindow

The application header SHALL span the full width of the window, above the Files sidebar and the main content, whether the sidebar is open or closed and whether a file is shown side by side with the conversation. The Files sidebar SHALL start below the header. Opening, closing or resizing the sidebar SHALL NOT move or narrow the header.

#### Scenario: HeaderAboveTheFilesSidebar
- **GIVEN** the Files sidebar is open
- **THEN** the header starts at the left edge of the window and the sidebar starts below it

#### Scenario: HeaderStaysOnOneRowWhenSplit
- **GIVEN** a wide window with a file shown side by side with the conversation
- **THEN** the header controls fit on the one row they share, unaffected by the width of the conversation pane

#### Scenario: HeaderMenusOverlayThePanes
- **GIVEN** the Files sidebar open and a file shown side by side
- **WHEN** the user opens a header menu (project, sessions, settings)
- **THEN** the menu is drawn above the sidebar, the viewer and the conversation, and is fully usable
