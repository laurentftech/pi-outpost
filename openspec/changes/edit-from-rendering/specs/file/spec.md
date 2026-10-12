## ADDED Requirements

### Requirement: EditingFromTheRenderingMovesToTheText

When the reader opens the editor while a file with a rendering shows that rendering, the viewer SHALL
show the editor beside the rendering, or the source alone when there is no room for two panes. Leaving
the editor SHALL bring the rendering back, unless the reader chose another mode meanwhile.

#### Scenario: EditFromTheRenderingGoesBesideIt
- **GIVEN** a Markdown, HTML or structured-exchange file shown rendered, with room for two panes
- **WHEN** the reader clicks edit, then done
- **THEN** the side-by-side mode is shown with the editor and the rendering, and after done the rendering alone again

#### Scenario: EditFromTheRenderingWithoutRoomShowsTheSource
- **GIVEN** a file shown rendered, without room for two panes
- **WHEN** the reader clicks edit, then done
- **THEN** the source mode is shown with the editor, and after done the rendering again
