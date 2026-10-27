# Design

## 1. Drawn in the browser, by the viewer pi-outpost already serves
The server has no DOM; draw.io's viewer needs one to lay labels out. A headless browser or
draw.io Desktop on the server would add hundreds of megabytes to the executables and the image
for one conversion. The file viewer's parent page already hosts the viewer in an opaque frame
(`DrawioFrame`, `drawioPage`) and asks it for an SVG (`exportSvg`, with draw.io's plain-text
fallback beside each HTML label). `PosterFrame` mounts one more, off screen, per diagram it is
asked to draw. The poster editor frame stays as it is: it runs only its own bundle, fetches
nothing, and asks its parent, as it does to save.

## 2. A picture, not a drawing
A drawing in a poster is SVG without text, kept small, edited by the agent. A diagram is full of
labels and belongs to another file. It goes in as a picture: `<img src="data:image/svg+xml;base64,…">`,
kept vector so it prints sharp. Its frame keeps `data-drawio` and `data-drawio-page`, saying where
it came from. As a picture it is hidden from the agent behind a marker (`poster-picture:N`), so
the agent's reads do not carry it. The cost: a model cannot look at an SVG picture
(`see_pictures` takes PNG, JPEG, GIF and WebP).

## 3. Paths
`data-drawio` is resolved as a Markdown image reference is: relative to the poster's directory,
or from the workspace root when it starts with `/`. Listing offers paths written that way. Reading
goes through the file API, so the server's read zone applies.

## 4. Pages
A page is named by `data-drawio-page`: the page's name, or its number from 1; absent, the first
page. Only the chosen `<diagram>` is handed to the viewer, so what it draws and exports is that
page.

## 5. Filling on open
Only an empty frame is filled: a frame holding a picture is the person's or a previous fill, and
redrawing it is the option left out of this change. Filling is a touch-up like any other: the
poster becomes unsaved and the person saves it. A diagram that cannot be read or drawn leaves its
frame empty and is named in the editor's status.

## 6. Bounds
An SVG above 2 MB is refused: a poster holds at most 8 MB, and a diagram that large embeds
pictures of its own. At most 20 diagrams are listed, the search's own cap.
