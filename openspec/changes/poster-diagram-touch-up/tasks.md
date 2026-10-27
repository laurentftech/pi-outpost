# Tasks

## 1. The diagram touch-up, opened on a page

- [x] 1.1 `DrawioFrame`/`drawioPage.ts`: a starting page in the RENDER message, used by the viewer when it has nothing drawn yet; verify with a `DrawioFrame.test.tsx` case that RENDER carries the page; the real viewer showing page 2 first is checked by 3.1's e2e (DoubleClickOpensTheDiagramsPage), the viewer e2e harness having no way to ask for a page.
- [x] 1.2 `DrawioBlock`: optional `page` (name or number, resolved with `drawioPages`) and `startTouchUp`; verify in `DrawioBlock.test.tsx` that it renders the named page and begins touch-up without a click, and that an unknown page says which pages exist.

## 2. The request between editor and host

- [x] 2.1 `posters/src/frame.ts`: `DRAWIO_EDIT { id, path, page? }`, answered `{ ok, value: changed }` or `{ ok: false, message }`; `PosterHost.diagrams.edit` in `editor.ts`; `web/src/posterEditorFrame.ts` wires it with no timeout. Verify with `posters` and `web` typecheck and the frame message documentation updated in `frame.ts`.
- [x] 2.2 `PosterFrame`: answer DRAWIO_EDIT by opening a modal overlay holding `DrawioBlock` (page, touch-up started, draw.io desktop action), read the file on open and again on close, answer whether it changed; reject when unreadable or when the poster closes. Verify in `FileViewer.poster.test.tsx`: the overlay opens on the named page, closing after a file change answers `true`, closing without answers `false`, a missing diagram answers its reason, unmounting rejects.

## 3. The editor

- [ ] 3.1 Double-click on a picture naming a diagram, in a host with `diagrams.edit`, asks the host instead of a file; ignored while a request is pending; other pictures and other hosts still ask for a file. Verify with e2e in `poster-files.spec.ts` (DoubleClickOpensTheDiagramsPage, AMissingDiagramSaysWhy) and `mcp-poster-elements.spec.ts` (ADiagramPictureElsewhereStillAsksForAFile, ThePersonFillsASlot still passing).
- [ ] 3.2 On `true`: redraw the page through `draw`, replace every picture naming the same page (same path, same page with absent = "1"), keep place and width, set height from the new proportions when the element has a set height; one undoable change, poster dirty. On a failed redraw, pictures unchanged and the status names why. Verify with e2e in `poster-files.spec.ts`: TheSavedPageReplacesThePicture, EveryPictureOfThePageIsReplaced, ATallerPageKeepsTheWidth, NothingSavedNothingChanged.

## 4. Following the file, and the running app

- [ ] 4.1 The overlay follows the file: a change written to the `.drawio` from outside while it is open (standing in for draw.io desktop) is drawn, and closing puts it in the poster. Verify with e2e ASaveFromDrawioDesktopReachesThePoster in `poster-files.spec.ts`, writing the file through the server, and TheDiagramCanGoToDrawioDesktop asserting the open-natively request for the diagram's path.
- [ ] 4.2 Drive it in the running app (bench): double-click a diagram in a poster, move a box, save, close, save the poster; then the monkey pass — double-click twice fast, close with unsaved touch-ups, switch file with the overlay open, delete the `.drawio` while open, rename its page in the touch-up. Record what broke and fix it in scope.
- [ ] 4.3 `docs/claude-desktop.md` or the README's poster section: say that a diagram in a poster is touched up by double-clicking it in pi-outpost; verify the wording against the running app.
- [ ] 4.4 `openspec/changes/poster-diagram-touch-up/scenario-coverage.md` with every scenario covered, `npm run check:scenarios` passing, `openspec validate poster-diagram-touch-up --strict` passing, and the poster and draw.io e2e suites green.

## Workflow follow-up

- Archive poster-drawio-pictures before this change, from main, after merge.
- Then archive this change from main.
