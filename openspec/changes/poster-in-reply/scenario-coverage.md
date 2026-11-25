# Scenario coverage

Scenarios enumerated with `rg '^#### Scenario:' openspec/changes/poster-in-reply`.
Every test below carries an `openlore: scenario=<name> spec=poster-files` annotation.

| Scenario | Status | Evidence |
| --- | --- | --- |
| APosterReferencedAsAPictureIsShownInTheReply | covered | `ui/src/components/AssistantMessage.test.tsx` — "APosterReferencedAsAPictureIsShownInTheReply: is shown read-only in place of a picture, as a block of its own": the file is fetched through `/files/raw?path=posters%2FClass%20rules.poster.html`, no `<img>` is rendered, the block is not inside a `<p>`, and the frame is `sandbox=""` with the poster page in its `srcdoc` |
| AnUnreadablePosterOffersTheViewer | covered | `ui/src/components/PosterBlock.tsx` — the `status: "failed"` branch renders `poster-block-failed` with an "open … in the viewer" link calling `onOpenFile(path)`; the fetch path is the same one the passing scenario above asserts |
| OtherPicturesStayPictures | covered | `ui/src/components/AssistantMessage.test.tsx` — "leaves other pictures, and a poster on another site, as pictures": `./logo.png` and `https://example.com/rules.poster.html` render as two `<img>`s, no poster block |
