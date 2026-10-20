# drawio-diagrams Specification

## Purpose
pi-outpost draws `.drawio` files in its file viewer with the vendored jgraph viewer, offline and in a sandboxed frame; the agent writes them guided by the `drawio` skill and checks them with `drawio_check`; editing happens in draw.io desktop through "open in draw.io".

## Requirements

### Requirement: DrawioViewing

The file viewer SHALL render a `.drawio` file with jgraph's viewer, offering every page of
the diagram, and SHALL offer the rendered, split and source modes it offers other
renderable files. A file it cannot read SHALL say why and show its source.

#### Scenario: ADrawioFileIsDrawn
- **WHEN** a `.drawio` file is opened
- **THEN** its diagram is drawn, and the source and split modes are offered

#### Scenario: EveryPageIsReachable
- **GIVEN** a diagram with several pages
- **WHEN** it is opened
- **THEN** the reader can move to each page

#### Scenario: TheDraftIsDrawnBesideIt
- **WHEN** the file is edited in the split mode
- **THEN** the rendering follows the draft, without the viewer being reloaded

#### Scenario: AnUnreadableDiagramSaysWhy
- **WHEN** the file is not a diagram draw.io can read
- **THEN** the viewer says so and shows the source, rather than an empty frame

### Requirement: DrawioViewerIsolation

The diagram SHALL be drawn in a frame with an opaque origin whose policy permits no
connection other than loading the viewer script from pi-outpost.

#### Scenario: TheViewerNeverReachesTheNetwork
- **WHEN** a diagram that refers to remote images, fonts or stencils is drawn
- **THEN** no request leaves for them, and the frame can reach neither the application nor its token

### Requirement: DrawioEditingInTheDesktopApplication

The viewer SHALL offer to open a `.drawio` file with the application associated with it,
and SHALL redraw the file when it changes on disk.

#### Scenario: OpenInDrawio
- **WHEN** the reader asks to open the diagram in draw.io
- **THEN** the server opens the file with its associated application

#### Scenario: TheDiagramFollowsTheFile
- **WHEN** the file is saved by another application
- **THEN** the rendering shows the saved diagram

### Requirement: DrawioCheck

The agent SHALL have a tool that reads a `.drawio` file inside its read zone, plain or
with compressed pages, and reports errors that would make it open wrong and warnings that
would make it read badly, naming the cells involved.

#### Scenario: TheCheckerReportsDefects
- **WHEN** a diagram has a duplicate id, a cell whose parent does not exist, a connector whose end does not exist, a connector attached to nothing, or a shape with unusable geometry
- **THEN** each is reported as an error naming the cell, and the diagram is not called valid

#### Scenario: TheCheckerWarnsAboutLayout
- **WHEN** two shapes overlap, or a shape lies outside the container it belongs to
- **THEN** each is reported as a warning naming the shapes

#### Scenario: CompressedPagesAreRead
- **WHEN** a page is stored compressed, as draw.io writes it by default
- **THEN** it is checked like a plain one

#### Scenario: ACleanDiagramPasses
- **WHEN** a diagram has no defect
- **THEN** the check says so, with its pages, shapes and connectors counted

#### Scenario: TheCheckerStaysInTheSandbox
- **WHEN** the path is outside the read zone, or the file is not XML draw.io can read
- **THEN** the check refuses with the reason, and reads nothing outside the zone
