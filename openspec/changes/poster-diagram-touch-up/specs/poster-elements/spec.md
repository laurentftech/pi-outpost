## MODIFIED Requirements

### Requirement: ASlotIsFilledByDoubleClick

Double-clicking a picture or a picture slot in the editor SHALL ask the person for a picture file, and the chosen picture SHALL replace what that element showed, keeping its place and size. A picture drawn from a draw.io diagram, in a host that can touch diagrams up, SHALL open that diagram instead (poster-files).

#### Scenario: ThePersonFillsASlot
- **WHEN** the person double-clicks the "bread" slot and picks a picture file
- **THEN** the slot shows that picture, at the slot's place and size

#### Scenario: ADiagramPictureElsewhereStillAsksForAFile
- **GIVEN** a picture naming a draw.io diagram, in a host that cannot draw diagrams (Claude Desktop, Open WebUI)
- **WHEN** the person double-clicks it
- **THEN** the editor asks for a picture file, as for any other picture
