# Proposal

## Why

A teacher asked Claude for a poster and gave it four illustrations she had made with Gemini. They never reached the poster. The model sees an attached image but cannot pass its bytes to a tool, and the poster guide forbids embedded pictures anyway, so Claude fell back to emoji, which are too limited for real posters. Once the poster is made, she cannot add anything to it herself either: no picture, no text box, no shape. She can only correct what the model wrote. She expects what PowerPoint's Insert tab gives her.

## What Changes

- **An Insert menu.** The editor gets one "Insert" control with a menu: *Picture…*, *Text*, and a small set of shapes (rectangle, rounded rectangle, ellipse, triangle, arrow, line, star, speech bubble). The rest of the toolbar is unchanged.
- **Picture slots.** The model can lay out empty picture frames, `<img data-poster-picture="bread" alt="bread">`, styled as empty only while they are empty. The person double-clicks a frame and picks a file, and the picture fills it. The frame's dashed border and tint go once it is filled.
- **Pictures from the person.**
  - Insert → Picture… fills the selected picture or frame, or else puts the picture in the middle of the page.
  - A picture file dropped from the desktop lands where it is dropped, or in the frame it is dropped on.
  - The browser shrinks each picture so its longest side is at most 1200 px, keeping PNG when the picture may be transparent and JPEG otherwise. It is embedded in the poster as a data URL, so the poster stays one self-contained page that prints and exports as before.
- **Text boxes.** Insert → Text puts a text box on the page, ready to type in. It moves, resizes and restyles like any element.
- **Shapes.** Insert → a shape puts that shape on the page. It moves and resizes as one block, and its fill and line colours are set in the Format panel.
- **Moving and resizing.** Pictures, shapes and text boxes move with the mouse and resize from their corners. Pictures keep their proportions when resized. A press that does not travel stays a click or a double-click. The browser's own dragging of an image never starts: in Claude Desktop it carried the picture off its card.
- **Vector drawings by the model.** The guide stops restricting the model to emoji and small shapes. The model may draw real SVG illustrations, each in its own element with a viewBox and no text, within a size budget. The editor selects, moves and resizes such a drawing as one block, never path by path.
- **Pictures never reach the model as data.** When a host hands a poster to the model, each embedded picture is replaced by a short marker. When the model sends a poster back, the markers are put back as the pictures they stand for. The model can therefore rework a poster without seeing megabytes of base64 or erasing the pictures. This applies in the Claude extension, the Open WebUI tool server, and pi-outpost's agent reading and writing poster files.
- **The model can look at the pictures.** In Claude Desktop, `get_poster` with `see_pictures` also returns the pictures as images; in pi-outpost, the new `poster_pictures` tool does the same; in Open WebUI, `get_poster` with `see_pictures` lists them in a form Open WebUI hands the model as images. The model then sees what a frame holds rather than guessing it from the frame's name.
- **Renaming a poster.** `update_poster` takes an optional new title. In Claude Desktop the poster's file is renamed after it.
- **The page stays in view.** Scrolling or zooming can no longer push the page out of the editor and leave an empty desk.
- **Size ceiling raised** from 2 MB to 8 MB of markup and stylesheet. The refusal message no longer advises emoji.

Out of scope:
- Connected diagrams (boxes whose arrows follow them): draw.io's job.
- Generating pictures through an image API: a later change, `poster-illustrator`.
- Relabelling the rest of the toolbar, which stays as it is.

## Capabilities

### New Capabilities
- `poster-elements`: what the person and the model put on a poster besides its text:
  - picture slots;
  - the Insert menu: pictures, text boxes, shapes;
  - dropping pictures, and scaling and embedding them;
  - moving and resizing pictures, shapes, text boxes and drawings as wholes;
  - keeping embedded pictures out of what the model reads and restoring them in what it writes, in every host.

### Modified Capabilities
- `mcp-poster-app`: `update_poster` renames a poster (`APosterIsRenamed`); `get_poster` shows the pictures on request (`TheModelCanLookAtThePictures`).
- `openwebui-posters`: `update_poster` retitles a poster (`APosterIsRetitled`); `get_poster` lists the pictures for the model on request (`TheModelCanLookAtThePicturesInOpenWebUI`).
- `poster-editor`: the page stays in view however it is scrolled or zoomed (`ThePageStaysInView`).
- `poster-documents`:
  - `PosterHoldsNoScriptAndFetchesNothing`: pictures are no longer limited to emoji and small inline SVG.
  - `PosterSizeIsBounded`: the ceiling rises, and its refusal no longer advises emoji.
  - `ThePosterGuide`: the shared guide teaches picture slots and vector drawings.

## Impact

- **`posters/` (`@pi-outpost/posters`)**
  - `editor.ts`: Insert menu, picture slots, dropping, scaling, text boxes, shapes, drag handling, drawings as wholes, the Format panel's shape colours.
  - `format.ts`: the ceiling, and marker substitution and restoration as shared functions.
  - `guide.ts`: the rules and the example.
- **`mcp/src/posters/`**: `get_poster` returns markers and `update_poster` restores them, against the stored revision.
- **`openwebui/src/posters.ts`**: the same for its tools. The embed's save endpoint must accept posters up to the new ceiling.
- **pi-outpost**
  - The posters skill.
  - The hooks that keep pictures out of the agent's reads of `.poster.html` files and put them back on its writes and edits. They use pi's `tool_call` and `tool_result` extension events in `server/src/piOutpostTools.ts`.
  - The file preview and the editor's save path must accept posters up to the new ceiling.
- **Tests**: `posters/test`, `mcp/test/posters.test.ts`, `openwebui/test/posters.test.ts`, e2e `mcp-poster-app`, `poster-files` and `openwebui-posters`. The probes `scripts/probes/poster-pictures.mts` and `poster-slot-drag.mts` record what was found.
- **Docs**: `docs/claude-desktop.md`, `docs/openwebui.md`, `README.md` (the posters section), `skills/posters/SKILL.md`.
