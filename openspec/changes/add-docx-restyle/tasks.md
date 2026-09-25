# Tasks

## 1. Before writing
- [ ] 1.1 Get one of the colleague's real documents (anonymised is fine) and the new template; read where the hand formatting sits.

## 2. Restyle
- [ ] 2.1 `docxRestyle.ts`: template styles and theme, ids rewritten by name, missing styles carried, heading numbering carried, document lists kept.
- [ ] 2.2 Remove `w:rFonts`, `w:sz`, `w:szCs`, `w:color` in every story; tracked with `w:rPrChange`; `track_changes: false`.
- [ ] 2.3 Text-unchanged check before writing; refusal on pending revisions.

## 3. Tool and skill
- [ ] 3.1 `docx_restyle` registered with the Word tools, absent read-only.
- [ ] 3.2 Skill `docx-from-template`: the restyle loop. Docs: README, `docs/how-to.md`.

## 4. Prove it
- [ ] 4.1 Fixture: a drifted document (English ids, hand-set fonts in body, table, header, footnote, comment; a custom style; a numbered list; a pending-revision variant).
- [ ] 4.2 Tests for every scenario; wire test with the scripted model.
- [ ] 4.3 Render before and after; OOXML validation.
- [ ] 4.4 Running app check; scenario matrix and `npm run check:scenarios`.
- [ ] 4.5 On Windows: open in Word, check the revisions, *Accept all* and *Reject all*.
