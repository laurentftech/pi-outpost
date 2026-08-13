## ADDED Requirements

### Requirement: WholeDocumentExtraction

The extraction tools SHALL offer a way to obtain a whole document in one call, so that receiving all
of it does not depend on a caller choosing to follow a truncation note.

When whole-document extraction is requested, the per-call page, block and output caps SHALL NOT
apply. A single absolute ceiling SHALL still apply, well above the per-call caps, together with the
existing time budget. A document whose extraction exceeds that ceiling SHALL be refused with a
message naming the ceiling and pointing at extraction to a file — never truncated silently, because
silent truncation is the failure this requirement exists to remove.

#### Scenario: WholeDocumentInOneCall
- **GIVEN** a document longer than the per-call cap
- **WHEN** whole-document extraction is requested
- **THEN** every page or block is returned in that one call, and no truncation note is produced

#### Scenario: PastTheAbsoluteCeiling
- **GIVEN** a document whose whole extraction exceeds the absolute ceiling
- **WHEN** whole-document extraction is requested
- **THEN** the call is refused, the message names the ceiling, and it points at extraction to a file

#### Scenario: TimeBudgetStillApplies
- **WHEN** whole-document extraction cannot complete within the time budget
- **THEN** it fails with that reason, as a capped extraction would

### Requirement: ExtractionToFile

The extraction tools SHALL accept a destination path and, when given one, write the **whole**
extraction there and return a summary instead of the content: the path written, how much of the
document it covers, and an opening excerpt. The content itself SHALL NOT be returned in that case —
the point of writing to a file is that the document does not travel through the conversation.

A destination SHALL be governed by the same permission as any other write from this system: refused
when writing is disabled, and refused when the resolved path — symlinks included — falls outside the
writable zone. The extraction tools remain read tools: refusing a destination SHALL NOT prevent the
same call from returning content the usual way.

An existing path SHALL be refused rather than overwritten, naming the path so a caller can choose
another.

The destination is a second path argument, and the confinement that covers the source path does not
cover it. It SHALL be resolved and checked on its own, with the same symlink-safe primitives.

#### Scenario: WriteWholeExtractionToFile
- **GIVEN** a destination inside the writable zone
- **WHEN** extraction is requested with it
- **THEN** the whole extraction is written there, and the call returns the path, the coverage and an excerpt rather than the content

#### Scenario: DestinationOutsideWritableZone
- **WHEN** the destination resolves outside the writable zone, by traversal or through a symlink
- **THEN** it is refused as denied and nothing is written

#### Scenario: WritesDisabled
- **GIVEN** a sandbox where writing is not allowed
- **WHEN** extraction is requested with a destination
- **THEN** it is refused as denied, and no file is created anywhere

#### Scenario: DestinationExists
- **GIVEN** a file already at the destination
- **WHEN** extraction is requested with it
- **THEN** it is refused as a conflict, the existing file is untouched, and the message names the path

#### Scenario: ReadingIsUnaffected
- **WHEN** a destination is refused
- **THEN** the tool's ordinary extraction still works for the same document
