# draw.io diagrams: see them, and let the agent produce them

## Why

draw.io is the diagram format many teams already keep their architecture, flows and
network maps in, and the one they edit by hand. The agent can describe a diagram, or draw
one as a structured-exchange figure, but a `.drawio` file in the workspace shows as raw XML
and nothing helps the agent write one that opens cleanly. Editing belongs to the draw.io
desktop application the user already has; seeing and producing belong here, offline, with
no executable.

## What Changes

- A `.drawio` file opens rendered in the file viewer, by jgraph's own viewer
  (`viewer-static.min.js`, Apache 2.0), with every page reachable, zoom, and the usual
  rendered / split / source modes; the split mode draws the draft as it is typed. The
  viewer runs in a sandboxed frame whose policy allows no connection but the viewer script
  itself, served by pi-outpost: no diagram, font or stencil request ever leaves.
- The viewer ships in the web bundle (and so in the npm package and the executables), and
  is fetched only when a diagram is opened. It is not inlined into the embed package: the
  widget loads it from the server it is connected to.
- "Open in draw.io" in the viewer, for a `.drawio` file: the existing open-with-the-
  associated-application, so editing happens in the desktop application; the rendering
  follows the file when it is saved there.
- `drawio_check`: an agent tool, in pure TypeScript, that reads a `.drawio` file (plain or
  compressed pages) and reports what would make it open wrong — unreadable XML, duplicate
  ids, cells whose parent or connector ends do not exist, connectors attached to nothing,
  bad geometry — and what would make it read badly: shapes overlapping, children outside
  their container.
- A `drawio` skill: how to write draw.io XML the agent can check with `drawio_check`.

## Impact

- `web/public/vendor/drawio/`: the viewer, its licence and its version, with
  `scripts/update-drawio-viewer.mjs` to move it.
- `ui`: `DrawioFrame`, the viewer's `.drawio` branch, the open button.
- `server`: `drawio.ts` (reading and checking), `drawioTool.ts`; registered with the
  other document tools.
- `skills/drawio/`.
