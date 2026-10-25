# docx-comparison Specification

## Purpose
Lets the agent learn what changed between two versions of a Word document that carry no tracked
changes, by having Microsoft Word compare them and reading Word's result.

## Requirements

### Requirement: CompareTwoVersionsWithWord

The system SHALL expose a tool that takes an original and a revised `.docx` and has Microsoft Word
compare them, ignoring formatting and keeping comments. It SHALL return the compared document in
the review reading: insertions, deletions and moves marked where they sit, and the closing list
with sections.

#### Scenario: DifferencesAreMarkedInTheReviewFormat
- **GIVEN** two versions of a document in which one sentence was reworded and one paragraph removed
- **WHEN** the tool compares them
- **THEN** the answer marks the rewording as a deletion and an insertion, and the removed paragraph as a deletion, each with a reference listed with its section

#### Scenario: FormattingDifferencesAreIgnored
- **GIVEN** two versions that differ only by a word made bold
- **WHEN** the tool compares them
- **THEN** the answer reports no difference

#### Scenario: IdenticalVersions
- **GIVEN** two versions with the same text
- **WHEN** the tool compares them
- **THEN** the answer says Word found no difference, rather than returning the text as though it were a list of changes

### Requirement: ComparisonIsAnnouncedAsSuch

The answer SHALL open by stating that the differences were computed by Word between the two named
files, and that the author and date on each revision are the comparison's, not those of whoever
edited the document. The revisions SHALL carry an author name that says it is a comparison.

#### Scenario: AuthorshipIsNotAttributed
- **WHEN** the tool returns a comparison
- **THEN** it opens by naming both files and saying the authors and dates are the comparison's, and every revision in the list carries the comparison's author name

### Requirement: SourcesAreNeverModified

Word SHALL work on private copies of both files. The original and the revised file SHALL be
byte-identical after the call, and Word SHALL NOT write anything next to them. Word SHALL NOT be
told to quit while another document is open in it, so that the user's own documents are never
closed.

#### Scenario: SourcesUnchanged
- **WHEN** the tool compares two files
- **THEN** both files are byte-identical afterwards and their directory holds no new file

#### Scenario: UserDocumentsStayOpen
- **GIVEN** Word already has a document of the user's open
- **WHEN** the tool compares two files
- **THEN** that document is still open in Word afterwards

### Requirement: ComparedDocumentCanBeKept

With an output path, the tool SHALL also write the compared document there, so that the user can
open it in Word. The destination SHALL obey the writable-zone rule and SHALL NOT overwrite an
existing file.

#### Scenario: ComparedDocumentWritten
- **GIVEN** a destination inside the writable zone
- **WHEN** the tool compares two files with it
- **THEN** a `.docx` with Word's tracked changes is written there, and the answer names it

#### Scenario: DestinationRefused
- **WHEN** the destination is outside the writable zone, writing is disabled, or a file is already there
- **THEN** the call is refused for that reason before Word is started, and nothing is written

### Requirement: ComparisonIsConfinedAndBounded

Both inputs SHALL resolve inside the readable zone, symlinks included, and SHALL be refused above
the Word size ceiling. Nothing the model passes SHALL reach a command line: paths SHALL travel to
the automation script out of band. A comparison that does not finish within the configured office
timeout SHALL be abandoned with that reason.

#### Scenario: InputOutsideTheSandbox
- **WHEN** either path resolves outside the sandbox root
- **THEN** the call is refused with an access-denied error and Word is not started

#### Scenario: OversizeInputRefused
- **WHEN** either file is above the Word size ceiling
- **THEN** the call is refused with a message naming the limit, and Word is not started

#### Scenario: ComparisonTimesOut
- **WHEN** Word does not finish within the office timeout
- **THEN** the call fails naming the timeout, and the session stays responsive

### Requirement: UnavailableWithoutWord

The tool SHALL be offered only on Windows. Where Word cannot be started, the call SHALL fail with
that reason and SHALL name the manual path, Word's Review → Compare followed by the review reading
of its result, rather than fail silently or return an empty comparison.

#### Scenario: NotOfferedOffWindows
- **GIVEN** a server running on macOS or Linux
- **WHEN** a Word document is named in the conversation
- **THEN** the Word tools are published without the comparison tool

#### Scenario: WordMissing
- **GIVEN** a Windows machine where Word cannot be started
- **WHEN** the tool is called
- **THEN** it fails saying Word is unavailable, and names Review → Compare and `docx_extract` with `review: true` as the way to do it by hand
