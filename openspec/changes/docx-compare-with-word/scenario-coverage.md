# Scenario coverage

Scenarios enumerated with `rg '^#### Scenario:' openspec/changes/docx-compare-with-word`: 13.
OpenLore's `orient` located the surface (`presentationRender.ts`, `wordTools.ts`,
`documentTools.ts`, `docx.ts`); its index was stale on `docx.ts`, which was read directly.

Word is on no CI runner, so two kinds of evidence:

- **Unit tests** (`server/test/docxCompare.test.ts`) replace Word with an injected machine that
  hands back what the real Word 16.0 wrote: `fixtures/docx-compare-word-result.docx` (Word
  comparing the two versions of `docx-review-office-web.docx`) and
  `fixtures/docx-compare-word-identical.docx` (a version compared with a copy of itself).
- **The Windows run** on 2026-10-22, Word 16.0 build 20326, French locale:
  `scripts/probes/word-compare.ps1` (the script alone, and the user's open document),
  `scripts/probes/word-compare-tool.mts` (the real `docx_compare` tool, scenario by scenario), and
  `scripts/probes/docx-compare-agent.mts` (the agent in the running app, task 4.2).

## What the Windows run showed

`word-compare-tool.mts` against the real Word, output kept as printed:

| Scenario | Outcome |
|---|---|
| ComparedDocumentWritten | 5.7 s; 12 changes and 1 comment in the review reading, moves as `[m1]`/`[m2]`, every change `Word comparison, 2026-10-22`; `compared.docx` written (129 743 bytes) and named last. |
| SourcesUnchanged | listing of the sources' folder unchanged; `spec-v1.docx` byte-identical. |
| FormattingDifferencesAreIgnored | the original against a copy whose second paragraph's first word was made bold in Word: "Word found no difference between the two versions' text (formatting is not compared)." |
| ComparisonTimesOut | 1 s timeout: "Word did not finish the comparison within 1 s (office.renderTimeoutMs). To compare by hand, …". The server stayed responsive. **A `WINWORD.EXE` was left running**: killing PowerShell does not stop the Word it started (see below). |
| UserDocumentsStayOpen | a visible Word with the user's document open throughout; the comparison started its own Word (process count 3 → 3 after it quit), and the user's document was still open afterwards (`still-open=True`). The script-only probe gave the same: no `WINWORD.EXE` left behind when none ran before. |
| WordMissing | real PowerShell, real COM lookup of an unregistered class: "Microsoft Word is unavailable: La récupération de la fabrique de classes COM … 80040154 Classe non enregistrée (…REGDB_E_CLASSNOTREG). To compare by hand, open the revised document in Word, choose Review → Compare → Compare…, save the result, and read it with docx_extract and review: true." |

The first run of WordMissing returned PowerShell's error record cut at the console's width and
decoded in the wrong code page ("r�cup�ration"); the script now writes the exception's message
alone, in UTF-8, and the second run is the one above.

The agent (task 4.2), `openai-codex/gpt-6.1-sol`, sandboxed project holding
`cahier-des-charges-v1.docx` and `-v2.docx` (`scripts/probes/make-cahier-des-charges.mts`: no
tracked changes; size limit, delay and delivery date reworded, Factur-X and 2FA added, CSV export
removed). Asked in French for an impact analysis, it called `docx_compare` (78 s for the turn). Its
first call named `output_path: "analyse/comparaison-v1-v2.docx"`, a folder that did not exist;
that refusal came after Word had run, and now comes before. It then read both sources with
`docx_extract` as a cross-check, and answered with the six changes under their sections
(`Exigences fonctionnelles › Dépôt des factures`, `› Suivi des paiements`,
`Exigences non fonctionnelles › Sécurité`, `Délais`), adding "Les marques de révision ont été
produites par Word ; elles n'identifient pas les auteurs réels des changements." It named no
person. The page's DOM showed the `docx_compare` tool cards.

Left open: on a timeout, the Word started by the killed PowerShell stays running, invisible, with
the two copies open, until killed by hand. The design accepts this as the risk `docx_render`
already takes; the run shows it happens on every timeout, not only after a crash.

## Matrix

| Scenario | Status | Test file and name |
|---|---|---|
| DifferencesAreMarkedInTheReviewFormat | covered | `server/test/docxCompare.test.ts`: `DifferencesAreMarkedInTheReviewFormat: …` — on Word's real result: the inserted clause `{++and for Claude Desktop++}[r1]`, the removed paragraph `{--a PowerPoint deck from slides;--}[r2]`, the replaced cell `{--Laurent--}[r4]{++Arthur++}[r5]`, the moved row `[m1]` at both ends, and list lines `[r1]`, `[r2]`, `[m1]` with their sections, matched exactly. Real run: `scripts/probes/word-compare-tool.mts`, ComparedDocumentWritten above. |
| FormattingDifferencesAreIgnored | covered | Windows run, `scripts/probes/word-compare-tool.mts` scenario `FormattingDifferencesAreIgnored`: a bold-only difference answered "Word found no difference". The script passes `CompareFormatting` `$false`, asserted verbatim in `server/test/docxCompare.test.ts`: `paths reach the script only through the environment, …` (the whole argv is compared to `COMPARE_SCRIPT`). |
| IdenticalVersions | covered | `server/test/docxCompare.test.ts`: `IdenticalVersions: …` — on Word's real comparison of a version with itself (0 changes, 1 comment): exactly two paragraphs, the opening and "Word found no difference…", and none of the document's text. |
| AuthorshipIsNotAttributed | covered | `server/test/docxCompare.test.ts`: `AuthorshipIsNotAttributed: …` — the opening line compared verbatim, all 12 `[rN]`/`[mN]` list lines carry `Word comparison`; `paths reach the script …` asserts the author `Word comparison` reaches the script's environment and the script reads it. Agent run: no person named. |
| SourcesUnchanged | covered | `server/test/docxCompare.test.ts`: `SourcesUnchanged: …` (listing and both files' bytes unchanged) and `Word works on private copies, removed afterwards` (Word is handed copies under the temp dir, its output beside them, the directory gone afterwards). Real run: SourcesUnchanged above. |
| UserDocumentsStayOpen | covered | Windows run: `scripts/probes/word-compare-tool.mts` scenario `UserDocumentsStayOpen` (`still-open=True`) and `scripts/probes/word-compare.ps1 -UserDocument` ("user document still open: True"). The guard is asserted verbatim in `server/test/docxCompare.test.ts`: `paths reach the script …` (`Quit` only when `Documents.Count -eq 0`). |
| ComparedDocumentWritten | covered | `server/test/docxCompare.test.ts`: `ComparedDocumentWritten: …` — the file at `output_path` is byte-identical to Word's result and the answer ends naming it. Real run above. |
| DestinationRefused | covered | `server/test/docxCompare.test.ts`: `DestinationRefused: …` — outside the writable zone, read-only sandbox, an existing file (left unchanged), and a non-`.docx` name: each refused with its reason and Word never run; `a destination folder that does not exist is named, before Word starts`; `a destination taken while Word ran is not overwritten`. |
| InputOutsideTheSandbox | covered | `server/test/docxCompare.test.ts`: `InputOutsideTheSandbox: either path outside the root …` (absolute path for `original`, `../` for `revised`) and `InputOutsideTheSandbox: a link inside the root to a file outside it is refused` (a real symbolic link; skipped only where the account may not create one — it ran on the Windows machine); Word never run. |
| OversizeInputRefused | covered | `server/test/docxCompare.test.ts`: `OversizeInputRefused: …` — exact message naming the 1 KB limit, Word never run. |
| ComparisonTimesOut | covered | `server/test/docxCompare.test.ts`: `ComparisonTimesOut: …` — a timed-out run fails with "within 7 s (office.renderTimeoutMs)". Real run with a 1 s timeout above. |
| NotOfferedOffWindows | covered | `server/test/documentTools.test.ts`: `NotOfferedOffWindows: …` (darwin and linux get the Word tools without it) and `on Windows a named Word document brings the comparison …`; `server/test/documentToolsWire.test.mjs`: `a document extractor is published when a document is named, and not before` — the real server's request to the model carries `docx_compare` exactly when the platform is `win32` (CI runs it on all three). |
| WordMissing | covered | `server/test/docxCompare.test.ts`: `WordMissing: a failed run says Word is unavailable and names the manual path`, `WordMissing: PowerShell's error record is reduced to its message`, `off Windows nothing is run, and the manual path is named`, `a run that exits cleanly without writing the result is a failure, …`. Real run above. |
