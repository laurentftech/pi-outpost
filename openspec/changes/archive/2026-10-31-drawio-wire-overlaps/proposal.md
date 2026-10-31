# Wires that cross boxes, and labels that sit on them

## Why
`drawio_check` warns when two labelled shapes overlap, but not about wires, which models get
wrong most often. In the 2026-10-26 live runs:
- Codestral fixed every wire's exit to the top of its source and its entry to the bottom of its
  target, with the source above: each wire runs through both of its own ellipses.
- GPT-5.6 Luna's `orthogonalEdgeStyle` wire from the BMS to the inverter runs horizontally
  through the "Moteur électrique" box, and its label "Commande sécurité" sits on the box's text.
The check reported both diagrams "valid with no defect found". The person sees wires through
boxes and has to fix them by hand.

## What Changes
`drawio_check` warns about:
- a wire that runs through a labelled shape other than its own ends;
- a wire that runs through its own source or target, which a fixed exit or entry facing away produces;
- a wire's label that sits on a labelled shape.
Each warning names the wire and the shape and says what to change: move the shape, give the wire
a waypoint, or fix its exit or entry on the side facing the other end.

A wire's route is not in the file: draw.io computes it when drawing. The check computes it the
way the viewer pi-outpost ships does, from a port of draw.io's routing (mxGraph, Apache-2.0):
straight wires and waypoints, `orthogonalEdgeStyle`, `segmentEdgeStyle`, `elbowEdgeStyle`, fixed
and floating ends, rectangle, ellipse and rhombus perimeters. A wire routed some other way is
left unchecked rather than guessed.

In touch-up, the person chooses how wires are drawn: straight, orthogonal or curved. The
choice applies to the selected wires, or to every wire of the page when none is selected, as one
undoable change, and new wires follow it. Today a new wire is always orthogonal, draw.io's
default, which looks wrong beside an agent's diagonal wires, and changing all of them means
redrawing each. Touch-up starts with the style most of the page's wires already have.

## Impact
`ui/src/util/drawioPage.ts` and `ui/src/components/DrawioBlock.tsx` / `DrawioFrame.tsx` (wire
style in touch-up), `server/src/drawioRoutes.ts` (new), `server/src/drawio.ts`, `server/src/drawioTool.ts`
(description), `skills/drawio/SKILL.md`, `README.md`, `THIRD_PARTY_NOTICES` or equivalent for the
port's attribution. `scripts/probes/drawio-routes-oracle.mts` reads the real viewer's routes.
