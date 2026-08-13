## ADDED Requirements

### Requirement: WordWholeDocumentExtraction

Word extraction SHALL offer whole-document extraction and extraction to a file on the same terms as
PDF extraction — the same absolute ceiling, the same time budget, the same writable-zone rule, and
the same refusal to overwrite an existing path.

Stating it here rather than sharing one requirement keeps each capability's spec readable on its
own; the behaviour is deliberately identical, and a difference between the two tools would be a
defect rather than a feature.

#### Scenario: WholeWordDocumentInOneCall
- **GIVEN** a Word document longer than the per-call block cap
- **WHEN** whole-document extraction is requested
- **THEN** every block is returned in that one call, with no truncation note

#### Scenario: WriteWholeWordExtractionToFile
- **GIVEN** a destination inside the writable zone
- **WHEN** Word extraction is requested with it
- **THEN** the whole extraction is written there, and the call returns the path, the coverage and an excerpt rather than the content

#### Scenario: WordDestinationRefused
- **WHEN** the destination is outside the writable zone, writing is disabled, or a file is already there
- **THEN** it is refused for that reason and nothing is written
