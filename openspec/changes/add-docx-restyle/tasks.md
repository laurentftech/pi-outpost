# Tasks

## 1. Establish before writing
- [ ] 1.1 Get one or two of the colleague's real documents (anonymised is fine) and the new template; read their parts: where the hand formatting sits, which styles the template lacks.
- [ ] 1.2 Settle open questions 1–3 of the design with the project owner on those documents (default removal set, lookalike headings, unstyled tables).
- [ ] 1.3 Confirm from the ECMA-376 text which run and paragraph properties `w:rPrChange` / `w:pPrChange` must hold, and how Word shows and rejects them (open question 4).

## 2. Restyle
- [ ] 2.1 `docxRestyle.ts`: style correspondence by name reusing `WordComposer`, carried-over styles with `basedOn` repointed, `style_map`, theme and heading numbering from the template, document lists kept.
- [ ] 2.2 Removal of direct formatting per the design's tables, over every story; `clear` options; list-paragraph indentation kept.
- [ ] 2.3 Tracked formatting changes (`w:rPrChange`, `w:pPrChange`, `w:sectPrChange`) through `docx_update`'s revision writer; `track_changes: false`.
- [ ] 2.4 `include: ["page", "headers"]`.
- [ ] 2.5 Text-unchanged proof before writing; refusal on pending revisions.
- [ ] 2.6 Report: removals by kind and style, styles the template lacks, lookalike headings; `dry_run`.

## 3. Tool, publication, skill
- [ ] 3.1 `docx_restyle` registered with the Word tools, absent read-only; published with `WORD_TOOLS`.
- [ ] 3.2 Skill `docx-from-template`: the restyle loop (template → dry run → restyle → render and compare → report what is left).
- [ ] 3.3 Docs: README, `docs/how-to.md`.

## 4. Prove it
- [ ] 4.1 Fixtures: a drifted document (English ids, hand-set fonts in body, table, text box, header, footnote, comment; a custom style; a lookalike heading; a numbered list; a pending revision variant).
- [ ] 4.2 Unit tests for every scenario; wire test with the scripted model.
- [ ] 4.3 Render before and after through LibreOffice and look; OOXML validation of every output.
- [ ] 4.4 Running app: the agent restyles a document from the UI; monkey pass.
- [ ] 4.5 Scenario matrix and `npm run check:scenarios`.
- [ ] 4.6 On Windows (project owner or colleague): open in Word, check the formatting revisions, *Accept all* and *Reject all*.
