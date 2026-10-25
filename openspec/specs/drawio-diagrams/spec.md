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

### Requirement: DrawioInTheConversation

When a reply references a workspace `.drawio` file as a picture, the conversation SHALL
draw the diagram in place, isolated as in the file viewer, instead of showing an image.
A reference to a file that is missing or that draw.io cannot read SHALL say so, naming the
file, rather than leave an empty or broken picture. A conversation export SHALL carry
such a reference as a link to the file, never as a broken picture.

#### Scenario: AReferencedDiagramIsDrawnInTheReply
- **WHEN** a reply contains `![architecture](./architecture.drawio)` and the file exists
- **THEN** the diagram is drawn in the reply, in a frame with the same isolation as the file viewer's

#### Scenario: AMissingDiagramSaysSo
- **WHEN** a reply references a `.drawio` file that does not exist or that draw.io cannot read
- **THEN** the reply says the diagram could not be shown and names the file, and no empty frame or broken picture is left

#### Scenario: TheReplyFollowsTheFile
- **GIVEN** a diagram drawn in a reply
- **WHEN** the file is saved, by touch-up or by another application
- **THEN** the drawing in the reply shows the saved diagram

#### Scenario: AnExportCarriesALink
- **WHEN** a conversation whose reply references a `.drawio` file is exported to HTML or Word
- **THEN** the export shows the reference as a link naming the file, and no broken picture

### Requirement: DrawioDiagramControls

Wherever a `.drawio` diagram is drawn, in a reply or in the file viewer, it SHALL offer the
controls the other diagrams offer, in the same place and appearance:
- show it at full size;
- download the shown page as SVG;
- download the `.drawio` file.

In a reply, it SHALL also offer to open the file in the file viewer. The full-size view
SHALL offer the same downloads.

#### Scenario: EnlargeShowsTheDiagramAtFullSize
- **WHEN** the reader asks to enlarge a drawn diagram
- **THEN** the diagram is shown at full size over the application, with its downloads, and closing the view returns to where it was

#### Scenario: DownloadSvgSavesThePageShown
- **GIVEN** a diagram with several pages, showing its second page
- **WHEN** the reader downloads it as SVG
- **THEN** an `.svg` file of that page is saved, and it shows its labels when opened outside pi-outpost

#### Scenario: DownloadDrawioSavesTheFile
- **WHEN** the reader downloads the `.drawio` file
- **THEN** the file's content is saved under its own name, as it is on disk

#### Scenario: OpenTheFileFromTheReply
- **WHEN** the reader asks to open a diagram drawn in a reply
- **THEN** the file opens in the file viewer

### Requirement: DrawioTouchUp

The file viewer and the full-size view SHALL offer a touch-up mode on the page shown. In
it, the reader can move and resize shapes, move a connector's bends, re-attach either of
its ends, draw a connector from a shape, edit a label in place, delete the selection, and
undo or redo. Outside touch-up mode the diagram SHALL stay read-only.

#### Scenario: ShapesMoveAndConnectorsFollow
- **WHEN** the reader moves a shape in touch-up mode and saves
- **THEN** the file holds the shape at its new place, and the connectors attached to it still are

#### Scenario: AConnectorIsReattached
- **WHEN** the reader drags a connector's end from one shape onto another and saves
- **THEN** the file's connector ends at the new shape, under the same id

#### Scenario: ALabelIsEditedInPlace
- **WHEN** the reader double-clicks a shape, types a new label and confirms it
- **THEN** the label is edited where the shape is, and the saved file holds the new label

#### Scenario: UndoRestoresTheDiagram
- **WHEN** the reader undoes a touch-up
- **THEN** the diagram is as it was before it

#### Scenario: ReadingIsReadOnly
- **WHEN** the diagram is shown outside touch-up mode
- **THEN** clicking or dragging on it changes nothing in the diagram

### Requirement: DrawioTouchUpSaving

Saving a touch-up SHALL write the touched-up page back into the file, leaving the file's
other pages, the page's settings and the ids of remaining cells untouched. It SHALL refuse
to overwrite a file changed on disk since touch-up began, and say so. Leaving touch-up
with unsaved edits SHALL ask before discarding them.

#### Scenario: SavingKeepsTheRestOfTheFile
- **GIVEN** a file with several pages and page settings such as grid and page size
- **WHEN** one page is touched up and saved
- **THEN** the other pages and the page's settings are unchanged, and every cell that was not deleted keeps its id

#### Scenario: AFileChangedOnDiskIsNotOverwritten
- **GIVEN** touch-up has begun
- **WHEN** the file is changed on disk and the reader saves
- **THEN** the save is refused with a conflict the reader can see, and the file on disk is unchanged

#### Scenario: UnsavedTouchUpIsNotLostSilently
- **WHEN** the reader leaves touch-up mode, or closes the view, with unsaved edits
- **THEN** they are asked whether to discard them, and nothing is discarded unless they agree

### Requirement: DrawioShownByTheAgent

The agent's guidance for draw.io SHALL tell it to show a diagram it has written or changed
in its reply, by referencing the file as a picture, once the check reports no error.

#### Scenario: TheGuidanceAsksToShowTheDiagram
- **WHEN** the agent's draw.io skill and the check tool's guidance are read
- **THEN** both tell it to reference the checked `.drawio` file as a picture in its reply
