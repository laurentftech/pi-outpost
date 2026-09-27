## ADDED Requirements

### Requirement: SlidePicturesAreMarkedAndReturnable

Slide extraction SHALL mark each picture at its place in the slide's content, naming the picture's
format and pixel dimensions and carrying its alternative text when the slide declares one, with a
stable identifier the same call's picture parameter accepts.

This matters more on a slide than in a document: a deck's argument often lives in its pictures, and a
slide whose content is only a picture currently reads as a slide with nothing on it.

Picture bytes SHALL travel only when the call asks for them, under a bound on their number and total
bytes, and the answer SHALL say what was left and how to ask for it. A vector picture SHALL be
rasterised where the system can, and its marker SHALL say so where it cannot.

A picture whose bytes cannot be returned SHALL still be marked, with the reason. Content that is not
a picture at all — a native chart, a diagram, a grouped drawing, a shape — SHALL continue to be named
as unsupported visual content rather than marked as a picture: there is no picture in the file to
return, and reporting one would claim bytes exist that do not.

#### Scenario: SlidePictureIsMarked
- **GIVEN** a slide holding a title and a picture
- **WHEN** the deck is extracted
- **THEN** the slide's markdown holds the title and a marker for the picture naming its format and dimensions

#### Scenario: SlideWhoseOnlyContentIsAPicture
- **GIVEN** a slide holding nothing but a picture
- **WHEN** the deck is extracted
- **THEN** the slide is reported as holding that picture, not as holding nothing readable

#### Scenario: SlidePictureBytesOnRequest
- **GIVEN** a deck holding pictures on two slides
- **WHEN** the extraction is asked for its pictures
- **THEN** both are returned as image content, each matching the identifier on its marker

#### Scenario: NoSlidePictureBytesByDefault
- **WHEN** a deck holding pictures is extracted without asking for them
- **THEN** the result holds the markers and no image content

#### Scenario: AChartIsNotAPicture
- **GIVEN** a slide holding a native chart and no picture
- **WHEN** the deck is extracted, asking for its pictures
- **THEN** the chart is named as unsupported visual content, no picture marker is written for it, and no image content is returned for it
