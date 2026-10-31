# Design

## 1. A tool the model calls, not a hook on write
`drawio_check` is a tool with a prompt guideline, and the Gemini run shows that this is enough
for a model that never read a skill: the guideline is in the system prompt whenever the tool is
published. A hook on `write` would also catch a model that skips the check, but it would put a
report into a tool result the model did not ask for, from a tool whose contract is "wrote N
bytes", and it would need separate wiring for the SDK and RPC runtimes and for `edit`. Same shape
as `drawio_check`, same registration in every runtime.

## 2. The checks are text scans, in the shared package
`readPage` already finds the markers without an HTML parser, so that it runs on a server. The
check follows it: it scans tags and their attributes with linear patterns (no lazy match between
two tags, the CodeQL ReDoS lesson of `readPage`). It is in `@pi-outpost/posters` so the Claude
extension and Open WebUI can call it on what the model sends later; this change wires pi-outpost
only, where the model writes files.

## 3. What is an error
An error is something the person will not get as written: the page is refused (markers, format,
script, size), a picture or background is never drawn (it points at a file or the web), something
is removed by the editor (frames, objects, forms, links, event attributes), or a frame names a
diagram, a page or a picture file that cannot be put in it. A warning is something that works and
reads badly: text inside an SVG drawing (the person cannot correct it), a drawing over 50 kB (the
model reads all of it on every read), a `.poster-page` size that is not the format's (the page
prints at another size than the editor shows).

## 4. References are resolved as the editor resolves them
`data-drawio` and `data-picture-file` are paths from the poster's directory, or from the
workspace root when they start with `/`. The tool resolves them the same way, inside the read
zone, then opens a diagram to check that the named page exists, and checks a picture file's type
and size against the editor's limits (`pictureFileType`, `MAX_PICTURE_FILE_BYTES`).

## 5. Saying what to write
A model that wrote `<img src="../docs/architecture.drawio">` knows the file it wanted. The error
says the frame to write for it, with the path it used, so one edit fixes it.

## 6. Filled frames are unsaved, not touched up
The editor keeps two references: the file as saved, which decides whether Save is offered, and
the poster as opened, frames it filled included, which decides whether the host is told of
touch-ups (`onDirtyChange`, used by pi-outpost's viewer only, to ask before dropping). A frame
is taken into the poster as opened only while the person has changed nothing, so a touch-up made
while the pictures arrive is still asked about. This supersedes the "unsaved touch-up" wording of
`poster-drawio-pictures` (design 5) and `poster-project-pictures`, still to be archived; their
delta specs are reworded here so the archived specification says one thing.
