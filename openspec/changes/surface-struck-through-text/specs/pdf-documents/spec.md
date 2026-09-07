## ADDED Requirements

### Requirement: StruckThroughTextIsMarked

A PDF has no notion of struck-through text: a producer draws the strike as a thin filled shape over
the glyphs, and the text layer the extractor reads records only the glyphs. Text a document has
crossed out therefore reaches the caller reading as live content, which is the opposite of what the
document says.

The system SHALL read the page's drawing operations alongside its text, and SHALL return text
covered by a strike as a GitHub-flavoured strikethrough span.

Detection SHALL distinguish a strike from the other things drawn with the same primitive. An
underline and a strike differ by where they sit relative to the text's baseline, and the system
SHALL use that: a shape below the baseline is an underline and SHALL NOT mark the text above it. A
shape that spans text it does not overlap horizontally, that is too tall to be a rule, or that is
drawn as an outline rather than filled — a table border, a page rule, a box around a callout — SHALL
NOT mark anything.

Like table reconstruction, this is derived from where ink landed and the output SHALL be honest
about it. Marking SHALL only ever add markers around text the system already returned: no text is
dropped, altered or reordered by strike detection, so a missed or spurious strike costs a marker,
never content. Struck text SHALL be marked in every mode that returns that text, including inside a
reconstructed table.

Reading the drawing operations SHALL stay inside the extraction's existing time budget and output
caps, and a page whose drawing operations cannot be read SHALL still return its text, unmarked,
rather than failing the extraction.

#### Scenario: WordStrikethroughIsMarked
- **GIVEN** a PDF produced by a word processor in which a sentence is struck through
- **WHEN** the page is extracted
- **THEN** that sentence is returned wrapped in `~~`, and the rest of the page is unmarked

#### Scenario: UnderlineIsNotAStrike
- **GIVEN** a page whose only decorated text is an underlined hyperlink
- **WHEN** the page is extracted
- **THEN** no text is returned as struck through

#### Scenario: PageRulesAndBordersAreNotStrikes
- **GIVEN** a page carrying horizontal rules, and a table drawn with ruling lines
- **WHEN** the page is extracted
- **THEN** no text is returned as struck through

#### Scenario: PartiallyStruckLine
- **GIVEN** a line of text of which only some words are struck through
- **WHEN** the page is extracted
- **THEN** the markers cover the struck words and not the whole line

#### Scenario: StruckTextInsideAReconstructedTable
- **GIVEN** a table cell whose text is struck through
- **WHEN** the page is extracted with mode `tables` or `both`
- **THEN** the cell shows the struck span, and every row still has the column count the reconstruction found

#### Scenario: NothingIsLostToDetection
- **GIVEN** a page whose strikes are detected wrongly or not at all
- **WHEN** the page is extracted
- **THEN** the page's text is returned in full, exactly as it would be without strike detection

#### Scenario: UnreadableDrawingOperations
- **GIVEN** a page whose drawing operations cannot be read
- **WHEN** the page is extracted
- **THEN** the page's text is returned unmarked rather than the extraction failing

#### Scenario: DetectionStaysWithinTheBudget
- **GIVEN** a document large enough that reading its drawing operations would exceed the time budget
- **WHEN** it is extracted
- **THEN** the extraction reports the budget the same way it does today, rather than running past it
