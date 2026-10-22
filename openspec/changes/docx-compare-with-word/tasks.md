# Tasks

Prerequisite: `docx-revisions-and-comments` merged. To run on the Boot Camp Windows 11 with Word desktop.

## 1. Probe Word on the target machine

- [x] 1.1 Write `scripts/probes/word-compare.ps1`, which runs the design's script on two versions built from `server/test/fixtures/docx-review-office-web.docx`: one with its changes accepted, one with them rejected. Record the `CompareDocuments` signature that works on the installed Word (moves as a parameter or as `$app.Options`), and verify that the saved `.docx` is read by `docx_extract` with `review: true` with moves marked `[mN]`.
- [x] 1.2 With a document of the user's open in Word, run the probe and verify that the document is still open afterwards and that no `WINWORD.EXE` is left behind when none was running before.

## 2. Comparison module

- [x] 2.1 Add `server/src/docxCompare.ts`: `COMPARE_SCRIPT` as confirmed by 1.1, and `compareWithWord`, which passes paths and the fixed `Word comparison` author through environment variables, works on copies in a private temp dir, and is bounded by `office.renderTimeoutMs`. Export what it needs from `presentationRender.ts` instead of copying it. Verify with unit tests on a fake environment: paths appear only in the environment, the author string reaches the script, a timeout is reported naming it, and a failed run names Word as unavailable together with the manual path.
- [x] 2.2 Build the answer from Word's result: the comparison line, then the review reading, the written path when given, and "Word found no difference" when the reading has no tracked change. Verify with tests that feed a tracked-changes fixture as Word's output (`DifferencesAreMarkedInTheReviewFormat`, `AuthorshipIsNotAttributed`, `IdenticalVersions`).

## 3. Tool and publication

- [x] 3.1 Define `docx_compare` (`original`, `revised`, `output_path`). Check both inputs against `allowedRoots` after `realResolve` and against the Word size ceiling, and run `output_path` through `assertWritableDestination`, all before Word starts. Verify with `InputOutsideTheSandbox`, `OversizeInputRefused` and `DestinationRefused` tests, and with `SourcesUnchanged` (bytes and directory listing unchanged).
- [x] 3.2 Publish `docx_compare` with the `.docx` tools on Windows only, in `server/src/documentTools.ts`. Verify with a `NotOfferedOffWindows` test on the published tool list for a non-Windows platform, and one that it is listed for `win32`.
- [x] 3.3 Document the tool in `README.md` (Office documents) and `docs/how-to.md` (reading a document under review), including the manual path for macOS, Linux and WSL. Verify that the documented call matches the schema.

## 4. Integration

- [x] 4.1 On the Boot Camp machine, run the real tool on two fixture versions (`ComparedDocumentWritten`, `FormattingDifferencesAreIgnored`, `ComparisonTimesOut` with a 1 s timeout, `UserDocumentsStayOpen`, `WordMissing` by making Word fail to start), and record what happened.
- [x] 4.2 In the running app on that machine, give the agent two versions of a cahier des charges and ask for an impact analysis. Read the transcript and verify that it calls `docx_compare`, does not attribute the changes to a person, and cites sections from the list.
- [x] 4.3 Write `scenario-coverage.md` mapping every scenario to a unit test or to the recorded Windows run, and verify that `node scripts/check-scenario-coverage.mjs --change docx-compare-with-word` passes and that `openspec validate docx-compare-with-word --strict` is clean.

## Workflow follow-up

- Archive from `main` after merge.
- Revisit a LibreOffice fallback only if macOS or WSL users ask for the comparison.
