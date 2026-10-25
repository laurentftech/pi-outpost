## MODIFIED Requirements

### Requirement: PosterHoldsNoScriptAndFetchesNothing

A poster SHALL be refused when its markup holds a script, and SHALL be shown, edited and exported without any request leaving for a resource it names. Pictures are emoji, SVG drawings written in the poster, or pictures embedded in it.

#### Scenario: AScriptIsRefused
- **WHEN** a poster's markup contains a `<script>` element
- **THEN** it is refused, and nothing is written

#### Scenario: ARemoteImageIsNotFetched
- **GIVEN** a poster whose markup names an image on another server
- **WHEN** it is shown, edited or exported
- **THEN** no request is made for that image

### Requirement: PosterSizeIsBounded

A poster's markup and stylesheet together SHALL be refused above a fixed ceiling of 8 MB, with a message saying how large it is and telling the model to shrink or remove pictures or drawings.

#### Scenario: AnOversizedPosterIsRefused
- **WHEN** a poster's markup and stylesheet exceed the ceiling
- **THEN** it is refused with that advice, and nothing is written

#### Scenario: APosterWithSeveralPicturesFits
- **WHEN** a poster holds six pictures the person added through the editor
- **THEN** it is accepted and saved

### Requirement: ThePosterGuide

Every host SHALL give the model the same guide for writing a poster: the page sizes, filling the page, styling through classes, every text as real text in ordinary elements, system fonts only, nothing fetched, no script. For pictures it SHALL teach emoji, SVG drawings each in an element of its own with a viewBox and no text, and named picture slots for the person's own pictures.

#### Scenario: EveryHostGivesTheSameGuide
- **WHEN** the guide is read from the Claude extension, the pi-outpost skill and the Open WebUI tool descriptions
- **THEN** each holds the same rules, from one source

#### Scenario: TheGuideTeachesSlotsAndDrawings
- **WHEN** the guide is read
- **THEN** it says how to lay out a named picture slot styled as empty only while empty, and how to write a drawing in its own element, and it no longer forbids pictures embedded in the poster
