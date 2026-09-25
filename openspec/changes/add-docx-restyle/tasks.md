# Tasks

## 1. Before writing
- [ ] 1.1 Get one of the colleague's real documents (anonymised is fine) and the new template; read where the hand formatting sits. _Built from a hand-written drifted document (`fixtures/make-docx-template.mjs`); to confirm on a real one._

## 2. Restyle
- [x] 2.1 `docxRestyle.ts`: template styles and theme, ids rewritten by name, missing styles carried, heading numbering carried, document lists kept.
- [x] 2.2 Remove `w:rFonts`, `w:sz`, `w:szCs`, `w:color` in every story; tracked with `w:rPrChange`; `track_changes: false`.
- [x] 2.3 `include: ["page", "headers"]`: page size and margins per section (orientation kept, `w:sectPrChange`); header and footer parts replaced and repointed.
- [x] 2.4 Text-unchanged check before writing; refusal on pending revisions.

## 3. Tool and skill
- [x] 3.1 `docx_restyle` registered with the Word tools, absent read-only.
- [x] 3.2 Skill `docx-from-template`: the restyle loop. Docs: README, `docs/how-to.md`.

## 4. Prove it
- [x] 4.1 Fixture: a drifted document (English ids, hand-set fonts in body, table, header, footnote, comment; a custom style; a numbered list; a landscape section and its own header; a pending-revision variant).
- [x] 4.2 Tests for every scenario; wire test with the scripted model.
- [x] 4.3 Render before and after; OOXML validation.
- [ ] 4.4 Running app check; scenario matrix and `npm run check:scenarios`.
- [ ] 4.5 On Windows: open in Word, check the revisions, *Accept all* and *Reject all*.
