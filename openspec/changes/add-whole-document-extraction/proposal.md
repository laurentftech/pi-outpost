## Why

`pdf_extract` and `docx_extract` cap what one call returns and end with the range to ask for next.
The cap is right — a 42-page PDF is 129 565 characters, about 35 000 tokens in a single tool result
— but the continuation is a *suggestion*, and models treat it as one. Observed, on this repository's
own example file: asked to extract a whole PDF to markdown, the agent made three calls, then wrote a
file containing a **summary** and labelled it "transcription partielle" itself. Nothing failed; the
document simply never arrived.

A tool whose correct use depends on the model choosing to loop will sometimes be used incorrectly.
Two ways out, and they serve different needs: say "all of it" explicitly, or take the content out of
the conversation entirely.

## What Changes

- **`full: true`** on both extraction tools: one call returns the whole document, the tool doing the
  loop the model was expected to do. The per-call caps lift; a much higher hard ceiling and the time
  budget stay, and a document past that ceiling is refused with a pointer to the other option rather
  than truncated silently.
- **`output_path`**: the extraction is written to a workspace file and the call returns a summary —
  what was written, how many pages or blocks, and the opening lines. The whole document lands on
  disk in one call at **no context cost**, and the agent then reads or greps it like any other file.
- **Writing is governed by the writable zone**, not by the read zone the tools live in. With writes
  disabled, or a path outside `sandbox.writableRoot`, `output_path` is refused — the extraction
  itself still works, it just returns its content the usual way.
- **An existing file is never overwritten.** A refusal names the path; the agent picks another.

Not in this change: extracting several documents in one call, a default output path when none is
given, and any format other than the markdown these tools already produce.

## Capabilities

### Modified Capabilities
- `pdf-documents`: the extraction tool gains whole-document extraction and extraction to a file,
  with the size ceiling and the writable-zone rule that come with them.
- `docx-documents`: the same two, stated once for both tools where the requirement is shared.
*(`file` is deliberately not modified. `CreateSandboxedTools` already carries an unarchived delta
from `add-docx-extraction`, and a second delta on the same requirement collides at archive time.
What the spec needs to say — that a destination obeys the writable zone — is said in
`ExtractionToFile`, where it belongs; the readers receiving that zone is implementation.)*

## Impact

**Server**: `server/src/pdf.ts` and `server/src/docx.ts` (lift the caps under `full`),
`server/src/pdfTool.ts` and `server/src/docxTool.ts` (the two parameters, the write, the refusals),
`server/src/sandbox.ts` and `server/src/index.ts` (pass the writable zone through both toolset
paths).

**Security — the part that needs review.** These tools are wrapped by `scopeToRoot`, which confines
**the `path` argument and nothing else**. A second path parameter is therefore *not* covered by the
wrapper that makes the first one safe: `output_path` must be checked by the tool itself, against the
writable zone, using the same primitives (`realResolve`, `isWithin`). Getting this wrong would hand
a read-only sandbox a way to write — the precise escalation the sandbox exists to prevent.
