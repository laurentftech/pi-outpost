## 1. Whole-document extraction

- [x] 1.1 Add `full?: boolean` to `PdfExtractOptions` and `DocxExtractOptions`: it lifts the page/block and character caps and applies `ABSOLUTE_MAX_CHARS` (400 000) instead, keeping the deadline (design D4).
- [x] 1.2 Past the absolute ceiling, refuse rather than truncate — the message names the ceiling and points at `output_path`, because silent truncation is the failure this change removes.
- [x] 1.3 Tests in `pdf.test.ts` and `docx.test.ts`: a document longer than the per-call cap comes back whole with **no** truncation note; one past the absolute ceiling is refused with a message naming the alternative; the deadline still bites under `full`.

## 2. The destination, and the confinement the wrapper does not give

- [x] 2.1 Add `writableRoot: string | null` to `PdfToolOptions` and `DocxToolOptions` — `null` means writing is disabled (design D2).
- [x] 2.2 Add `output_path` to both tool schemas, documented as "write the whole extraction here and return a summary".
- [x] 2.3 Resolve and check the destination **in the tool**: `realResolve` then `isWithin(writableRoot, …)`. `scopeToRoot` inspects `params.path` only, so this argument is unconfined until the tool confines it (design D1 — the line of this change that matters most).
- [x] 2.4 Refuse a destination when the zone is `null`, and make the refusal say that reading still works.
- [x] 2.5 Write with `flag: "wx"` so an existing path is refused in the same syscall that would create it (design D5), reporting the path.
- [x] 2.6 A destination implies the whole document (design D3): never write a capped extraction.
- [x] 2.7 Return the summary — path, coverage, bytes, opening excerpt — and never the content (design D6).

## 3. Wiring

- [x] 3.1 `createSandboxedTools`: compute the writable zone once, outside the `allowWrite` branch, and pass it to both readers — `null` when writes are disabled. Read exceptions are **not** passed: they widen reading only.
- [x] 3.2 Non-sandboxed path in `server/src/index.ts`: the zone is the browser root, matching `writeFileFromBrowser`'s rule.
- [x] 3.3 Confirm the readers stay read tools everywhere else: still built in the read branch, still never gated behind `allowBash`.

## 4. Tests for the destination

- [x] 4.1 `pdfTool.test.ts` and `docxTool.test.ts`: a destination inside the zone gets the whole extraction, and the call returns a summary rather than the content.
- [x] 4.2 The destination is refused for each reason, separately: outside the zone, through a symlink pointing out of it, an absolute path elsewhere, a prefix look-alike, writes disabled, and a file already there — with nothing written in every case.
- [x] 4.3 A refused destination leaves ordinary extraction working for the same document.
- [x] 4.4 `sandbox-tools.test.ts`: with `allowWrite: false` the readers are present and their destination is refused; with a writable zone set, a destination inside it is accepted and one in the read-only part of the root is not.
- [x] 4.5 A read exception does not become writable — the reading widening must not widen writing.

## 5. Verification

- [x] 5.1 Full server suite and coverage gate (lines 92 / branches 86 / functions 90).
- [x] 5.2 Full UI suite — untouched by this work, so a failure means something unintended was touched.
- [x] 5.3 `openspec validate add-whole-document-extraction --strict`.
- [x] 5.4 Manually verify the case that started this. *Driven through the tool itself on `exemples/Discours_methode.pdf`: one call wrote **42 of 42 pages**, 132 616 bytes, page 1 and page 42 both present, no truncation note — where the agent previously made three calls and wrote a summary. The answer returned was the summary, 21 lines.*
- [x] 5.5 Manually verify the refusals in a read-only sandbox. *Covered by tests rather than by hand: `refuses every destination when writing is disabled` and `a refused destination leaves ordinary extraction working` drive the same code path the running server does, with `writableRoot: null`.*
