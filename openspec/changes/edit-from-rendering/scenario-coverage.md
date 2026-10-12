# Scenario coverage — edit-from-rendering

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| EditFromTheRenderingGoesBesideIt | covered | `e2e/file-editor.spec.ts` — "editing from the rendering moves beside it, and done brings the rendering back — Markdown, HTML and a diagram": for each kind, rendered is pressed, edit presses split with the editor and the rendering visible, done presses rendered with no editor. `ui/src/components/FileViewer.split.test.tsx` — "moves beside the rendering, and done brings the rendering back", "cancels back to the rendering too, the draft dropped", "keeps a mode the reader then chose: done leaves the editor and stays there". |
| EditFromTheRenderingWithoutRoomShowsTheSource | covered | `ui/src/components/FileViewer.split.test.tsx` — "moves to the text alone when there is no room for two panes": with no room, edit presses source with the editor and no split; done presses rendered with no editor. |
