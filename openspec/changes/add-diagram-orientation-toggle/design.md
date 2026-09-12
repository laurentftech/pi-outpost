## Context

See proposal.md — Why. What shapes the approach is that the two surfaces are not alike:

- The **graph rendering** is ours end to end. `layoutGraph` (`shared/src/structuredExchangeModel.ts`)
  runs dagre with `rankdir: "LR"` hard-coded; `graphFigure`
  (`shared/src/structuredExchangeFigure.ts`) turns the layout into a figure; both are in `shared`
  because `AFigureCanBeProducedWithoutABrowser` requires the same picture from a process with no
  display. Edge routing (`edgePath` → `anchorPoint`) already picks the border point facing the other
  box, so a top-to-bottom flow needs no geometry work. Self-loops are drawn out of the top by hand
  and read the same either way.
- A **Mermaid diagram** is a source string the model wrote, rendered by a library we do not lay out.
  Its direction lives in that source (`flowchart TD`, `graph LR`, `direction` in `stateDiagram-v2`),
  and the only way to change it is to rewrite the source before handing it to mermaid. We also cannot
  know a Mermaid diagram's size without rendering it: `Mermaid.tsx` already reads the drawn `viewBox`
  for `naturalWidth`.

So one rule, applied at two different moments: before layout for the graph, after a first render for
Mermaid.

## Goals / Non-Goals

**Goals:**

- One legibility predicate, written once, used by every surface and by the headless figure path.
- An automatic choice reproducible outside a browser, so the exported and the agent-written figure
  are oriented like the one on screen.
- Mermaid re-orientation that never edits what the author wrote — only what is handed to the renderer.

**Non-Goals:**

- Rotating a sequence or a table. Neither has an orientation to choose.
- Changing `toMermaid`'s derived export. It stays `flowchart TD`: `DerivedDiagramExport` requires it
  to derive from the validated data alone, and it is a textual equivalent of the structure, not a
  picture of it.
- Persisting the reader's choice, or sending it anywhere. It is an adjustment, like a nudge.
- Any schema, validator, protocol or tool-parameter change.

## Decisions

### The predicate: keep landscape while it costs nothing, turn only when turning wins

`orientationFor(widthLandscape, widthPortrait)` returns landscape when the landscape layout fits a
fixed `READING_WIDTH`, and portrait only when the portrait layout is narrower than the landscape one
by a clear margin. Nothing else enters it.

Rationale: the rendering is width-constrained and scrolls vertically, so the on-screen scale is
`min(1, column / extentWidth)` — width alone decides how small the boxes get. While landscape fits,
scale is 1 and turning gains nothing but surprise. Once it overflows, turning is only worth the
surprise if it actually buys width back.

Alternatives considered. *Pick whichever layout is narrower*: turns almost everything portrait,
including a three-box chain that was perfectly readable, because a chain is always narrower stacked.
*Target an aspect ratio*: needs a target nobody can justify, and behaves oddly for one very tall or
very flat graph. *Count the nodes*: a threshold on a number that does not measure the problem — ten
boxes with one-word labels are fine landscape, five with long ones are not.

### `READING_WIDTH` is a constant, not the window

The predicate takes a fixed reference width rather than the actual container. This is the decision the
rest depends on: `AFigureCanBeProducedWithoutABrowser` and `TheAgentCanWriteAFigureToAPath` produce
figures where no window exists, and a viewport-dependent rule would orient those differently from the
reader's screen — so the figure an agent references from a report would not be the figure the reader
approved. It also keeps the choice deterministic: the same document draws the same way on a laptop
and a wide monitor.

The cost is honest and worth stating: on a very wide screen a diagram may be turned that would have
fitted. The reader's switch is the answer to that, and it is one click.

The value is to be measured against the real reading column in the bench, not guessed.

### Orientation flows as data, not as a flag read from somewhere

`layoutGraph(data, size, orientation)` and `GraphFigureOptions.orientation`, defaulted so that every
existing caller keeps today's behaviour until it passes one. The view owns the reader's choice in
`StructuredExchangeDocument` beside `nudges` and `hidden` (`StructuredExchangeView.tsx`, ~1318), which
is what lets the inline and the enlarged rendering agree — they are two component instances, and the
adjustments they share are the ones held by the parent.

### Turning clears the nudges

A nudge is an offset measured against a layout that no longer exists once the graph is turned; carried
across, it moves a box away from where the reader put it, in a diagram they did not arrange. Clearing
them is the only honest option, and it matches the existing reset control.

### Mermaid: render, measure, re-render — and only for the wide ones

First render uses the source exactly as authored. Read the drawn `viewBox`; if the width fails the
predicate, rewrite the direction token and render once more, keeping the second result only if it is
actually narrower. One extra render, and only for a diagram that was unreadable anyway.

The rewrite touches the header direction only — `flowchart`/`graph` headers, and the top-level
`direction` statement of `stateDiagram-v2` (inserted when absent). A `direction` inside a `subgraph`
is local to that subgraph and is left alone. The mapping preserves the axis: `LR`↔`TB`, `RL`↔`BT`,
`TD` treated as `TB`.

Alternative considered: asking mermaid to re-lay out without touching the source. It has no such API —
direction is part of the diagram definition.

### What the reader is shown and given stays the authored source

`Mermaid.tsx` offers the source through `⌗ code` and `CopyButton`. Both keep the authored string,
including its original direction, and the block says it was turned. The alternative — showing the
rewritten source — would mean this application quietly presenting words the agent never wrote as
though it had.

## Risks / Trade-offs

- **A diagram is turned that the reader's wide screen would have fitted.** → The manual switch, one
  click, and the constant is calibrated against the real reading column rather than picked.
- **Mermaid's second render costs time on exactly the biggest diagrams.** → It runs only when the
  first render failed the predicate, after the existing 300 ms debounce, and its result replaces the
  first rather than blocking it: the reader sees the wide one, then the turned one.
- **The direction rewrite meets a source shape we did not anticipate** (an unusual header, a notation
  that grows a direction later). → Rewrite only what is recognised; anything unrecognised is rendered
  as authored with no control offered, which is today's behaviour.
- **Turning discards a reader's arrangement.** → Stated in the spec as a scenario rather than left as
  a surprise; the control is a deliberate act, not something that happens under them.
- **A graph that is unreadable both ways** (a wide fan-out that is also deep). → Out of scope here.
  Enlarging and panning already exist for it; the predicate simply leaves it landscape.
