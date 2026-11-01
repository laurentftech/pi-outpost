# Proposal

## Why

Diagrams that agents write often hang several wires on the same point of a box, so the wires
can't be told apart. They also often leave a box on the side opposite the other end, so the wire
makes a long detour. `drawio_check` only flags the detour when it runs through a box, so the agent
never hears about the rest. Agents fix what the check reports, so the check is where to say it.

## What Changes

- `drawio_check` warns when several wires meet at the same point of a box (leaving it, entering
  it, or both) and do not carry the same label. A shared point is legitimate only for the same
  data, which means the same label. Wires without a label count as different data. The warning
  names the wires and the box, and proposes other points on the same side (0.25 / 0.5 / 0.75).
  The point compared is where the wire is actually drawn, not only a declared `exitX`/`entryX`.
- `drawio_check` warns when a wire's fixed exit or entry is on a side that faces away from the
  other end, even when the detour crosses no box. The warning gives the facing side to use, or
  says to drop the fixed point.
- `drawio_check` warns when a wire's route is much longer than the distance between the sides of
  its two ends that face each other. The warning says to use the facing sides or a waypoint.
- All three apply only to wires whose route the check computes the way the viewer does. Other
  wires stay unchecked, as they are today.
- The drawio skill's Layout section states the three rules.
- Buses (one line deliberately shared by several data flows) are out of scope.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `drawio-diagrams`: `drawio_check` warns about shared connection points, ends that face away from
  each other, and detours.

## Impact

- `server/src/drawio.ts` (`checkWires`), using the routes from `server/src/drawioRoutes.ts`.
- `skills/drawio/SKILL.md` (Layout).
- Tests: `server/test/drawioWires.test.ts`; `e2e/drawio-routes.spec.ts` with its corpus, to hold
  the new warnings to the vendored viewer's routes; the live-run fixtures in
  `server/test/fixtures/drawio/` to measure what the new rules report on real agent output.
- `poster_check` only checks that a poster's diagram opens and has the page it names; it does not
  check wires. Posters are not affected.
