## ADDED Requirements

### Requirement: PicturesAreMarkedWhereTheySit

Extraction SHALL place a marker in the returned markdown at each picture's position in the document's
flow, so that a reader of the extraction learns a picture is there without having to ask. A picture
dropped without a trace is the failure this requirement exists to remove: a caller summarising a
report cannot know it missed the chart the report was written around.

Each marker SHALL name the picture's format and its pixel dimensions, and SHALL carry the picture's
alternative text when the document holds one. It SHALL carry a stable identifier that the same call's
image parameter accepts, so that a caller can ask for one particular picture rather than all of them.

A marker SHALL be placed for a picture whose bytes the system cannot return — an unsupported vector
format, a part that is missing or unreadable — and SHALL say which of those it is. Silence about a
picture the document contains is never correct, whatever the reason the bytes are unavailable.

#### Scenario: PictureIsMarkedInPlace
- **GIVEN** a document with a paragraph, an embedded PNG and a following paragraph
- **WHEN** it is extracted
- **THEN** the markdown holds a marker between the two paragraphs naming the format and dimensions, and the paragraphs keep their order

#### Scenario: AlternativeTextIsCarried
- **GIVEN** a picture whose document declares alternative text
- **WHEN** the document is extracted
- **THEN** the marker carries that text

#### Scenario: UnreadablePictureIsStillNamed
- **GIVEN** a document embedding a picture in a format whose bytes cannot be returned as an image
- **WHEN** it is extracted
- **THEN** a marker states that the picture is present and why its bytes are not available, and the extraction otherwise succeeds

#### Scenario: DocumentWhoseOnlyContentIsAPicture
- **WHEN** a readable document yields no text, headings or tables, but does hold a picture
- **THEN** the result marks the picture rather than reporting the document as having no extractable content

### Requirement: PictureBytesOnlyWhenAsked

Extraction SHALL return picture bytes only when the call asks for them. The default SHALL return
markers alone, so that the cost of extracting a document stays predictable and proportional to its
text — an existing caller MUST NOT start receiving image bytes it did not request.

When pictures are asked for, the system SHALL return them as image content alongside the markdown,
and SHALL apply a bound on both their number and their total bytes. Where the bound is reached the
answer SHALL say how many pictures were left, and SHALL name how to ask for them — the same
obligation the extraction already carries for truncated text.

A vector picture SHALL be rasterised to a viewable image where the system can do so. Where it cannot,
its bytes SHALL be omitted and its marker SHALL say so; the call SHALL NOT fail because one picture
among several could not be prepared.

#### Scenario: NoPictureBytesByDefault
- **WHEN** a document holding pictures is extracted without asking for them
- **THEN** the result holds the markers and no image content

#### Scenario: PicturesReturnedOnRequest
- **GIVEN** a document holding two pictures
- **WHEN** the extraction is asked for its pictures
- **THEN** the result holds the markdown and both pictures as image content, each matching the identifier on its marker

#### Scenario: OnePictureByIdentifier
- **GIVEN** an extraction whose markers carry identifiers
- **WHEN** a later call asks for one of those identifiers
- **THEN** only that picture's bytes are returned

#### Scenario: BudgetIsStatedNotSilent
- **GIVEN** a document holding more picture bytes than one call returns
- **WHEN** its pictures are asked for
- **THEN** the pictures within the bound are returned, and the answer says how many were left and how to ask for them

#### Scenario: OneUnpreparablePictureDoesNotFailTheCall
- **GIVEN** a document holding one picture that can be returned and one that cannot
- **WHEN** its pictures are asked for
- **THEN** the first is returned, the second's marker says why it is not, and the call succeeds
