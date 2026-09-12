## Why

A diagram with many boxes is laid out left-to-right and arrives in the reading column as a sliver:
`layoutGraph` fixes `rankdir: "LR"` and offers no control, so a wide graph shrinks its boxes below
reading size and the only remedy is enlarging and scrolling sideways — which is looking at a diagram,
not reading it. Mermaid diagrams sit in the same transcript and have the same problem from the other
direction: their orientation is whatever the model happened to write in the source, and a model that
wrote `flowchart LR` for a twenty-node graph has produced something nobody can read.

Turning a wide graph a quarter turn is usually all it takes. Nothing in the application can do it
today, on either surface.

## What Changes

- A reader can switch any orientable diagram between landscape and portrait, on both the
  structured-exchange graph rendering and Mermaid diagrams in the transcript and the file viewer.
- When no reader has chosen, the orientation is chosen for them: landscape stays the default, and
  portrait is selected when the landscape layout is too wide for its boxes to stay legible.
- The automatic choice overrides a direction the Mermaid source states explicitly. A diagram that
  honours its own directive and cannot be read is still unreadable, and the directive comes from the
  model rather than from the reader. The reader's manual switch wins over both.
- The automatic choice is a pure function of the diagram, measured against a fixed reference width —
  never of the window — so the same document is oriented the same way on every screen, and a figure
  produced without a browser is oriented like the one on screen.
- Orientation is offered only where it means something: the graph rendering, and Mermaid
  `flowchart` / `graph` / `stateDiagram` sources. A sequence has vertical lifelines and horizontal
  messages, a table has neither; `sequenceDiagram`, `pie`, `gantt` and `classDiagram` have no
  direction to choose. On those, no control appears.
- Like repositioning a box, switching orientation is presentation only: it does not alter the
  document, is never carried back to any authority, and is not persisted.

## Capabilities

### New Capabilities

- `diagram-orientation`: how an orientable diagram is oriented — the automatic choice and its
  legibility rule, the reader's override, which diagrams are orientable, and the guarantee that
  orientation changes nothing but the picture. Covers both the native graph rendering and Mermaid,
  because the rule is one rule and the two surfaces sit side by side in one transcript.

### Modified Capabilities

- `structured-exchange`: `ReaderMayAdjustAndNarrowTheView` names the adjustments a reader may make
  for legibility. Orientation is now one of them, and the requirement's presentation-only guarantee
  must demonstrably cover it.

## Impact

- `shared/src/structuredExchangeModel.ts` — `layoutGraph` takes the orientation instead of fixing
  `rankdir: "LR"`. Edge routing (`edgePath`, `anchorPoint`) already picks border points toward the
  other box, so it needs no change for a top-to-bottom flow.
- `shared/src/structuredExchangeFigure.ts` — `GraphFigureOptions` carries the orientation; the
  automatic rule lives here, beside the layout it measures, so every producer of a figure reaches the
  same answer.
- `ui/src/presentations/StructuredExchangeView.tsx` — the control, beside `⤢ enlarge`; the chosen
  orientation flows into `graphFigure` and therefore into the SVG the reader downloads.
- `ui/src/components/Mermaid.tsx` — a rendered diagram is measured from its `viewBox` (the component
  already reads it for `naturalWidth`), and re-rendered with the direction swapped when the measure
  says the drawn one is unreadable.
- No change to the schema, the validator, the protocol, or the agent's tools. Nothing a producer
  writes is affected, and no stored document changes shape.
- `toMermaid` keeps emitting `flowchart TD`: it is a textual equivalent of the structure, not of the
  rendering, and `DerivedDiagramExport` requires it to derive from the data alone.
