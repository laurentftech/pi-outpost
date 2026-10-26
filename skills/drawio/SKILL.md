---
name: drawio
description: Write a draw.io diagram (.drawio) — flowchart, architecture, sequence of steps, org chart, network or data-flow map — as XML the user can open and edit in draw.io, then check it with drawio_check and show it in the reply. Use whenever the user asks for a draw.io or diagrams.net diagram, an editable diagram file, or to change an existing .drawio file. The conversation and the file viewer draw it; the user touches it up there, or edits it in draw.io desktop.
license: MIT
metadata:
  version: "1.0"
---

# draw.io diagrams

A `.drawio` file is XML. You write it with your ordinary file tools, check it with
`drawio_check` (you cannot see it rendered), and show it in your reply, where it is drawn.
The user can touch it up there — move boxes, re-attach wires, fix labels — and opens it in
draw.io desktop for anything more ("open in draw.io" in the file viewer).

## The loop

1. Plan the diagram: the shapes, the connectors between them, the groups, the reading
   direction (left to right, or top down).
2. Write the file, **uncompressed**, with the skeleton below.
3. Run `drawio_check` on it. Fix every **error** — draw.io would refuse or mis-draw them —
   and every **warning** you did not intend (overlapping shapes, a shape outside its
   container, a connector running through a box or its own ends, a connector's label on a
   box). Run it again until it reports no defect. Run it after the write has returned, not
   in the same turn: started together, the check can run before the file exists.
4. Show it in your reply, as a picture of the file — the conversation draws it there:

   ```markdown
   ![Architecture overview](./diagrams/architecture.drawio)
   ```

   The path is relative to the workspace, as for any picture. Show it again after each
   change, so the user sees the version they asked about.

## The skeleton

```xml
<mxfile host="pi-outpost">
  <diagram id="page-1" name="Overview">
    <mxGraphModel grid="1" gridSize="10" guides="1" connect="1" arrows="1" page="1" pageWidth="1169" pageHeight="827">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <!-- shapes and connectors go here, each with parent="1" (or a container's id) -->
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

- Cell `0` is the root and cell `1` the default layer: always both, always first.
- Every other cell has a **unique `id`** and a `parent`: `1`, or the id of the container it
  sits in.
- One `<diagram>` per page; give each a `name` the user will recognise.

## Shapes

```xml
<mxCell id="api" value="API gateway" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1">
  <mxGeometry x="40" y="40" width="140" height="60" as="geometry"/>
</mxCell>
```

- `vertex="1"`, and an `<mxGeometry … as="geometry">` with `x`, `y`, `width`, `height` in
  pixels. Width and height above zero.
- `value` is the label. Escape XML in it (`&amp;`, `&lt;`, `&quot;`). With `html=1` in the
  style, `&lt;br&gt;` breaks a line and `&lt;b&gt;…&lt;/b&gt;` bolds.
- Styles that render everywhere, with no stencil:

| Shape | Style |
|---|---|
| Box | `rounded=0;whiteSpace=wrap;html=1;` |
| Rounded box (step, service) | `rounded=1;whiteSpace=wrap;html=1;` |
| Start / end | `ellipse;whiteSpace=wrap;html=1;` |
| Decision | `rhombus;whiteSpace=wrap;html=1;` |
| Database | `shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=15;` |
| Document | `shape=document;whiteSpace=wrap;html=1;boundedLbl=1;` |
| Actor | `shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;` |
| Free text | `text;html=1;align=center;verticalAlign=middle;` |
| Note | `shape=note;whiteSpace=wrap;html=1;size=14;fillColor=#fff2cc;strokeColor=#d6b656;` |

- Colour by meaning, and keep to a few pairs: blue `#dae8fc`/`#6c8ebf`, green
  `#d5e8d4`/`#82b366`, orange `#ffe6cc`/`#d79b00`, red `#f8cecc`/`#b85450`, grey
  `#f5f5f5`/`#666666`.
- Only use a vendor icon style (`shape=mxgraph.aws4…`, `mxgraph.azure…`) when you know its
  exact name; an unknown one draws as an empty box. A labelled box is always right.

## Connectors

```xml
<mxCell id="api-to-db" value="reads" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=block;endFill=1;" edge="1" parent="1" source="api" target="db">
  <mxGeometry relative="1" as="geometry"/>
</mxCell>
```

- `edge="1"`, a `source` and a `target` naming existing shapes, and
  `<mxGeometry relative="1" as="geometry"/>`.
- A connector must be attached at both ends. To leave an end free, give its geometry an
  `<mxPoint x="…" y="…" as="sourcePoint"/>` (or `targetPoint`) instead.
- `value` labels the connector. Dashed: `dashed=1;`. No arrowhead: `endArrow=none;`.

## Containers and lanes

```xml
<mxCell id="backend" value="Backend" style="swimlane;startSize=30;html=1;" vertex="1" parent="1">
  <mxGeometry x="300" y="20" width="360" height="220" as="geometry"/>
</mxCell>
<mxCell id="svc" value="Orders service" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="backend">
  <mxGeometry x="20" y="50" width="140" height="60" as="geometry"/>
</mxCell>
```

A shape inside a container has `parent="<container id>"`, and its `x`/`y` are **relative
to the container's top-left corner**. Keep it inside the container: below the title bar
(`startSize`), and within its width and height.

## Layout

- Snap to the grid: positions and sizes in multiples of 10.
- Leave at least 40 px between shapes, more where a connector carries a label.
- One reading direction per page; align shapes on rows or columns.
- Shapes must not partly overlap. One shape wholly on another (a badge on a box) is fine.
- A connector must not run through a box. draw.io routes it itself: between neighbours with
  free space it goes round, but a box in the way of a straight or orthogonal route is crossed.
  Move the box, or give the connector waypoints around it. Fix `exitX/exitY` and
  `entryX/entryY` only on the sides facing each other — leaving the top of a box to enter the
  bottom of one below it runs through both — or leave them out and let draw.io choose.
- More than about 25 shapes on a page is hard to read: split it into pages.

## Changing an existing diagram

Read the file first. Keep the ids you do not change, so the user's own edits and
references survive. A page whose `<diagram>` holds an opaque block of text instead of
`<mxGraphModel>` is compressed: `drawio_check` reads it, but you cannot edit it as text.
Ask the user to save it uncompressed (in draw.io: File → Properties → uncheck
"Compressed"), or rewrite that page in full.
