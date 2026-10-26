## ADDED Requirements

### Requirement: AProjectPictureIsInserted

In pi-outpost, the poster editor's Insert menu SHALL offer the project's pictures (SVG, PNG, JPEG,
GIF and WebP files). The chosen one SHALL be put in the poster as a picture, into the selected
picture frame or onto the page, carrying `data-picture-file`. An SVG SHALL be kept as its own SVG;
a raster SHALL be scaled as a picture chosen from the person's computer is. A file that cannot be
read or is no picture SHALL be named with its reason, and the poster left unchanged.

#### Scenario: TheProjectsPicturesAreOffered
- **GIVEN** a project holding an SVG figure and a PNG
- **WHEN** the person opens Insert, then Picture from the project
- **THEN** both are offered, as paths from the poster's directory

#### Scenario: AnSvgStaysVector
- **WHEN** the person chooses an SVG of the project
- **THEN** the picture holds that SVG itself, not a raster of it, in the SVG's proportions

#### Scenario: ARasterIsScaled
- **WHEN** the person chooses a PNG wider than 1200 pixels
- **THEN** the picture is a PNG at most 1200 pixels wide

### Requirement: AFrameNamingAProjectPictureIsFilledOnOpen

An empty picture frame carrying `data-picture-file` SHALL be filled with that file when the poster
opens in pi-outpost's editor, as an unsaved touch-up, under the same rules as a frame naming a
diagram: resolved from the poster's directory or the root, read within the server's read zone, a
filled frame left as it is, a file that cannot be read leaving its frame empty and named.

#### Scenario: AFigureTheAgentWroteFillsItsFrame
- **GIVEN** a poster with an empty frame naming an SVG figure of the project
- **WHEN** the poster opens in the editor
- **THEN** the frame shows the figure as its SVG, the poster has unsaved changes, and once saved the file holds it

#### Scenario: AMissingPictureLeavesTheFrameEmpty
- **GIVEN** a frame naming a file that does not exist, and one naming a file that is no picture
- **WHEN** the poster opens
- **THEN** both frames stay empty and the editor names each with its reason

### Requirement: TheAgentIsTaughtPictureFrames

pi-outpost's posters skill SHALL tell the agent to put a picture file of the project in a poster
through an empty frame naming it, the figures it writes with `write_structure_figure` among them,
and never to paste an SVG into the markup.

#### Scenario: TheSkillNamesPictureFrames
- **WHEN** the agent reads the posters skill
- **THEN** it learns `data-picture-file`, that the editor fills the frame, and that its own figures go in this way
