# Proposal

## Why

Users can find files by name today, but cannot search for text across a project from the Files interface. A project-wide search makes code and configuration easier to navigate without requiring users to invoke a shell tool.

## What Changes

- Add a magnifying-glass entry point in the Files area for searching file contents across the current workspace.
- Show matching files and line-level excerpts, including page-level excerpts from PDFs with extractable text, with a way to open a result in the file viewer at the match.
- Keep search bounded to the workspace's existing file-browser root and skip irrelevant or generated directories.
- Consider OpenLore as an optional source of indexed or semantic results when available; the basic text search must work without it. Its role and availability checks remain design questions.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `file`: Add user-facing search across file contents within the constrained workspace.

## Impact

- Files sidebar and file-search interaction in the UI.
- Server-side workspace search and the typed client/server protocol.
- Existing file-search behavior for filename lookup remains separate.
- OpenLore integration is exploratory and must not be required for basic search.
