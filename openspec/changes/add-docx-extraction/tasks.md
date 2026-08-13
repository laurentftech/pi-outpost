## 1. Dependencies and configuration

- [ ] 1.1 Add `fflate` and `fast-xml-parser` to `server/package.json`, pinned exactly (design D1). Both must be dependency-free and pure JavaScript — check before pinning, that is the property the single-file build depends on.
- [ ] 1.2 Add `docx.maxBytes` to `server/src/config.ts` (optional, default 25 MB, validated as a positive integer), mirroring `pdf.maxBytes`, with a test for the default and for a rejected value.

## 2. Shared escaping

- [ ] 2.1 Move `escapeCell` out of `server/src/pdf.ts` into a small shared module and import it from both readers (design D6). One escaper, one place to fix — the CodeQL finding that produced it is the kind that returns when a copy is left behind.
- [ ] 2.2 Confirm the existing PDF escaping test still passes unmodified, and add the same assertion for the docx path once the table renderer exists.

## 3. Reader (`server/src/docx.ts`)

- [ ] 3.1 `openPackage(bytes, limits)`: read the zip with `fflate`, entries by exact name only (design D4), enforcing the entry-count cap and the decompressed-total cap while reading. Refuse a file that is not a zip, and one whose `[Content_Types].xml` does not declare a WordprocessingML document.
- [ ] 3.2 Detect an encrypted package (an OLE/`EncryptedPackage` container rather than a zip of parts) and report it as such rather than as a corrupt file.
- [ ] 3.3 `parseBody(xml)`: walk `word/document.xml` with `fast-xml-parser` (entity resolution off) into an ordered list of blocks — paragraph or table — preserving document order.
- [ ] 3.4 Paragraph blocks: text from runs, heading level from the paragraph style, tracked insertions kept and tracked deletions skipped at the run level (design D5).
- [ ] 3.5 Table blocks: rows and cells from `<w:tr>` / `<w:tc>`, cell text through the shared escaper, rendered as GFM with the declared column count on every row.
- [ ] 3.6 `extractDocx(bytes, { blocks, mode, maxBlocks, maxChars, timeoutMs })`: markdown out, block-attributed, with the truncation note naming the next range (design D2).
- [ ] 3.7 Report a readable document with no body content explicitly, naming the parts this change does not read.
- [ ] 3.8 Surface the failure kinds the spec names: not a docx, encrypted, budget exceeded (time), decompression cap, entry-count cap.

## 4. Reader tests

- [ ] 4.1 Add `.docx` fixtures under `server/test/fixtures/`, built by a committed script like `make-pdfs.mjs`: headings + paragraphs, a table, a mixed document, one with tracked changes, one with body text only in a header, an encrypted package, a non-zip file, and a compression bomb.
- [ ] 4.2 `server/test/docx.test.ts`: headings become heading levels, a table becomes a table with its declared shape, mixed order is preserved, `blocks` selects a range, `mode` filters.
- [ ] 4.3 Tracked changes: the insertion is present, the deletion is absent **in every mode** — the assertion that matters most in this change.
- [ ] 4.4 Failure paths: not a docx, encrypted, entry-count cap, decompression cap, deadline.
- [ ] 4.5 Caps: block cap and character cap each truncate, and the note names a range that a second call resolves to the remaining blocks (the "covers everything across successive calls" property the PDF suite has).
- [ ] 4.6 A cell containing a pipe and a backslash leaves every row with the declared column count.

## 5. Tool and registration

- [ ] 5.1 Build `docx_extract` in `server/src/docxTool.ts` mirroring `pdfTool.ts` — parameter named `path` so `scopeToRoot` confines it (design D7), size ceiling checked with `stat` before the file is opened, `PdfError`-style reasons passed through as messages.
- [ ] 5.2 Register it among the read tools in `createSandboxedTools`, and on the non-sandboxed path in `server/src/index.ts`.
- [ ] 5.3 Extend `server/test/sandbox-tools.test.ts`: present in a read-only sandbox, absent from no configuration, path-confined (traversal, absolute, symlink, prefix look-alike), allowed inside a declared read exception.
- [ ] 5.4 `server/test/docxTool.test.ts`: markdown out for a real fixture, range and mode honoured, missing file, non-docx, oversize refused before parsing.

## 6. Verification

- [ ] 6.1 Full server suite and coverage gate (lines 92 / branches 86 / functions 90).
- [ ] 6.2 Full UI suite and coverage gate — unchanged by this work, so a failure means something unintended was touched.
- [ ] 6.3 `openspec validate add-docx-extraction --strict`.
- [ ] 6.4 Measure the published-package delta the two dependencies add, and record it — 0.7.0 grew the package from 60.8 MB to 73.7 MB, and that number belongs in the release note rather than in a surprise.
- [ ] 6.5 Confirm `npm run build:sea --workspace server` still produces a blob with both dependencies bundled. This step never runs in PR CI, and it needs Node ≥ 26.
- [ ] 6.6 Manually verify against a real Word document from the target workspace: a long specification with headings and tables, one with tracked changes, and one exported from Google Docs (its markup differs from Word's).
