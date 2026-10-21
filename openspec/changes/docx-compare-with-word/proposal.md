# Proposal

## Why

An impact analysis of a revised specification starts from what changed. When the author used
tracked changes, `docx_extract` with `review: true` (change `docx-revisions-and-comments`) shows it.
When they did not, there are two versions of the file and no trace of the edits between them.

Asking the model to compare two long extractions is not reliable: weak models (the user's real
targets) miss differences and invent others. Microsoft Word already compares documents well:
- it aligns paragraphs and tables;
- it detects moves;
- it keeps comments.

Its result is a document with tracked changes, which the review reading already knows how to read.

## What Changes

- New tool `docx_compare(original, revised, output_path?)`, offered on Windows.
  - It drives desktop Microsoft Word through COM automation: `Application.CompareDocuments`,
    with formatting ignored and comments kept.
  - It reads Word's result with the review reading, so the agent gets the same markers and
    closing list as for a document with tracked changes.
- The answer opens by saying that it is a comparison computed by Word. The authors and dates on the
  revisions are the comparison's, not those of whoever made the edits.
- With `output_path`, the compared document is also written to the workspace, so the user can open
  it in Word and see the comparison there.
- Off Windows, or without Word, the tool is either not offered or refuses with that reason, and
  names the manual path: Word's Review → Compare, then `docx_extract` with `review: true`.
- No source file is modified, and Word never writes next to the user's files.

## Capabilities

### New Capabilities

- `docx-comparison`: comparing two versions of a Word document with Microsoft Word, and returning
  the differences in the review reading's format.

### Modified Capabilities

None. The review reading it relies on is specified by `docx-revisions-and-comments` (in
`docx-documents`), which this change uses unchanged.

## Impact

- New: `server/src/docxCompare.ts`, with the PowerShell/COM script, the run, and the reading of the
  result.
- `server/src/wordTools.ts` or a sibling: the tool definition, with path checks on `original`,
  `revised` and `output_path`.
- `server/src/documentTools.ts`: publish `docx_compare` with the other Word tools when a `.docx`
  is in play, on Windows only.
- Reuses from `server/src/presentationRender.ts`:
  - how Word is found and run (PowerShell path, `environment.run`, timeouts);
  - the private temporary directory;
  - `office.renderTimeoutMs`.
- Docs: `README.md` (Office documents), `docs/how-to.md` (reading a document under review).
- Depends on `docx-revisions-and-comments` being merged first.
- Out of scope:
  - a LibreOffice fallback (recommended against for now);
  - comparing more than two versions;
  - comparing formatting.
