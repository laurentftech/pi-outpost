## ADDED Requirements

### Requirement: TheAgentChecksThePostersItWrites

pi-outpost SHALL give the agent a `poster_check` tool that reads a `.poster.html` within the read
zone, writes nothing, and reports errors (what the editor refuses or does not draw) and warnings
(what reads badly), each saying what to write instead, or that the poster has no defect. The tool's
prompt guideline SHALL ask for a check after every write or edit of a poster, whether or not the
posters skill was read. The tool SHALL be published by the SDK, sandbox and RPC runtimes alike.

#### Scenario: APageThatIsNotAPosterIsNamed
- **GIVEN** a `.poster.html` without the `poster-format` meta, the `<style data-poster>` stylesheet or the `<div class="poster-page">`
- **WHEN** the agent checks it
- **THEN** the report is an error naming the missing marker and pointing to the skeleton

#### Scenario: AFileTheEditorWouldNotDrawIsNamed
- **GIVEN** a poster whose markup holds `<img src="../docs/architecture.drawio">`, `<img src="../figures/car.svg">` and `<img src="https://example.org/a.png">`, and whose stylesheet holds `url(../figures/car.svg)`
- **WHEN** the agent checks it
- **THEN** each is an error: the diagram's says the empty frame to write with `data-drawio` and that path, the SVG's the frame with `data-picture-file`, the web picture's that a poster fetches nothing, and the stylesheet's names the `url()`

#### Scenario: WhatTheEditorRemovesIsNamed
- **GIVEN** a poster holding an `onclick` attribute, an `<iframe>` and a `<link>`
- **WHEN** the agent checks it
- **THEN** each is an error saying the editor removes it

#### Scenario: AFrameNamingSomethingMissingIsNamed
- **GIVEN** frames naming a diagram that does not exist, a page the diagram does not have, a picture file that does not exist, a file that is not a picture, and a path leaving the read zone
- **WHEN** the agent checks the poster
- **THEN** each frame is an error naming its path and why it cannot be filled, and no file outside the read zone is opened

#### Scenario: AWellFormedPosterPasses
- **GIVEN** a poster written from the skeleton, with an empty frame naming an existing diagram page and one naming an existing SVG figure
- **WHEN** the agent checks it
- **THEN** the report says the poster has no defect, gives its format, and lists both frames as filled when the poster is opened

#### Scenario: WarningsDoNotFailThePoster
- **GIVEN** a poster with text inside an SVG drawing, a drawing over 50 kB, and a `.poster-page` size that is not its format's
- **WHEN** the agent checks it
- **THEN** each is a warning saying what to change, and the report says the poster opens

#### Scenario: TheAgentChecksAPosterItWrote
- **WHEN** the person asks a live model for a poster holding a draw.io diagram and an SVG figure of the project
- **THEN** the model runs `poster_check` on the poster it wrote, and the poster it hands over opens in the editor with both pictures drawn

### Requirement: FramesFilledOnOpenAreNotThePersonsTouchUps

Frames the editor fills when a poster opens SHALL make Save available, and SHALL NOT by
themselves make the viewer ask before dropping the poster: dropped, they are filled again on the
next opening. A touch-up the person makes, before or after the frames are filled, SHALL still be
asked about. The editor SHALL say the filled pictures are drawn from the project and that saving
keeps them in the file.

#### Scenario: LeavingAFilledPosterAsksNothing
- **GIVEN** a poster whose frames name a draw.io diagram and a picture file of the project
- **WHEN** the person opens it, the frames are filled, and the person leaves the rendered view without touching anything
- **THEN** Save was available, nothing is asked, and the file on disk is unchanged

#### Scenario: AFilledPosterTouchedUpIsAskedAbout
- **GIVEN** the same poster, opened and its frames filled
- **WHEN** the person corrects a text and leaves the rendered view
- **THEN** the viewer asks before dropping the touch-up
