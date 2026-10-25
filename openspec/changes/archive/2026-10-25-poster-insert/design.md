# Design

## Context

The editor is GrapesJS 0.23.8, mounted by `posters/src/editor.ts` in all three hosts:
- the Claude extension's MCP App view;
- pi-outpost's `web/poster-editor.html` frame;
- the Open WebUI embed.

The prototype for this change already lives on the branch, in `editor.ts`. Two probes check it in the MCP host frame Claude Desktop uses (`allow-scripts allow-same-origin`):
- `scripts/probes/poster-pictures.mts` covers slots, Insert picture, drop, drawings, move and resize, reopen, save, `get_poster`, and the Word export;
- `scripts/probes/poster-slot-drag.mts` covers a picture dragged inside its card.

The user then checked the file picker, dropping from the Finder and moving in the real Claude Desktop.

What the probes found, and the decisions below rest on:
- **Double-click.** GrapesJS's image view opens its own asset manager on double-click, not the `core:open-assets` command, so overriding the command does nothing.
- **SVG cannot be dragged.** GrapesJS starts a move from the browser's `dragstart`, and an SVG element never fires one. The drag went to the nearest HTML ancestor, so the card moved.
- **Translate mode on absolute elements.** GrapesJS's `translate` drag miscomputes on an element that is already `position: absolute`: the picture jumped several times the mouse distance.
- **Native image drag in Electron.** Electron dragged an `<img>` natively despite GrapesJS cancelling `dragstart`, carrying it off its card. Playwright intercepts native drags, so only Claude Desktop showed it.
- **Content-Security-Policy.** Each host's CSP already allows `img-src data:`, and the sanitiser keeps `data:image/*` URLs.
- **Export.** The export draws embedded pictures; three pictures gave a 709 kB page picture in the Word file.

Size constraints met along the way:
- `MAX_POSTER_BYTES` is 2 MB.
- pi-outpost's file preview refuses files over 1 MiB (`MAX_PREVIEW_BYTES`), and the editor opens posters through it. A poster with four or five pictures crosses that limit.
- pi's `read` tool stops at 50 kB and does not return partial lines. A poster with an embedded picture holds a line far longer than that, so the agent cannot read it at all.

## Goals / Non-Goals

**Goals:**
- One implementation of picture handling, in `@pi-outpost/posters`, used unchanged by the three hosts.
- Picture data never enters the model's context in any host, and is never lost because the model rewrote a poster.

**Non-Goals:**
- Connected diagrams, whose arrows follow the boxes they join: draw.io's job.
- Pictures referenced by URL or by a path beside the poster: the poster stays one self-contained page.
- Cropping, filters or any other picture editing beyond move and resize.
- Pictures in Open WebUI embeds without same-origin, which stay read-only.

## Decisions

### 1. Pictures are embedded data URLs, scaled in the browser

The poster must open, print and export with nothing fetched, and every host's CSP already allows `data:` images. Scaling happens in the editor through `createImageBitmap` and a canvas, with no server round trip and the same code in every host:
- the longest side is capped at 1200 px, which is 300 dpi over about 10 cm, enough for a picture on an A4 poster;
- PNG is kept for PNG, GIF, WebP and SVG sources, which may be transparent; anything else becomes JPEG at quality 0.85.
- When `createImageBitmap` refuses a file the browser can still show, decoding falls back to an `<img>` from a `blob:` URL. That covers SVG files, which it does not take, and PNGs its stricter decoder rejects; the e2e for pi-outpost met one. Every host's policy already allows `blob:` pictures.

*Alternative:* store pictures as files beside the poster and reference them. Rejected: it breaks the single-file page, needs a fetch route in every host, and the export would have to resolve them.

### 2. A slot is an `<img>` marked `data-poster-picture`, saved without a source while empty, and filling it clears its own border and background

The model lays out `<img data-poster-picture="bread" alt="bread">`, gives it a size, and styles it as empty (a dashed border, a tint) on its own class. It is not styled through `:not([src])`: GrapesJS draws an empty `<img>` with a placeholder `src` in the canvas, so such a rule would never show in the editor. Two consequences follow:
- **Saving.** GrapesJS would also write that placeholder (an SVG data URL) into the saved markup, which would turn the empty frame into a picture for good. The image type's `getAttrToHTML` therefore drops `src` while the image still holds the placeholder (`isDefaultSrc()`).
- **Filling.** When the editor fills a slot, it also writes `border: none; background: none` for that element only. With `componentFirst` that style is filed under the element's id, overrides the class rule, and can be undone. The user's first poster put its dashed border on the slot's class in just this way.

### 3. Double-click and Insert → Picture go through one picker; GrapesJS's asset manager is never opened

The image component's view overrides `onActive` and raises an editor event that opens a hidden file input. The click comes from the user's double-click, so the browser allows the file chooser. Insert → Picture fills the selected image, if any, and otherwise places the picture. Choosing it from the menu is a user click as well, so the chooser opens.

### 3b. One "Insert" control with a menu

The toolbar gets one button, "Insert", opening a small menu built by the editor (not a GrapesJS panel): Picture…, Text, then the eight shapes, each with its icon. A verb on the button and nouns in the menu, as in PowerPoint's Insert tab. The rest of the bar is unchanged, as the user asked. The menu closes on a choice, on Escape and on a click elsewhere. It is hidden, like the other editing controls, when the poster cannot be edited.

*Alternative:* three buttons (Insert picture, Insert text, Insert shape ▾). Rejected: the bar already wraps onto two lines in a narrow frame.

### 3c. Text boxes are ordinary text elements, placed

Insert → Text appends `<div class="poster-text">Text</div>` to the page, `position: absolute`, centred, about a third of the page wide. It takes the poster's font by inheritance, at 32 px. It is selected with GrapesJS's rich-text editing turned on and its placeholder selected, so typing replaces it. Afterwards it is an element like any other: the Format panel restyles it, double-click corrects it, decision 4 moves it, and its width is resizable while its height follows the text.

### 3d. Shapes are inline SVG in a holder, coloured through custom properties

Insert → a shape appends `<div class="poster-shape"><svg viewBox="0 0 100 100" preserveAspectRatio="none">…</svg></div>`, absolutely positioned and centred, at 200 × 200 px (200 × 40 for the line and the arrow).
- **Sizing.** The SVG fills the holder, and `preserveAspectRatio="none"` lets a shape stretch freely. Strokes carry `vector-effect: non-scaling-stroke`, so a stretched shape keeps an even line.
- **Colours.** The SVG paints with `fill: var(--shape-fill, #4fc3f7)` and `stroke: var(--shape-line, none)`, with a width of `var(--shape-line-width, 0)`. The line paints its stroke with the fill colour. The Format panel gains a "Shape" sector, shown only for a selected shape, holding three custom properties on the holder: fill, line colour and line width. Custom properties inherit into the SVG, and they print and export like any CSS.
- **Handling.** The shapes are drawn here in the editor (eight short path definitions), so nothing is fetched. A shape is then a drawing as in decision 5 (selected, moved and resized through its holder), except that it resizes freely: the ratio is kept only for pictures and model drawings.

- **Text in a shape.** Every shape but the line holds a `<div class="poster-shape-text">` after its SVG, absolutely placed over it, centred with flexbox and inset so that it wraps inside. It inherits font, size and colour from the holder, so the Format panel's Text fields, set on the selected shape, style it. The text is inert to the mouse until edited: a double-click on the shape (handled in the canvas, as GrapesJS gives a plain `div` no double-click action) makes it selectable, selects it and turns on GrapesJS's text editing; leaving the edit makes it inert again. A shape inserted before this, without the text element, gets one on its first double-click.
- **The speech bubble's tail.** The bubble is one path computed from its tail tip, kept on the holder as `data-tail="x,y"` in the 100 × 100 box, and allowed outside it (`overflow: visible`). The body fills the box as a rounded rectangle, and the tail leaves from its side facing the tip, the side picked by the tip's larger offset from the centre, its base clamped along that side. A yellow handle, an element of the editor's own in the canvas document (not a component, so never saved), sits at the tip while a bubble is selected. Dragging it rewrites the path and the handle's place live, and commits both, the path's `d` and `data-tail`, to the components on release, so the move is one step to undo. It is repositioned whenever the selection, the bubble's style or its size changes.

*Alternative:* CSS-only shapes (borders, `border-radius`, `clip-path`). Rejected: a clipped element cannot take a line, and the star, arrow and bubble need paths anyway.

### 4. Placing, moving and resizing

- **Where a placed element goes.** A picture that fills no slot, a text box or a shape is placed `position: absolute` in the page. It is centred on the drop point, or on the page for an Insert menu choice, and clamped inside the page.
- **How placed elements move.** Absolutely positioned elements use GrapesJS's `absolute` drag mode, which moves them by `left/top`, because `translate` miscomputes on them. Drag mode is not kept in the markup, so the editor applies it on every open to each element whose computed position is `absolute`; that covers elements the model positioned too.
- **Starting a move.** On an `<img>`, `mousedown` is default-prevented, so no native image drag ever starts. The editor starts GrapesJS's move itself (`tlb-move` with the original `mousedown` event) once the mouse has travelled 4 px with the button held. A press that does not travel stays a click or a double-click: starting the move on `mousedown` itself swallowed the double-click.
- **Starting a move, for the other elements.** Shapes, text boxes and drawing holders are HTML elements and fire `dragstart`, so GrapesJS's own move applies to them.
- **Resizing.** Pictures and model drawings (elements whose only child is an SVG) resize from the corners with the ratio kept. Shapes resize freely from all eight handles. Text boxes resize their width.

### 4b. The page stays in view

The infinite canvas lets two-finger scrolling move around a zoomed page, and nothing stopped it from moving the page out of the view. After the person's own gestures (a wheel or trackpad scroll or a pinch over the page, the zoom buttons), on the next frame, the editor compares the canvas frame's box with the visible area, then moves the canvas back by the difference through `setCoords`, which works in screen pixels:
- a page smaller than the area is kept wholly inside it, 16 px from its edges;
- a larger page can never bring an edge more than 16 px inside.

A flag keeps the correction from reacting to itself. It first listened to every `canvas:coords` and `canvas:zoom` event. On the CI runner, a pixel's disagreement between that clamp and GrapesJS's own fit set the two correcting each other, so the page was never still under a click; it now follows gestures only.

### 5. A drawing is an element holding one SVG, and the SVG lets the mouse through

The canvas gets `svg, svg * { pointer-events: none }`, and the `svg` and `svg-in` component types are made unselectable and undraggable. A click on a shape therefore lands on the drawing's holder (`<div class="drawing">` in the guide), and the holder fires `dragstart`, so GrapesJS selects, drags and resizes it.

*Alternative:* drag the SVG through our own mouse handling, as for pictures. Rejected: an SVG directly inside a card would still have no box GrapesJS can resize as a block. The holder gives one, and the guide asks for it.

An SVG the model wrote without a holder is selected through its parent. That is acceptable, and the guide asks for the holder.

### 6. Markers: `poster-picture:N` in place of picture data

A shared module in `@pi-outpost/posters` provides two functions:
- **`hidePictures(html, css)`** replaces every `data:image/…` URL with `poster-picture:N`, numbered in document order, and returns the replaced markup with the list of pictures. In the markup that means `src`; in the stylesheet, `url()`. The model sees, for example, `src="poster-picture:2"`. One line at the top of the markup also lists each marker with its slot name and size, so the model can say "the bread picture".
- **`restorePictures(html, css, pictures)`** puts the data back. It refuses a marker that is not in the list, with a message naming it. A picture whose marker is missing is simply dropped.

Where each host applies them:
- **Claude extension.** `get_poster` hides, and `update_poster` restores from the revision named by `base_revision`. That revision is already required and checked, so the pictures restored are those the model read. `create_poster` restores against no pictures, so a marker in a new poster is refused.

  `show_poster`'s structured content also carries markers, with a picture count, because Claude Code hands the model the structured content rather than the text (archived change `mcp-summary-in-structured-content`). The view then asks a new app-only tool, `poster_pictures` (`id`, `revision`), for the pictures, and restores them before opening the editor. If that fails, the poster opens without its pictures and read-only, so a save cannot drop them.
- **Open WebUI tool server.** The same two tools, the same way.
- **pi-outpost.** Agents read and write poster files with their ordinary tools, so the extension in `server/src/piOutpostTools.ts` hooks pi's events:
  - `tool_result` for a `read` of a `*.poster.html` file replaces what the tool returned with the file read again from disk, its pictures hidden, cut to the call's `offset` and `limit` and to pi's own 50 kB and 2000-line ceilings (`truncateHead`, exported by the SDK). pi's own `read` cannot show a line longer than 50 kB, and an embedded picture is one. Redirecting `read` to a hidden copy was considered and dropped: the sandbox confines `read` to the project, and a copy inside it would show in the file tree.
  - `tool_call` on `write` and `edit` of a `*.poster.html` file restores markers in `content`, and in each of `edits[].oldText` and `newText`, from the file as it is on disk, before the tool runs. An unknown marker blocks the call with the reason.

  Probe `scripts/probes/poster-agent-hooks.mts` (task 1.1) checked this on the pinned SDK. With the real server and a scripted agent on a poster holding a 200 kB picture, the read showed the marker and no data, a `write` with the marker kept the picture, and an `edit` whose `oldText` held the marker matched and kept it.

  `bash` reading the file is not covered; the skill tells the agent to use `read`.

*Alternative for pi-outpost:* dedicated `read_poster` and `update_poster` tools. Not needed, since the probe showed the hooks work. Hooks keep the agent on the file tools the skill already teaches, and cover the `edit` tool, which a dedicated tool would not.

### 6b. Letting the model look at the pictures, on request

A marker hides what a picture shows, and the user found Claude calling a family picture "your bread picture" because its frame was named `bread`. `get_poster` therefore takes `see_pictures`: after the JSON text block, each picture comes back as an MCP image block, announced by a text block naming its marker. Only PNG, JPEG, GIF and WebP data URLs are shown, as the model takes those; anything else, such as an SVG pattern, is named. There are at most eight per call, at about a thousand tokens each for a 1200 px picture. The default stays off, so ordinary reads cost nothing more, and the description says when to ask.

Hosts:
- **Open WebUI:** an OpenAPI tool server answers in JSON. Open WebUI 0.12.3 (`utils/middleware.py`, `extract_base64_images`) takes every string of that JSON that is a whole base64 picture data URL out of the text, replaces it with `[image]`, and hands it to the model as an image in native function calling. It is not shown to the user. `get_poster` with `see_pictures` therefore adds `pictures: [{ marker, image }]` with such strings. Two conditions: the model is set to native function calling, and it takes images.
- **pi-outpost:** a tool of its own, `poster_pictures({ path, pictures? })`, read-only and confined like `drawio_check`. It returns the file's pictures as image blocks, announced by their markers. `read` was not used: it has no parameter to ask for pictures, so they would be sent on every read. A model whose `input` lacks `image` is told so instead of being sent data it cannot use.

### 7. Ceilings

- `MAX_POSTER_BYTES` rises to 8 MB: about thirty pictures at 1200 px, while posters stay small next to the 25 MB upload ceiling.
- pi-outpost's preview opens `.poster.html` files up to that ceiling, the way it opens structured-exchange documents up to theirs.
- The editor's save through `write_file` and the Open WebUI embed's save endpoint must accept a poster at the ceiling.

## Risks / Trade-offs

- [A model rewriting a poster may drop a marker by mistake, and its picture with it] → The person sees the change in the editor and can undo it by reopening an earlier revision; the Claude extension and Open WebUI keep every revision. The guide and the tool descriptions say markers must be kept as they are.
- [Custom properties in GrapesJS's style manager might not work as fields] → Probe `scripts/probes/poster-shape-colours.mts` (task 1.2) checked them on 0.23.8:
  - properties named `--shape-fill`, `--shape-line` and `--shape-line-width` (types `color` and `number`) appear as fields;
  - a colour typed into Fill repaints the selected shape only, and `getCss()` keeps it under that shape's id;
  - each property's `isVisible` option, true only for a `.poster-shape`, hides the sector for any other selection (GrapesJS derives a sector's visibility from its properties).

  The fallback panel is not needed.
- [Hook-based hiding in pi-outpost depends on the SDK letting `tool_call` mutate `input` and `tool_result` replace `content`] → The types document both, and probe 1.1 showed both on the pinned SDK. An SDK upgrade that broke them would fail the 5.2 tests.
- [Electron's native drag could not be reproduced under Playwright] → The fix was checked by the user in Claude Desktop. The e2e asserts what can be observed: `mousedown` on a picture is default-prevented, and a drag moves it by the distance travelled.
- [Large pictures make saves slower through the MCP bridge and WebSocket] → They are scaled to about 250 kB each, and the ceiling bounds the total.
- [A poster at 8 MB is slow to export] → The page picture is drawn once at about 300 dpi whatever the source pictures weigh; a picture is never drawn larger than its slot.

## Migration Plan

None: posters without pictures are unchanged. A poster written before this change opens and saves as before. Rolling back leaves posters with embedded pictures readable by any browser; an older editor shows them, but its 2 MB ceiling may refuse to save the largest.
