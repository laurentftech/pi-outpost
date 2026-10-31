# A check for the posters the agent writes

## Why
The agent writes a `.poster.html` with its ordinary file tools and cannot see it rendered. A
model that does not read the posters skill writes a page that is no poster at all. Gemini 3.5
Flash, asked on 2026-10-26 for a slide with a draw.io diagram and an SVG figure in it, wrote a
page with none of the three markers and put both files in as `<img src="../docs/architecture.drawio">`
and `<img src="../figures/voiture.svg">`. The editor refuses that page, and it would draw neither
picture anyway: a poster fetches nothing. The model then called `poster_pictures`, which answered
"holds no picture: its frames, if any, are empty". That is true, it reads as a pass, and the model
reported the poster done.

draw.io diagrams have had `drawio_check` for this from the start, and its prompt guideline asks
for a check after every write. The same Gemini run called it without having read the drawio skill.

## What Changes
- A `poster_check` tool, the twin of `drawio_check`: it reads a `.poster.html` and reports
  errors (what the editor refuses or will not draw) and warnings (what the person will trip
  on), each saying what to write instead. It writes nothing. Its prompt guideline asks for a
  check after every write or edit of a poster, so a model gets it whether or not it read the skill.
- What it checks: the three markers and the format; pictures, stylesheet `url()`s and imports
  that point at a file or the web, with the frame to write instead for a `.drawio` file or a
  picture file; what the editor removes (scripts, frames, objects, forms, links, event
  attributes); frames naming a diagram, a diagram page or a picture file that does not exist or
  cannot be used; text inside an SVG drawing, oversized drawings, and a page size that does not
  match the format.
- The checks live in `@pi-outpost/posters` (isomorphic), the file lookups in the server tool.
- `poster_pictures` says when a file is not a poster, instead of "holds no picture".
- The posters skill asks for `poster_check` after each write.
- Frames the editor fills on opening no longer make the viewer ask "Discard unsaved changes?"
  when the person changed nothing: Save stays available to keep the pictures in the file, but
  leaving drops nothing the next opening would not fill again. Asked on 2026-10-26 after opening
  the live test's poster and closing it untouched.

## Impact
`posters/src/check.ts` (new), `server/src/posterCheckTool.ts` (new), its registration in
`server/src/piOutpostTools.ts`, `server/src/sandbox.ts` and `server/src/index.ts`,
`server/src/posterPicturesTool.ts`, `posters/src/editor.ts`, `skills/posters/SKILL.md`, `README.md`.
