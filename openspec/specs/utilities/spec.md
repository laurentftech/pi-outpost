# Utilities Specification

> Authored from openlore `prepare_spec_generation` evidence on 2026-08-11
> Anchors verified against the analysis graph; no overlap with existing specs

## Purpose

Pure, dependency-free helpers shared by the UI: line diffing for tool cards, LaTeX
delimiter normalization for model output, tool-result formatting, and
workspace-relative reference resolution. Every function here is deterministic and
side-effect free — they are the leaves the rendering components build on.

## Requirements

> `ui/src/util/diff.ts`, `ui/src/util/markdownMath.ts`, `ui/src/util/toolOutput.ts`, `ui/src/util/workspacePath.ts`

### Requirement: DiffTwoTextsByLine

- **Implementation**: `diffLines::ui/src/util/diff.ts`

The system SHALL compute a line-level diff between two texts for the before/after
views of tool cards. It SHALL trim the common prefix and suffix first, then run an
LCS over the remainder. Beyond a size cap it SHALL degrade to "all removed / all
added" rather than pay quadratic cost on a large file.

#### Scenario: EditInTheMiddleOfAFile
- **GIVEN** two texts sharing a long identical prefix and suffix
- **WHEN** the diff is computed
- **THEN** only the differing region is compared
- **AND** unchanged lines are reported as unchanged

#### Scenario: FileTooLargeToCompare
- **GIVEN** inputs beyond the size cap
- **WHEN** the diff is computed
- **THEN** the result degrades to every old line removed and every new line added
- **AND** the call still returns instead of running to quadratic cost

### Requirement: PresentDiffsSideBySide

- **Implementation**: `toSideBySide::ui/src/util/diff.ts`, `rowsWithContext::ui/src/util/diff.ts`, `withContext::ui/src/util/diff.ts`

The system SHALL pair diff lines into side-by-side rows, and SHALL collapse long
runs of unchanged content into a separator while keeping a configurable number of
context rows around each change. A collapsed run is represented by `null`, which
the renderer draws as a "⋯" separator.

#### Scenario: LongUnchangedRunBetweenTwoEdits
- **GIVEN** a diff with two changes separated by many unchanged lines
- **WHEN** rows are built with a context of 2
- **THEN** two context rows are kept on each side of both changes
- **AND** the run between them is replaced by a single separator

### Requirement: NormalizeMathDelimiters

- **Implementation**: `normalizeMathDelimiters::ui/src/util/markdownMath.ts`

The system SHALL rewrite LaTeX `\(…\)` and `\[…\]` delimiters to the `$…$` and
`$$…$$` forms the markdown renderer recognizes, because models routinely emit the
former. It SHALL NOT rewrite inside code spans or fenced code blocks, so LaTeX
shown as an example stays verbatim. The implementation SHALL avoid regular
expressions, since the input is model output that may contain adversarial
delimiter repetition.

#### Scenario: ModelEmitsParenDelimiters
- **GIVEN** a reply containing `\(x^2\)` outside any code block
- **WHEN** the text is normalized
- **THEN** the delimiters become `$x^2$`

#### Scenario: LatexShownInsideACodeFence
- **GIVEN** a fenced code block containing `\[x\]`
- **WHEN** the text is normalized
- **THEN** the block is left byte-identical

### Requirement: FormatToolOutput

- **Implementation**: `getFormattedToolOutput::ui/src/util/toolOutput.ts`

The system SHALL format a tool result for display, preferring an authoritative
`__pi_render` envelope when present. It SHALL recover from truncated JSON by
stripping the truncation suffix and, failing that, by brace-counting. It SHALL
return `undefined` only for content that is not JSON or is unrecoverable — never
a partially parsed object presented as complete.

#### Scenario: OutputCarriesARenderEnvelope
- **GIVEN** a result containing a `__pi_render` envelope
- **WHEN** it is formatted
- **THEN** the envelope is authoritative and is used as-is

#### Scenario: OutputWasTruncatedMidObject
- **GIVEN** a JSON result cut off partway through
- **WHEN** it is formatted
- **THEN** recovery is attempted before giving up
- **AND** unrecoverable content yields `undefined` rather than a partial render

### Requirement: ResolveWorkspaceReferences

- **Implementation**: `isExternalRef::ui/src/util/workspacePath.ts`, `resolveRelativeHref::ui/src/util/workspacePath.ts`, `isImageFile::ui/src/util/workspacePath.ts`

The system SHALL resolve markdown-relative references against the directory of the
file being viewed, producing a browser-root-relative path. An `"/x"` href SHALL be
treated as root-relative, and `..` SHALL clamp at the workspace root. An empty
current path SHALL resolve against the workspace root, which is the case for chat
messages. External references SHALL be identified and left untouched.

#### Scenario: RelativeLinkInsideAViewedFile
- **GIVEN** a file at `docs/guide.md` linking to `../README.md`
- **WHEN** the href is resolved
- **THEN** the result is the workspace-root-relative path of `README.md`

#### Scenario: TraversalBeyondTheRoot
- **GIVEN** an href with more `..` segments than the current depth
- **WHEN** it is resolved
- **THEN** the path clamps at the workspace root

#### Scenario: AbsoluteExternalUrl
- **GIVEN** an href pointing at another origin
- **WHEN** it is classified
- **THEN** it is reported external and is not rewritten

### Requirement: AddressRawFileBytes

- **Implementation**: `rawFileUrl::ui/src/util/workspacePath.ts`

The system SHALL build the URL of the server's raw-bytes endpoint for a workspace
file. Because `<img>` cannot send headers, the auth token SHALL ride in the query
string — the same trade-off the WebSocket URL makes. `serverUrl` SHALL be the
embed widget's backend origin, and empty when the UI is served same-origin.

#### Scenario: ImageInsideAnEmbeddedWidget
- **GIVEN** a widget configured with a backend origin and a token
- **WHEN** a raw file URL is built
- **THEN** the URL targets that origin
- **AND** the token is carried in the query string

## Technical Notes

- **Dependencies**: none beyond the standard library — these helpers are pure and
  independently testable, and each has a colocated `*.test.ts`.
- **Boundary**: rendering decisions live in the components; these functions only
  transform data.
