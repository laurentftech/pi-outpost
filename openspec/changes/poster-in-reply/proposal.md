# Proposal

## Why

A reply can point at a poster (`see [the rules](posters/Class rules.poster.html)`), but only as a link that
opens the file viewer — the poster cannot be *shown* in the conversation. Referencing it as a picture,
`![rules](./posters/rules.poster.html)`, is worse: the file is fetched as image bytes and renders as a
broken image. Draw.io diagrams already have the answer (`AReferencedDiagramIsDrawnInTheReply`): a reply
reference becomes a block of its own. Posters should get the same, read-only.

## What Changes

- In a chat reply, a workspace `.poster.html` referenced as a picture is shown in place: the file is read
  once through `/files/raw`, parsed as a poster page, and rendered in a **sandboxed iframe** (`sandbox=""`,
  `srcDoc`) at the paper format's size in CSS pixels, scaled to fit the reply (capped like pictures at
  `max-h-96`). No editor bundle, no save flow — a reply is a view, not an edit.
- The block renders outside any paragraph (an iframe is not valid inside `<p>`), like diagram blocks.
- A file that cannot be read or parsed offers to open it in the file viewer, naming the path — never a
  broken picture. Links to posters keep opening the full editor in the file viewer, unchanged.
- Other pictures and off-site poster URLs stay plain `<img>`s.

## Capabilities

### Modified Capabilities
- `poster-files`: a poster referenced as a picture in a reply is shown in place, read-only and sandboxed.
