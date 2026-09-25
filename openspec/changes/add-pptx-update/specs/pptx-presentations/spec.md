## ADDED Requirements

### Requirement: UpdateAnExistingDeck

The system SHALL provide a `pptx_update` tool that changes an existing `.pptx` with an ordered list
of edits, each naming a slide by number or by title: replace a slide's content, insert a new slide
after one, delete a slide, or move a slide. Replaced content SHALL be written into the slide's own
placeholders with the same rules as `pptx_create`; an inserted slide SHALL use one of the deck's own
layouts. A title that matches no slide or several SHALL be refused with the deck's slides.

Slides the edits do not touch SHALL be left identical, with every part they use. Parts no longer
reachable after a deletion or a replacement SHALL be removed.

The result SHALL be written to a new file in the writable zone unless the call asks to overwrite the
original, and SHALL report which slides changed, by their numbers in the result.

#### Scenario: ASlideIsReplacedAndTheOthersAreUntouched
- **GIVEN** a deck of five slides
- **WHEN** slide 3's content is replaced
- **THEN** slide 3 carries the new content on its original layout, and slides 1, 2, 4 and 5 and every part they use are byte-identical

#### Scenario: AnInsertedSlideUsesTheDecksLayouts
- **WHEN** a slide is inserted after slide 2 on the layout "Title and Content"
- **THEN** it is slide 3 of the result, on the deck's own layout of that name, and the report names it

#### Scenario: DeletingASlideSweepsWhatOnlyItUsed
- **GIVEN** a slide with a picture no other slide uses
- **WHEN** it is deleted
- **THEN** the slide and the picture are gone from the package, and the slide list and relationships stay consistent

#### Scenario: AnAmbiguousSlideTitleIsRefused
- **WHEN** the title names two slides
- **THEN** the call fails, lists the slides, and nothing is written

#### Scenario: TheOriginalIsKeptUnlessOverwriteIsAsked
- **WHEN** `pptx_update` is called without `overwrite`
- **THEN** the original file is unchanged and the result is written to the path given
