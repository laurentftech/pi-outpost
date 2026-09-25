# Tasks

## 1. Build
- [ ] 1.1 `pptxUpdate.ts`: slide addressing (number/title, refusal with list), replace in own placeholders, insert on own layout, delete, move, reachability sweep, byte-identical untouched parts.
- [x] 1.2 `pptx_render` `slides` selection — already there (`add-pptx-from-template`); nothing to add.
- [ ] 1.3 Tool registration and publication; skill `pptx-from-template` gains the update loop.

## 2. Proving it
- [ ] 2.1 Unit tests (byte identity of untouched slides; sweep; refusals); wire test.
- [ ] 2.2 Render through LibreOffice and look; OOXML validation.
- [ ] 2.3 Scenario matrix and `npm run check:scenarios`.
- [ ] 2.4 On Windows (project owner): open the updated deck in PowerPoint without repair.
