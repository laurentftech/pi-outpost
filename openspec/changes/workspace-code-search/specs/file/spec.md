# Spec Delta

## ADDED Requirements

### Requirement: SearchFileContents
The Files area SHALL provide a content-search control. A non-empty query SHALL find case-insensitive literal text in searchable text files and in PDF pages with extractable text below the current browser root. Results SHALL identify the file and matching line or PDF page, with a text excerpt. Empty queries SHALL not start a search.

#### Scenario: SearchAcrossWorkspaceFiles
- **GIVEN** searchable text files below the browser root contain the query
- **WHEN** the user searches for that text from Files
- **THEN** matching paths and lines are shown with excerpts containing the matches

#### Scenario: SearchPdfPagesAcrossTheWholeDocument
- **GIVEN** a PDF below the browser root contains the query on a page that is not currently displayed
- **WHEN** the user searches for that text from Files
- **THEN** the PDF path, matching page number, and an excerpt containing the match are shown

#### Scenario: EmptyContentSearch
- **WHEN** the search query is empty or whitespace
- **THEN** no content search is run and no matches are shown

#### Scenario: NoContentMatches
- **GIVEN** searchable files contain no match for a non-empty query
- **WHEN** the search completes
- **THEN** Files reports that there are no matches

### Requirement: ContentSearchRespectsWorkspaceBoundary
Content search SHALL stay within the current browser root, skip symbolic links and common dependency or generated directories, and ignore binary files other than PDFs whose text can be extracted. PDF text search SHALL use the document's text layer and SHALL NOT execute embedded scripts or fetch resources over the network. It SHALL NOT read or return content from paths outside the browser root.

#### Scenario: SearchSkipsIgnoredDirectoriesAndBinaryFiles
- **GIVEN** matching text exists in a common dependency or generated directory, a binary file, and a searchable text file
- **WHEN** the user searches for that text
- **THEN** only the match from the searchable text file is returned

#### Scenario: ScannedPdfPageHasNoTextMatches
- **GIVEN** a PDF page has no extractable text layer
- **WHEN** the user searches the project for text appearing only in that page's image
- **THEN** no match is returned for that page and the search reports no extraction error for it

#### Scenario: SearchDoesNotFollowLinksOutsideRoot
- **GIVEN** a symbolic link below the browser root points to a matching file outside it
- **WHEN** the user searches for text in that file
- **THEN** the external file's content is not read and no result is returned for it

### Requirement: ContentSearchResultsOpenAtMatch
Each content-search result SHALL let the user open its file in the file viewer at the matching line or PDF page, with the match brought into view.

#### Scenario: OpenMatchingLine
- **GIVEN** a content-search result identifies a path and line number
- **WHEN** the user selects that result
- **THEN** the file opens in the viewer with the matching line brought into view

#### Scenario: OpenMatchingPdfPage
- **GIVEN** a content-search result identifies a PDF path and page containing the match
- **WHEN** the user selects that result
- **THEN** the PDF opens on that page with the matching text highlighted

### Requirement: ContentSearchResultsFollowWorkspace
Search results SHALL remain associated with the workspace that produced them and SHALL NOT be displayed or acted on after the user switches to another workspace.

#### Scenario: WorkspaceChangesDuringSearch
- **GIVEN** a content search is pending in one workspace
- **WHEN** the user switches to another workspace before it completes
- **THEN** the pending result is not shown in the new workspace and cannot open a file there
