## ADDED Requirements

### Requirement: HtmlFilesAreRendered

An HTML file (`.html`, `.htm`) SHALL open rendered in the file viewer, with the modes a Markdown file
has: rendered by default, source, and rendered beside the source while editing. Its scripts SHALL run,
and its stylesheets, pictures and scripts referenced by relative path SHALL be drawn, with no choice
asked of the user.

#### Scenario: AnHtmlReportOpensRendered
- **GIVEN** a workspace HTML page with a relative stylesheet, a relative picture and a relative script that writes into the page
- **WHEN** the user opens it in the viewer
- **THEN** the page is shown rendered with no choice asked: the stylesheet's rule applies, the picture shows, and the script's text is in the page

#### Scenario: HtmlIsEditedBesideItsRendering
- **WHEN** the user edits an HTML file in the side-by-side mode
- **THEN** the rendering follows the draft

### Requirement: ARenderedPageIsIsolated

A rendered HTML page SHALL be drawn in a sandboxed frame with an opaque origin. Its relative resources
SHALL be fetched by the viewer and written into the page, so that no address carrying the access token
enters it. The server SHALL still answer an HTML file on `/files/raw` as an attachment.

#### Scenario: ThePageCannotReachTheApplication
- **WHEN** an opened page's script tries to read the application's document, its storage and the access token
- **THEN** each attempt fails, and the page's document holds no `/files/raw` address and no token

### Requirement: LinksInARenderedPage

A relative link in a rendered page SHALL open the linked workspace file in the viewer, an absolute link
a new tab, and an anchor SHALL stay in the page. Only the page's own frame SHALL be able to ask the
viewer to open a file.

#### Scenario: ARelativeLinkOpensInTheViewer
- **WHEN** the user clicks a relative link in a rendered page
- **THEN** the linked workspace file opens in the viewer, and a message from anything but the page's own frame opens nothing
