# poster-elements Specification

## Purpose
What the person and the model put on a poster besides its text: the person's own pictures, inserted into the frames the model laid out or onto the page; text boxes and shapes added from the editor's Insert menu; drawings the model writes in SVG. All are handled as wholes in the editor, and embedded pictures are kept out of what the model reads and restored in what it writes.

## Requirements

### Requirement: PictureSlots

A poster SHALL be able to hold empty picture frames the model lays out, each an image element marked as a picture slot and named for what it should show. An empty slot SHALL be shown as the model styled it, so the person sees where a picture goes.

#### Scenario: AnEmptySlotIsShown
- **GIVEN** a poster with a picture slot named "bread", styled with a dashed border
- **WHEN** the poster is opened in the editor
- **THEN** the slot is drawn at its place with its dashed border, and no request leaves for a picture

### Requirement: ASlotIsFilledByDoubleClick

Double-clicking a picture or a picture slot in the editor SHALL ask the person for a picture file, and the chosen picture SHALL replace what that element showed, keeping its place and size.

#### Scenario: ThePersonFillsASlot
- **WHEN** the person double-clicks the "bread" slot and picks a picture file
- **THEN** the slot shows that picture, at the slot's place and size

### Requirement: AFilledSlotLosesItsEmptyLook

When a picture fills a slot, that element's own border and background SHALL be cleared, whatever the poster's stylesheet gives the slot, so that a frame marking an empty slot does not stay around the picture.

#### Scenario: TheDashedFrameGoes
- **GIVEN** a slot styled with a dashed border and a tinted background
- **WHEN** a picture fills it
- **THEN** the picture is shown without the border and without the tint, and the other slots keep theirs

### Requirement: InsertMenu

The editor SHALL offer one "Insert" control opening a menu of what can be added: a picture, a text box, and each shape. The control SHALL be hidden where the poster cannot be edited.

#### Scenario: TheMenuListsWhatCanBeInserted
- **WHEN** the person opens the Insert menu
- **THEN** it offers Picture, Text and the shapes, and choosing one closes the menu

#### Scenario: AReadOnlyPosterOffersNoInsert
- **GIVEN** a poster shown read-only
- **THEN** no Insert control is offered

### Requirement: InsertPicture

Insert → Picture SHALL ask for a picture file. With a picture or slot selected, the picture SHALL replace it; otherwise it SHALL be placed on the page, a third of the page wide, centred on the page.

#### Scenario: APictureIsInsertedOnThePage
- **GIVEN** nothing selected
- **WHEN** the person chooses Insert → Picture and picks a file
- **THEN** the picture appears centred on the page, selected, and the other elements stay where they were

#### Scenario: InsertPictureFillsTheSelectedSlot
- **GIVEN** the "bread" slot selected
- **WHEN** the person chooses Insert → Picture and picks a file
- **THEN** the "bread" slot shows the picture

### Requirement: InsertText

Insert → Text SHALL place a text box centred on the page, holding a placeholder text that is selected and ready to be typed over. It SHALL take the poster's font, and SHALL be corrected, restyled, moved and resized like any other element.

#### Scenario: ATextBoxIsAdded
- **WHEN** the person chooses Insert → Text and types "Bon appétit !"
- **THEN** the page shows "Bon appétit !" in a box at its centre, in the poster's font, and it is kept when saved

#### Scenario: ATextBoxIsMovedAndResized
- **WHEN** the person drags the text box and pulls its corner
- **THEN** it moves by the distance dragged, and its text rewraps to the new width

### Requirement: InsertShape

Insert → a shape SHALL place that shape centred on the page, at a default size, in a default colour: filled, or for the line, drawn in it. The shapes SHALL be rectangle, rounded rectangle, ellipse, triangle, arrow, line, star and speech bubble. A shape SHALL be moved and resized as one block, freely in both directions.

#### Scenario: AShapeIsAdded
- **WHEN** the person chooses Insert → Ellipse
- **THEN** an ellipse appears centred on the page, selected, with corner handles

#### Scenario: AShapeIsStretched
- **WHEN** the person pulls the right edge of a rectangle
- **THEN** the rectangle gets wider and keeps its height

### Requirement: ShapeColours

The Format panel SHALL set a selected shape's fill colour and line colour, and the line's thickness, on that shape only.

#### Scenario: AShapeIsRecoloured
- **GIVEN** two rectangles on the page
- **WHEN** the person sets the fill of one to green in the Format panel
- **THEN** that rectangle is green, and the other keeps its colour

#### Scenario: AShapeKeepsItsColoursInTheExport
- **GIVEN** a shape recoloured in the editor
- **WHEN** the poster is exported to Word
- **THEN** the shape has the same fill and line in the exported page

### Requirement: AShapeHoldsText

Double-clicking a shape other than the line SHALL let the person type text inside it, centred in the shape and wrapping within it. The text SHALL move and resize with the shape, and SHALL take the font, size and colour the Format panel sets on the shape.

#### Scenario: TextIsTypedInAShape
- **WHEN** the person double-clicks a rectangle and types "Entrée"
- **THEN** "Entrée" is shown centred in the rectangle, and is kept when saved

#### Scenario: TheTextFollowsItsShape
- **GIVEN** a rectangle holding text
- **WHEN** the person drags the rectangle and sets its text colour in Format
- **THEN** the text moves with the rectangle and takes the colour

### Requirement: SpeechBubbleTailIsMoved

A selected speech bubble SHALL show a handle at the tip of its tail. Dragging the handle SHALL move the tip, in any direction and beyond the bubble's box. The tail SHALL leave from the side of the bubble facing the tip, and its position SHALL be kept when saved and reopened.

#### Scenario: TheTailPointsElsewhere
- **GIVEN** a speech bubble whose tail points down and left
- **WHEN** the person drags its handle above and to the right of the bubble
- **THEN** the tail now leaves the top of the bubble and ends where the handle was released

#### Scenario: TheTailIsKept
- **GIVEN** a bubble whose tail was moved and the poster saved
- **WHEN** the poster is opened again
- **THEN** the tail ends where it was left, and its handle is there when the bubble is selected

### Requirement: ADroppedPictureIsPlaced

A picture file dropped on the editor's page SHALL fill the picture or slot it is dropped on, or otherwise be placed centred on the point where it was dropped, kept within the page. A dropped file that is not a picture SHALL be ignored.

#### Scenario: APictureIsDroppedOnACard
- **WHEN** the person drops a picture file from the desktop onto a card with no picture
- **THEN** the picture appears centred where it was dropped

#### Scenario: APictureIsDroppedOnASlot
- **WHEN** the person drops a picture file onto the "bread" slot
- **THEN** the slot shows the picture

### Requirement: PicturesAreScaledAndEmbedded

A picture the person adds SHALL be scaled down so that its longest side is at most 1200 pixels, never scaled up, and embedded in the poster itself, so the poster stays one self-contained page that opens, prints and exports without fetching anything. A picture that may hold transparency SHALL keep it.

#### Scenario: ALargePictureIsScaledDown
- **WHEN** the person adds a 2400 × 1800 picture
- **THEN** the poster holds it at 1200 × 900, embedded, and nothing is fetched to show it

#### Scenario: ATransparentPictureStaysTransparent
- **WHEN** the person adds a PNG with a transparent background
- **THEN** the embedded picture is still transparent where the original was

#### Scenario: AFileThatIsNotAPictureIsRefused
- **WHEN** the person picks a file that cannot be read as a picture
- **THEN** the editor says so, and the poster is unchanged

### Requirement: ElementsMoveAndResizeWhole

A picture, a shape or a text box SHALL move by the distance the mouse travels with the button held; a picture SHALL keep its proportions when resized from a corner. A press that travels less than a few pixels SHALL remain a click or a double-click. The host's own dragging of an image SHALL never start, so a picture cannot be carried off its card.

#### Scenario: APictureInASlotIsMoved
- **GIVEN** a filled slot inside a card
- **WHEN** the person drags it 40 pixels right and 30 down on screen
- **THEN** it moves by that distance at the current zoom, and stays in the poster

#### Scenario: APictureIsResized
- **WHEN** the person pulls a corner of a picture
- **THEN** its width and height change in the same proportion

#### Scenario: APlacedPictureStillMovesAfterReopening
- **GIVEN** a picture, a shape and a text box placed on the page, the poster saved and opened again
- **WHEN** the person drags each of them
- **THEN** each moves by the distance dragged

### Requirement: DrawingsAreHandledWhole

A drawing the model wrote in SVG, in an element of its own holding that one SVG, SHALL be selected, moved and resized as one block: a click on any of its shapes selects the element holding it, and resizing keeps its proportions. Its shapes SHALL never be selected one by one.

#### Scenario: AClickOnAShapeSelectsTheDrawing
- **GIVEN** a door drawn in SVG inside a drawing element in a card
- **WHEN** the person clicks one of the door's panels
- **THEN** the whole drawing is selected, with corner handles

#### Scenario: DraggingADrawingLeavesItsCard
- **WHEN** the person drags the selected drawing
- **THEN** the drawing moves, and the card holding it does not

### Requirement: TheModelSeesMarkersNotPictureData

Whenever a host gives the model a poster's markup, each embedded picture SHALL be replaced by a short marker naming it, with the picture's size in bytes, so no picture data reaches the model. This SHALL hold for the Claude extension's and the Open WebUI tool server's poster reading tools and for the pi-outpost agent reading a poster file.

#### Scenario: GetPosterReturnsMarkers
- **GIVEN** a poster holding three pictures the person added
- **WHEN** the model reads it through the poster tools
- **THEN** the markup holds three markers and no picture data, and every other element and text is as saved

#### Scenario: TheAgentReadsAPosterFileWithPictures
- **GIVEN** a `.poster.html` file in a pi-outpost project holding pictures
- **WHEN** the agent reads the file
- **THEN** it reads markers in place of the picture data, and the rest of the file as it is

### Requirement: MarkersAreRestoredOnWrite

When the model sends back a poster holding markers, each marker SHALL be replaced by the picture it names from the poster as last read or stored, before the poster is checked and written. A marker naming no known picture SHALL be refused with a message saying so, and nothing written. A picture whose marker the model left out SHALL be dropped, as the model asked.

#### Scenario: TheModelRewritesAPosterAndKeepsItsPictures
- **GIVEN** a poster with three pictures the model read as markers
- **WHEN** the model changes a title and sends the poster back with the markers as they were
- **THEN** the saved poster holds the new title and the three pictures, unchanged

#### Scenario: AnUnknownMarkerIsRefused
- **WHEN** the model sends a poster with a marker that names no picture of that poster
- **THEN** the update is refused with a message naming the marker, and the poster is unchanged

#### Scenario: TheAgentEditsAPosterFileWithPictures
- **GIVEN** a `.poster.html` file holding pictures, read by the agent as markers
- **WHEN** the agent edits a text in it, or writes the whole file back with the markers
- **THEN** the file on disk holds the edit and the pictures, unchanged

### Requirement: TheAgentCanLookAtAPostersPictures

pi-outpost SHALL give the agent a tool that answers the pictures of a poster file as images it can look at, each announced by its marker, up to eight per call, or those it names. A model that does not take images SHALL be told so and sent no picture data. The tool SHALL read only inside the agent's read zone.

#### Scenario: TheAgentSeesWhatAFrameHolds
- **GIVEN** a poster file whose frame named "bread" holds a picture of a family
- **WHEN** an agent whose model takes images asks to look at the poster's pictures
- **THEN** it receives that picture as an image after its marker

#### Scenario: AModelWithoutVisionIsToldSo
- **WHEN** an agent whose model takes no images asks to look at the poster's pictures
- **THEN** it is told the model cannot see them and not to guess, and no picture data is sent
