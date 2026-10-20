# Design

## The official viewer, not a renderer of our own

The mxGraph format is a full styling language — hundreds of shapes, stencils for every
cloud vendor, edge styles, HTML labels. A renderer of our own would draw a subset and draw
it differently from the desktop application the user then opens the file in. jgraph's
`viewer-static.min.js` is the same drawing code as the editor, with the stencils included
(4.5 MB, version pinned). It is vendored rather than installed: no npm package publishes it.

## A sandboxed frame, loaded once

The viewer defines globals by the dozen (`Graph`, `Editor`, `urlParams`, `mxUtils`…) and
uses `eval`. In the application's window they would collide with whatever else lives
there — in a widget, with the host page. So it runs in an `iframe` with
`sandbox="allow-scripts"` (an opaque origin: no access to the app, its storage or its
token) and a meta Content-Security-Policy of `default-src 'none'`, `script-src` limited to
the viewer's URL plus the frame's own bootstrap, `img-src data: blob:`. Its defaults point
at `viewer.diagrams.net` for stencils, images, a proxy and math; the policy makes any such
request fail rather than leave, whatever the diagram asks for.

The frame is created once per opened file; each new text is posted to it and drawn in
place, so the split mode does not reparse 4.5 MB of script per keystroke. A diagram the
viewer cannot read is reported back to the parent, which shows why, and the source.

## Served by the server, not inlined in the widget

The embed library build inlines assets as base64, which would add some 12 MB to
`@pi-outpost/embed`. The file lives in `web/public` instead: in the web bundle every
installation already serves, unauthenticated like the rest of the interface. The widget
knows its server's URL.

## Checking without drawing

The agent cannot see a rendering without an executable. `drawio_check` stands in: it
reads the file with the office package's XML scanner (which refuses a DOCTYPE, so entity
expansion is unreachable), inflates compressed pages (`deflateRaw` of the URI-encoded
XML), and walks the cells. Errors are what draw.io would refuse or mis-draw; warnings are
what a reader would trip on. It reads inside the sandbox's read zone, like every document
tool, and writes nothing.
