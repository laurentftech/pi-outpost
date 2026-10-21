# Design

## Context

- `server/src/presentationRender.ts` already drives Word through COM for `docx_render`:
  - `WORD_SCRIPT` is fixed PowerShell, with paths passed in `PI_OUTPOST_RENDER_*` environment
    variables;
  - it runs on read-only copies in a private temp directory;
  - it closes with `Close(0)`, and quits only when `Documents.Count -eq 0`, as `Quit([ref]0)`
    because `Quit`'s arguments are ByRef.
  - Powershell is resolved from `SystemRoot`, the run goes through `environment.run` with
    `office.renderTimeoutMs`, and failures come back as text.
- The review reading (`extractDocx(…, { review: true })`, change `docx-revisions-and-comments`)
  turns any `.docx` with tracked changes into the markers and the closing list.
- Tools are published per document kind by `server/src/documentTools.ts`; `WORD_TOOLS` travels
  with `.docx`.
- The developer's Mac has no Word, and CI's Windows runners have no Word either. Real runs happen on
  the user's Boot Camp Windows 11, a non-admin machine where Word desktop is installed.

## Goals / Non-Goals

**Goals:**
- One fixed script, one Word call, one reading. No comparison logic of ours.
- Same guarantees as `docx_render`: no command line from the model, private copies, the user's Word
  session left alone.

**Non-Goals:**
- No LibreOffice or ONLYOFFICE fallback. `.uno:CompareDocuments` needs a UNO script and compares
  worse. To revisit if Mac or WSL users ask.
- No formatting comparison, no three-way comparison, no merge (`MergeDocuments`).

## Decisions

### The script

```powershell
$ErrorActionPreference = 'Stop'
$app = $null; $original = $null; $revised = $null; $result = $null
try {
  $app = New-Object -ComObject Word.Application
  $missing = [Type]::Missing
  # Read-only copies; ConfirmConversions false; AddToRecentFiles false
  $original = $app.Documents.Open($env:PI_OUTPOST_COMPARE_ORIGINAL, $false, $true, $false)
  $revised  = $app.Documents.Open($env:PI_OUTPOST_COMPARE_REVISED,  $false, $true, $false)
  # Destination 2 = wdCompareDestinationNew; Granularity 1 = wdGranularityWordLevel
  $result = $app.CompareDocuments($original, $revised, 2, 1,
    $false,  # CompareFormatting
    $true,   # CompareCaseChanges
    $true,   # CompareWhitespace
    $true,   # CompareTables
    $true,   # CompareHeaders
    $true,   # CompareFootnotes
    $true,   # CompareTextboxes
    $true,   # CompareFields
    $true,   # CompareComments
    $true,   # CompareMoves (Word 2010+ signature; verify on the target Word)
    $env:PI_OUTPOST_COMPARE_AUTHOR,
    $true)   # IgnoreAllComparisonWarnings
  # 16 = wdFormatDocumentDefault
  $result.SaveAs2($env:PI_OUTPOST_COMPARE_OUTPUT, 16)
} finally {
  foreach ($doc in @($result, $revised, $original)) { if ($doc -ne $null) { try { $doc.Close(0) } catch { } } }
  if ($app -ne $null -and $app.Documents.Count -eq 0) { $app.Quit([ref]0) }
}
```

The exact positional signature of `CompareDocuments`, and whether the moves argument exists on the
installed Word, are to be confirmed on the target machine (task 1.1). If moves are only an
application option, the script sets and restores `$app.Options` around the call instead.

### The reading

The compared `.docx` is read with `extractDocx(bytes, { review: true, full: true })` when it fits,
otherwise with the usual cap and truncation note. The answer is assembled as:

1. A first line, `> Compared by Microsoft Word: "<original>" → "<revised>". The authors and dates
   below are the comparison's, not those of whoever edited the document.`
2. The review reading as it comes: its legend, the content, and the closing list.
3. When given, the path the compared document was written to.

When the review reading reports no tracked change, the answer says Word found no difference
instead of returning the document's text.

The revision author passed to Word is the fixed string `Word comparison`. Every list entry then
reads `insertion — Word comparison, 2026-10-22 — …`, which states the truth in the place an agent
would otherwise read a person's name.

### Placement and publication

- `server/src/docxCompare.ts` holds `COMPARE_SCRIPT`, a `compareWithWord(original, revised, settings,
  environment, signal)` that returns the compared bytes, and the tool definition. It reuses
  `RenderEnvironment`, the PowerShell resolution and the temp-dir helper from
  `presentationRender.ts`, exported where needed rather than copied.
- Path checks follow `wordTools.ts`: `original` and `revised` must be within `allowedRoots` after
  `realResolve`, and `output_path` goes through `assertWritableDestination` before Word starts.
- `documentTools.ts` adds `docx_compare` to the `.docx` tool list only when
  `process.platform === "win32"`. On other platforms nothing is published, so no description is
  paid for. On Windows without Word, the call fails with the manual-path message.

### Tests

- Off Windows, with a fake environment, as the render tests do:
  - the script receives paths only through the environment;
  - refusals happen before any run;
  - a timeout is reported;
  - the fixed author string reaches the script;
  - a compared document (a tracked-changes fixture standing in for Word's output) is turned into
    the announced answer;
  - identical versions say so;
  - the tool is not published off Windows.
- On the Boot Camp machine, a probe script in `scripts/probes/` drives the real Word on two
  fixture versions. Its observations are written into `scenario-coverage.md`, notably moves, the
  open-document case and the timeout.

## Risks / Trade-offs

- [COM signature differs across Word versions] → task 1.1 confirms it on the target Word before the
  code is written; the script names each argument in a comment.
- [Word shows a dialog, such as protected view or a conversion prompt, and hangs until the timeout]
  → open with `ConfirmConversions $false` and read-only; `IgnoreAllComparisonWarnings`; the timeout
  bounds the worst case and the failure names it.
- [A Word left running after a crash] → `Quit` runs only when no document is open; a process left
  behind is the same risk `docx_render` already takes, and has the same mitigation.
- [Users on Mac or WSL cannot use it] → the manual path is named in the tool's absence (docs) and in
  its failure (Windows without Word).

## Migration Plan

None: a new tool, published only on Windows.

## Open Questions

None left. Answered by the probe (`scripts/probes/word-compare.ps1`, task 1.1–1.2) on Word 16.0
build 20326:

- `CompareMoves` is a parameter: the 16-argument call above works as written, and Word's result
  marks the moved table cells as moves (`[m1]`, `[m2]` in the review reading).
- `CompareDocuments` works on documents opened read-only and invisible (`Visible` false in
  `Documents.Open`), as `docx_render` opens them. `Revisions.AcceptAll()` does not (no active
  document window) — which only matters to the probe, which builds its two versions read-write.
- Every revision carries `Word comparison`; comments keep their own author.
- `New-Object -ComObject Word.Application` starts a Word of its own even while the user has one
  open: it sees none of the user's documents, and the `Documents.Count -eq 0` guard quits it.
  The user's document stayed open and no `WINWORD.EXE` was left behind.
- A comparison of the fixture's two versions takes about 6 s.
