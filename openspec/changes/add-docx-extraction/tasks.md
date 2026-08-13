## 1. Dependencies and configuration

- [x] 1.1 ~~Add a parser dependency~~ **Add nothing.** (design D1, revised twice). *The check this task asked for started it: `fast-xml-parser@5` pulls six transitive packages. Dropping it for `sax` was still the wrong frame — in an air-gapped deployment a dependency is something a security team vendors and re-reviews, so the only version of this task that serves the target is the one that adds no package at all. Zip on `node:zlib`, XML through a scanner scoped to WordprocessingML.*
- [x] 1.2 Add `docx.maxBytes` to `server/src/config.ts` (optional, default 25 MB, validated as a positive integer), mirroring `pdf.maxBytes`, with a test for the default and for a rejected value.

## 2. Shared escaping

- [x] 2.1 Move `escapeCell` out of `server/src/pdf.ts` into a small shared module and import it from both readers (design D6). One escaper, one place to fix — the CodeQL finding that produced it is the kind that returns when a copy is left behind.
- [x] 2.2 Confirm the existing PDF escaping test still passes unmodified, and add the same assertion for the docx path once the table renderer exists.

## 3. Reader (`server/src/docx.ts`)

- [x] 3.1 `server/src/zip.ts` — read an entry by exact name: end-of-central-directory record, local file header, `createInflateRaw` with a byte budget. Entry-count cap before any inflation (design D3/D4), enforcing the entry-count cap and the decompressed-total cap while reading. Refuse a file that is not a zip, and one whose `[Content_Types].xml` does not declare a WordprocessingML document.
- [x] 3.2 Detect an encrypted package (an OLE/`EncryptedPackage` container rather than a zip of parts) and report it as such rather than as a corrupt file.
- [x] 3.2a `server/src/xml.ts` — a scanner scoped to WordprocessingML: start/end/self-closing tags with quoted attributes, text, CDATA, comments, processing instructions, the five predefined entities and numeric references. A DOCTYPE is refused outright, which is what makes entity expansion unreachable (design D1).
- [x] 3.3 `parseBody(xml)`: walk `word/document.xml` with that scanner into an ordered list of blocks — paragraph or table — preserving document order.
- [x] 3.4 Paragraph blocks: text from runs, heading level from the paragraph style, tracked insertions kept and tracked deletions skipped at the run level (design D5).
- [x] 3.5 Table blocks: rows and cells from `<w:tr>` / `<w:tc>`, cell text through the shared escaper, rendered as GFM with the declared column count on every row.
- [x] 3.6 `extractDocx(bytes, { blocks, mode, maxBlocks, maxChars, timeoutMs })`: markdown out, block-attributed, with the truncation note naming the next range (design D2).
- [x] 3.7 Report a readable document with no body content explicitly, naming the parts this change does not read.
- [x] 3.8 Surface the failure kinds the spec names: not a docx, encrypted, budget exceeded (time), decompression cap, entry-count cap.

## 4. Reader tests

- [x] 4.1 Add `.docx` fixtures under `server/test/fixtures/`, built by a committed script like `make-pdfs.mjs`: headings + paragraphs, a table, a mixed document, one with tracked changes, one with body text only in a header, an encrypted package, a non-zip file, and a compression bomb.
- [x] 4.2 `server/test/docx.test.ts`: headings become heading levels, a table becomes a table with its declared shape, mixed order is preserved, `blocks` selects a range, `mode` filters.
- [x] 4.3 Tracked changes: the insertion is present, the deletion is absent **in every mode** — the assertion that matters most in this change.
- [x] 4.4 Failure paths: not a docx, encrypted, entry-count cap, decompression cap, deadline.
- [x] 4.4a `server/test/xml.test.ts` and the zip reader's own tests: a DOCTYPE is refused, entities decode, CDATA and comments are not mistaken for structure, an attribute containing `>` does not end its tag, and a truncated archive fails rather than reading past its end.
- [x] 4.5 Caps: block cap and character cap each truncate, and the note names a range that a second call resolves to the remaining blocks (the "covers everything across successive calls" property the PDF suite has).
- [x] 4.6 A cell containing a pipe and a backslash leaves every row with the declared column count.

## 5. Tool and registration

- [x] 5.1 Build `docx_extract` in `server/src/docxTool.ts` mirroring `pdfTool.ts` — parameter named `path` so `scopeToRoot` confines it (design D7), size ceiling checked with `stat` before the file is opened, `PdfError`-style reasons passed through as messages.
- [x] 5.2 Register it among the read tools in `createSandboxedTools`, and on the non-sandboxed path in `server/src/index.ts`.
- [x] 5.3 Extend `server/test/sandbox-tools.test.ts`: present in a read-only sandbox, absent from no configuration, path-confined (traversal, absolute, symlink, prefix look-alike), allowed inside a declared read exception.
- [x] 5.4 `server/test/docxTool.test.ts`: markdown out for a real fixture, range and mode honoured, missing file, non-docx, oversize refused before parsing.

## 6. Verification

- [x] 6.1 Full server suite and coverage gate (lines 92 / branches 86 / functions 90).
- [x] 6.2 Full UI suite and coverage gate — unchanged by this work, so a failure means something unintended was touched.
- [x] 6.3 `openspec validate add-docx-extraction --strict`.
- [x] 6.4 Measure the published-package delta (expected: only our own source, since nothing is added to `node_modules`), and record it. *Confirmed: `node_modules` is untouched, `cli/dist` stays at 47 MB, and the SEA bundle grew by our four modules alone.* — 0.7.0 grew the package from 60.8 MB to 73.7 MB, and that number belongs in the release note rather than in a surprise.
- [x] 6.5 Confirm `npm run build:sea --workspace server` still produces a working blob. *Blob written (25.7 MB) with `docx_extract` and the zip reader inside it. The native-executable step after it needs Node ≥ 26 and could not run locally on Node 24 — CI switches to 26 for exactly that step, as it did for 0.7.0.*
- [x] 6.6 Manually verify against a real Word document from the target workspace. *Done on `exemples/Discours_methode.docx` (107 blocks, 15 ms): it found two things the hand-written fixtures could not — a 1×1 layout table wrapping the cover page, now read as text, and a document that declares no heading styles at all, which is a limit worth naming rather than a bug (design D8). Still untested: a document carrying real tracked changes from Word, and one exported by Google Docs.*
