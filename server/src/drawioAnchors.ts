/**
 * Where wires meet their shapes (drawio-wire-anchors): points shared by different data, ends
 * that leave a shape on the side away from where the wire goes, and detours. Computed from
 * routes alone, so the same rules run on the check's routes (drawio.ts) and on the vendored
 * viewer's (e2e/drawio-routes.spec.ts), and the two can be compared.
 */
import type { DrawioCell } from "./drawio.ts";
import type { Box, Point } from "./drawioRoutes.ts";

/** A routed wire, as the rules need it. */
export interface AnchorWire {
  id: string;
  /** What a reader sees on the wire: its own text and its label cells', tags stripped. */
  label: string;
  source: string | undefined;
  target: string | undefined;
  /** Fixed exit and entry (exitX/exitY, entryX/entryY), when the style declares both coordinates. */
  exit: Point | undefined;
  entry: Point | undefined;
  /** The route, from the source's outline to the target's. */
  points: Point[];
  /** Its waypoints (`<Array as="points">`), in page coordinates. */
  waypoints: Point[];
}

export interface AnchorIssue {
  rule: "shared-point" | "facing-away" | "detour" | "needless-bend";
  wires: string[];
  shapes: string[];
  message: string;
}

/** The wire as the rules see it, routed along `points` — the check's route or the viewer's. */
export function anchorWire(edge: DrawioCell & { id: string }, cells: readonly DrawioCell[], points: Point[], origin: Point = { x: 0, y: 0 }): AnchorWire {
  // Any cell under the wire is its label, placed along it or not: what it says is the wire's data
  const labels = [edge.label, ...cells.filter((cell) => cell.parent === edge.id).map((cell) => cell.label)];
  const fixed = (prefix: "exit" | "entry"): Point | undefined => {
    const read = (axis: string) => {
      const value = new RegExp(`(?:^|;)${prefix}${axis}=([^;]*)`).exec(edge.style)?.[1];
      const parsed = value === undefined ? Number.NaN : Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    };
    const x = read("X");
    const y = read("Y");
    return x === undefined || y === undefined ? undefined : { x, y };
  };
  return {
    id: edge.id,
    label: labels.filter((label) => label !== "").join(" "),
    source: edge.source,
    target: edge.target,
    exit: fixed("exit"),
    entry: fixed("entry"),
    points,
    waypoints: (edge.geometry?.points ?? []).map((point) => ({ x: origin.x + point.x, y: origin.y + point.y })),
  };
}

/**
 * A segment shorter than this is a needless bend: a hook at an end or a step of a few units in
 * the line, drawn as a pin head. The router makes none of its own between free ends; a waypoint
 * a little off its neighbours does, and so do a fixed exit and entry at different heights — the
 * same exitY and entryY on boxes of different heights. Luna's diagrams showed steps of 5 to 15.
 */
export const NEEDLESS_SEGMENT = 20;

/** Ends this close (model units, each axis) are one point. */
export const SAME_POINT = 1;
/** A route longer than this many times the facing sides' distance is a detour… */
export const DETOUR_RATIO = 2;
/** …when it is also at least this much longer. */
export const DETOUR_MIN_EXTRA = 80;
/** Positions offered along a side for wires that need their own point. */
const SPREAD = [0.25, 0.5, 0.75, 0.125, 0.375, 0.625, 0.875];
/**
 * Positions closer than this on one side are one point. Under the eighths SPREAD reaches; a
 * side with three points taken still has four to offer, rather than sending a wire to another
 * side — where a straight wire runs through its own shape and is sent straight back, which a
 * model following the advice to the letter went round on.
 */
const SAME_POSITION = 0.06;

type Side = "left" | "right" | "top" | "bottom";

/** The side of `from` that faces `to`, as exit or entry values ("X=1;Y=0.5"). */
export function facingSide(from: Box, to: Box): string {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2);
  const dy = to.y + to.height / 2 - (from.y + from.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "X=1;Y=0.5" : "X=0;Y=0.5";
  return dy >= 0 ? "X=0.5;Y=1" : "X=0.5;Y=0";
}

const facingPoint = (from: Box, to: Box): Point => {
  const [x, y] = facingSide(from, to).split(";").map((part) => Number(part.slice(2)));
  return { x: from.x + from.width * x!, y: from.y + from.height * y! };
};

const overlap = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const length = (points: Point[]) => points.reduce((sum, point, index) => (index === 0 ? 0 : sum + Math.hypot(point.x - points[index - 1]!.x, point.y - points[index - 1]!.y)), 0);

const normalised = (label: string) => label.replace(/\s+/g, " ").trim().toLowerCase();

/** The side of the box a point on its outline is on: the nearest edge, relative to the box's size. */
function sideOf(box: Box, point: Point): { side: Side; along: number } {
  const rx = box.width > 0 ? (point.x - box.x) / box.width : 0.5;
  const ry = box.height > 0 ? (point.y - box.y) / box.height : 0.5;
  const distances: Array<[Side, number, number]> = [
    ["left", Math.abs(rx), ry],
    ["right", Math.abs(1 - rx), ry],
    ["top", Math.abs(ry), rx],
    ["bottom", Math.abs(1 - ry), rx],
  ];
  const [side, , along] = distances.reduce((best, entry) => (entry[1] < best[1] ? entry : best));
  return { side, along };
}

const sideValues = (side: Side, along: number): string => {
  const at = String(along);
  if (side === "left") return `X=0;Y=${at}`;
  if (side === "right") return `X=1;Y=${at}`;
  if (side === "top") return `X=${at};Y=0`;
  return `X=${at};Y=1`;
};

/** A fixed point on a side, not a corner: the side it is on, or undefined. */
function fixedSide(point: Point): Side | undefined {
  const inside = (value: number) => value > 0 && value < 1;
  if (point.x === 0 && inside(point.y)) return "left";
  if (point.x === 1 && inside(point.y)) return "right";
  if (point.y === 0 && inside(point.x)) return "top";
  if (point.y === 1 && inside(point.x)) return "bottom";
  return undefined;
}

/** Whether `other` lies wholly beyond the side of `box` opposite `side`. */
function behind(box: Box, side: Side, other: Box): boolean {
  if (side === "right") return other.x + other.width <= box.x;
  if (side === "left") return other.x >= box.x + box.width;
  if (side === "bottom") return other.y + other.height <= box.y;
  return other.y >= box.y + box.height;
}

const OPPOSITE: Record<Side, string> = { left: "left side", right: "right side", top: "top", bottom: "bottom" };

/** A wire's end on its shape, as drawn. */
type End = { wire: AnchorWire; shape: string; point: Point; role: "exit" | "entry" };

const endKey = (wire: string, role: End["role"]) => `${wire}:${role}`;

function endsByShape(wires: AnchorWire[], boxes: ReadonlyMap<string, Box>): Map<string, End[]> {
  const ends = new Map<string, End[]>();
  for (const wire of wires) {
    if (wire.points.length < 2) continue;
    const add = (shape: string | undefined, point: Point, role: End["role"]) => {
      if (shape === undefined || !boxes.has(shape)) return;
      const list = ends.get(shape) ?? [];
      list.push({ wire, shape, point, role });
      ends.set(shape, list);
    };
    add(wire.source, wire.points[0]!, "exit");
    add(wire.target, wire.points[wire.points.length - 1]!, "entry");
  }
  return ends;
}

/** The ends fixed on a side facing away from the wire's other end (corners left alone). */
function endsFacingAway(wires: AnchorWire[], boxes: ReadonlyMap<string, Box>): Array<{ wire: AnchorWire; role: End["role"]; side: Side }> {
  const found: Array<{ wire: AnchorWire; role: End["role"]; side: Side }> = [];
  for (const wire of wires) {
    if (wire.points.length < 2) continue;
    const source = wire.source === undefined ? undefined : boxes.get(wire.source);
    const target = wire.target === undefined ? undefined : boxes.get(wire.target);
    if (source === undefined || target === undefined) continue;
    for (const [role, fixed, box, other] of [
      ["exit", wire.exit, source, target],
      ["entry", wire.entry, target, source],
    ] as const) {
      const side = fixed === undefined ? undefined : fixedSide(fixed);
      if (side !== undefined && behind(box, side, other)) found.push({ wire, role, side });
    }
  }
  return found;
}

/**
 * Where the ends that must move go: each onto the side of its shape facing the wire's other
 * end, on a point of its own there — not one another's, and not one a staying end holds. Two
 * wires told separately to "use the facing side" would otherwise both be sent to its middle,
 * sharing a point again. `moving` lists the ends by "wire:role"; the answer gives their
 * values ("X=1;Y=0.25"), the same for every message that names them.
 */
export function placeMovingEnds(wires: AnchorWire[], boxes: ReadonlyMap<string, Box>, moving: ReadonlySet<string>): Map<string, string> {
  const placements = new Map<string, string>();
  const ends = endsByShape(wires, boxes);
  for (const [shape, list] of ends) {
    const box = boxes.get(shape)!;
    // Moving ends, by the side they move to
    const bySide = new Map<Side, End[]>();
    for (const end of list) {
      if (!moving.has(endKey(end.wire.id, end.role))) continue;
      const otherId = end.role === "exit" ? end.wire.target : end.wire.source;
      const other = otherId === undefined ? undefined : boxes.get(otherId);
      if (other === undefined) continue;
      const side = sideOf(box, facingPoint(box, other)).side;
      bySide.set(side, [...(bySide.get(side) ?? []), end]);
    }
    for (const [side, movers] of bySide) {
      const taken = list
        .filter((end) => !moving.has(endKey(end.wire.id, end.role)))
        .map((end) => sideOf(box, end.point))
        .filter((at) => at.side === side)
        .map((at) => at.along);
      const order = movers.length === 1 ? [0.5, ...SPREAD.filter((at) => at !== 0.5)] : movers.length === 2 ? [0.25, 0.75, ...SPREAD.filter((at) => at !== 0.25 && at !== 0.75)] : SPREAD;
      const free = order.filter((position) => taken.every((at) => Math.abs(at - position) > SAME_POSITION));
      movers.forEach((end, index) => {
        const position = free[index];
        if (position !== undefined) placements.set(endKey(end.wire.id, end.role), sideValues(side, position));
        else placements.set(endKey(end.wire.id, end.role), elsewhereOn(box, list, placements, side) ?? sideValues(side, order[index % order.length]!));
      });
    }
  }
  return placements;
}

/** Positions along `side` the ends of one shape hold or are sent to. */
function usedPositions(box: Box, list: End[], placements: ReadonlyMap<string, string>, side: Side, moving?: ReadonlySet<string>): number[] {
  return list.flatMap((end) => {
    const key = endKey(end.wire.id, end.role);
    const placed = placements.get(key);
    if (placed !== undefined) {
      const [x, y] = placed.split(";").map((part) => Number(part.slice(2)));
      const at = sideOf(box, { x: box.x + box.width * x!, y: box.y + box.height * y! });
      return at.side === side ? [at.along] : [];
    }
    if (moving?.has(key)) return [];
    const at = sideOf(box, end.point);
    return at.side === side ? [at.along] : [];
  });
}

/**
 * A free point on another side of a shape whose side `full` has none left: wrapping round to
 * a position already used there would give the advice a shared point to fix all over again.
 */
function elsewhereOn(box: Box, list: End[], placements: ReadonlyMap<string, string>, full: Side): string | undefined {
  for (const side of (["right", "bottom", "left", "top"] as Side[]).filter((candidate) => candidate !== full)) {
    const used = usedPositions(box, list, placements, side);
    const position = SPREAD.find((at) => used.every((other) => Math.abs(other - at) > SAME_POSITION));
    if (position !== undefined) return sideValues(side, position);
  }
  return undefined;
}

/** The ends that must move — through their own shape, or facing away — and where each goes. */
function movingEnds(wires: AnchorWire[], boxes: ReadonlyMap<string, Box>, ownEnds: ReadonlyMap<string, ReadonlyArray<End["role"]>>) {
  const away = endsFacingAway(wires, boxes).filter((end) => !ownEnds.has(end.wire.id));
  const moving = new Set([
    ...[...ownEnds].flatMap(([wire, roles]) => roles.map((role) => endKey(wire, role))),
    ...away.map((end) => endKey(end.wire.id, end.role)),
  ]);
  return { away, moving, placements: placeMovingEnds(wires, boxes, moving) };
}

/**
 * The values each moving end is sent to (exit/entry prefixed, "exitX=1;exitY=0.25"), by
 * "wire:role": what the own-ends message in drawio.ts gives, so it agrees with these rules.
 */
export function movingEndValues(wires: AnchorWire[], boxes: ReadonlyMap<string, Box>, ownEnds: ReadonlyMap<string, ReadonlyArray<End["role"]>>): Map<string, string> {
  const values = new Map<string, string>();
  for (const [key, placed] of movingEnds(wires, boxes, ownEnds).placements) {
    const role = key.slice(key.lastIndexOf(":") + 1);
    values.set(key, placed.split(";").map((part) => `${role}${part}`).join(";"));
  }
  return values;
}

const roundedAt = (point: Point) => `(${Math.round(point.x)}, ${Math.round(point.y)})`;

/**
 * The first needless bend of a route: a segment shorter than NEEDLESS_SEGMENT, or one going back
 * over the one before it — with the waypoint fix that would fold it away, when a waypoint is to
 * blame: the one at an end of the short segment, or level with one (the router made the jog to
 * reach it), lined up with the other end; or the one at the turn, removed.
 */
export function needlessBend(points: Point[], waypoints: Point[]): { where: Point; why: string; vertical: boolean; waypoint?: Point; waypoints: Point[]; fix: string } | undefined {
  const near = (a: Point, b: Point) => Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;
  for (let index = 0; index + 1 < points.length; index++) {
    const from = points[index]!;
    const to = points[index + 1]!;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    // Under half a unit nothing shows: it is rounding, not a step
    if (length >= 0.5 && length < NEEDLESS_SEGMENT) {
      const vertical = Math.abs(to.x - from.x) < Math.abs(to.y - from.y);
      const level = (point: Point) => waypoints.find((waypoint) => (vertical ? Math.abs(waypoint.y - point.y) <= 1 : Math.abs(waypoint.x - point.x) <= 1));
      const waypoint = waypoints.find((w) => near(w, to)) ?? waypoints.find((w) => near(w, from)) ?? level(to) ?? level(from);
      const why = `a ${Math.max(1, Math.round(length))}-unit segment`;
      if (waypoint === undefined) return { where: from, why, vertical, waypoints, fix: "" };
      const other = near(waypoint, to) || (vertical ? Math.abs(waypoint.y - to.y) <= 1 : Math.abs(waypoint.x - to.x) <= 1) ? from : to;
      const moved = vertical ? { x: waypoint.x, y: other.y } : { x: other.x, y: waypoint.y };
      return { where: from, why, vertical, waypoint, waypoints: waypoints.map((w) => (w === waypoint ? moved : w)), fix: `move its waypoint at ${roundedAt(waypoint)} to ${roundedAt(moved)}` };
    }
    const next = points[index + 2];
    if (next === undefined) continue;
    const a = { x: to.x - from.x, y: to.y - from.y };
    const b = { x: next.x - to.x, y: next.y - to.y };
    if (Math.abs(a.x * b.y - a.y * b.x) < 0.5 && a.x * b.x + a.y * b.y < 0) {
      const waypoint = waypoints.find((w) => near(w, to));
      const why = "a segment that goes back over the one before it";
      if (waypoint === undefined) return { where: to, why, vertical: a.x === 0, waypoints, fix: "" };
      return { where: to, why, vertical: a.x === 0, waypoint, waypoints: waypoints.filter((w) => w !== waypoint), fix: `remove its waypoint at ${roundedAt(waypoint)}` };
    }
  }
  return undefined;
}

/**
 * The three rules over the routed wires of one page. `describe` names a cell for the message.
 * `ownEnds` maps the wires already warned for running through their own ends to those ends:
 * they get that one message, not a second about the same sides, and they count as moving.
 */
export function wireAnchorIssues(
  wires: AnchorWire[],
  boxes: ReadonlyMap<string, Box>,
  describe: (id: string) => string = (id) => `"${id}"`,
  ownEnds: ReadonlyMap<string, ReadonlyArray<End["role"]>> = new Map(),
  /** The wire's route with these waypoints (and style values) instead, as the viewer draws it; to try a fix before giving it. */
  reroute?: (wire: AnchorWire, waypoints: Point[], style?: Record<string, number>) => Point[] | undefined,
): AnchorIssue[] {
  const issues: AnchorIssue[] = [];
  const { away, moving, placements } = movingEnds(wires, boxes, ownEnds);
  const value = (wire: string, role: End["role"]) => placements.get(endKey(wire, role))!.split(";").map((part) => `${role}${part}`).join(";");

  // Points handed out on other sides in this pass, by "shape:side", so two groups are not sent to one
  const handedOut = new Map<string, number[]>();
  // Shared points, among the ends that stay where they are: the moving ones are already
  // being sent to points of their own
  for (const [shape, list] of endsByShape(wires, boxes)) {
    const box = boxes.get(shape)!;
    const staying = list.filter((end) => !moving.has(endKey(end.wire.id, end.role)));
    const groups: End[][] = [];
    for (const end of staying) {
      const group = groups.find((members) => Math.abs(members[0]!.point.x - end.point.x) <= SAME_POINT && Math.abs(members[0]!.point.y - end.point.y) <= SAME_POINT);
      if (group) group.push(end);
      else groups.push([end]);
    }
    for (const group of groups) {
      if (new Set(group.map((end) => end.wire.id)).size < 2) continue;
      const labels = new Set(group.map((end) => normalised(end.wire.label)));
      if (labels.size === 1 && !labels.has("")) continue;
      const { side, along } = sideOf(box, group[0]!.point);
      // Positions on that side no staying end holds and no moving end is sent to
      const taken = [
        ...staying.map((end) => sideOf(box, end.point)).filter((other) => other.side === side).map((other) => other.along),
        ...list.flatMap((end) => {
          const placed = placements.get(endKey(end.wire.id, end.role));
          if (placed === undefined) return [];
          const [x, y] = placed.split(";").map((part) => Number(part.slice(2)));
          const at = sideOf(box, { x: box.x + box.width * x!, y: box.y + box.height * y! });
          return at.side === side ? [at.along] : [];
        }),
      ];
      // Points already handed to another group on this side are taken too
      taken.push(...(handedOut.get(`${shape}:${side}`) ?? []));
      const free = SPREAD.filter((position) => taken.every((at) => Math.abs(at - position) > SAME_POSITION) && Math.abs(along - position) > SAME_POSITION);
      const movers = group.slice(1);
      handedOut.set(`${shape}:${side}`, [...(handedOut.get(`${shape}:${side}`) ?? []), ...free.slice(0, movers.length)]);
      const names = group.map((end) => describe(end.wire.id));
      const what = labels.has("") ? "they are not labelled as the same data" : "they carry different data";
      // The free points go to the first wires that must move; the rest go to another side
      const placed = movers.slice(0, free.length).map((end, index) => `${sideValues(side, free[index]!).split(";").map((part) => `${end.role}${part}`).join(";")} for ${describe(end.wire.id)}`);
      // The rest get a free point on another side: the one facing the wire's other end first.
      // Values, not just "another side": a check that names no value leaves a model nothing
      // to apply, and it was seen going round on exactly that.
      const usedOn = (other: Side) => [
        ...list.map((end) => sideOf(box, end.point)).filter((at) => at.side === other).map((at) => at.along),
        // Only this shape's ends: a placement is a fraction of its own shape's box
        ...list.flatMap((end) => (placements.has(endKey(end.wire.id, end.role)) ? usedPositions(box, [end], placements, other) : [])),
        ...(handedOut.get(`${shape}:${other}`) ?? []),
      ];
      const elsewhere = movers.slice(free.length).map((end) => {
        const otherId = end.role === "exit" ? end.wire.target : end.wire.source;
        const otherBox = otherId === undefined ? undefined : boxes.get(otherId);
        const facing = otherBox === undefined ? undefined : sideOf(box, facingPoint(box, otherBox)).side;
        const sides = [...new Set([facing, "right", "bottom", "left", "top"] as Array<Side | undefined>)].filter((candidate): candidate is Side => candidate !== undefined && candidate !== side);
        for (const candidate of sides) {
          const position = SPREAD.find((at) => usedOn(candidate).every((used) => Math.abs(used - at) > SAME_POSITION));
          if (position === undefined) continue;
          handedOut.set(`${shape}:${candidate}`, [...(handedOut.get(`${shape}:${candidate}`) ?? []), position]);
          return `${sideValues(candidate, position).split(";").map((part) => `${end.role}${part}`).join(";")} for ${describe(end.wire.id)}, on its ${OPPOSITE[candidate]}`;
        }
        return `${describe(end.wire.id)}: no side of this shape has a free point left, so make the shape larger`;
      });
      const fix =
        placed.length === 0
          ? `that ${OPPOSITE[side]} has no free point left, so move them to other sides: ${elsewhere.join(", ")}`
          : `give each its own point on its ${OPPOSITE[side]}: ${placed.join(", ")}${elsewhere.length > 0 ? `, and, since that side has no free point left, ${elsewhere.join(", ")}` : ""}`;
      issues.push({
        rule: "shared-point",
        wires: [...new Set(group.map((end) => end.wire.id))],
        shapes: [shape],
        message: `connectors ${names.join(", ")} meet shape ${describe(shape)} at the same point, and ${what}: ${fix}. Only wires with the same label may share a point`,
      });
    }
  }

  const facingAway = new Set<string>();
  for (const { wire, role, side } of away) {
    facingAway.add(wire.id);
    const shape = role === "exit" ? wire.source! : wire.target!;
    const otherId = role === "exit" ? wire.target! : wire.source!;
    issues.push({
      rule: "facing-away",
      wires: [wire.id],
      shapes: [shape],
      message: `connector ${describe(wire.id)} ${role === "exit" ? "leaves" : "enters"} shape ${describe(shape)} on its ${OPPOSITE[side]}, facing away from ${describe(otherId)}: fix it on the side facing it (${value(wire.id, role)}), or drop ${role}X/${role}Y to let draw.io choose`,
    });
  }

  for (const wire of wires) {
    // One message about a wire's ends: a facing-away or own-ends wire already has it
    if (wire.points.length < 2 || facingAway.has(wire.id) || ownEnds.has(wire.id)) continue;
    const source = wire.source === undefined ? undefined : boxes.get(wire.source);
    const target = wire.target === undefined ? undefined : boxes.get(wire.target);
    if (source === undefined || target === undefined || overlap(source, target)) continue;
    const from = facingPoint(source, target);
    const to = facingPoint(target, source);
    const direct = Math.hypot(to.x - from.x, to.y - from.y);
    const route = length(wire.points);
    if (route <= DETOUR_RATIO * direct || route - direct < DETOUR_MIN_EXTRA) continue;
    const exit = facingSide(source, target).split(";").map((part) => `exit${part}`).join(";");
    const entry = facingSide(target, source).split(";").map((part) => `entry${part}`).join(";");
    issues.push({
      rule: "detour",
      wires: [wire.id],
      shapes: [wire.source!, wire.target!],
      message: `connector ${describe(wire.id)} runs ${Math.round(route)} units to join shapes ${describe(wire.source!)} and ${describe(wire.target!)}, whose facing sides are ${Math.round(direct)} apart: fix its exit and entry on those sides (${exit};${entry}), or give it a waypoint on the short way (<Array as="points"><mxPoint x="…" y="…"/></Array> in its geometry)`,
    });
  }
  // Needless bends: waypoints that leave a hook, a jog, or a segment going back over the last.
  // The fix names the waypoint and where it goes: removing all of them would lose the detour
  // they make around a shape, and a model told to would be told next to put one back. With
  // `reroute`, each fix is tried first and only one that clears the bend is given.
  for (const wire of wires) {
    // Free ends and no waypoint: the route is draw.io's own to make
    if (wire.waypoints.length === 0 && wire.exit === undefined && wire.entry === undefined) continue;
    // Ends already told to move: the bends they make go with them, one message per wire
    if (facingAway.has(wire.id) || ownEnds.has(wire.id)) continue;
    const found = needlessBend(wire.points, wire.waypoints);
    if (found === undefined) continue;
    const works = (waypoints: Point[], style?: Record<string, number>) => {
      if (reroute === undefined) return true;
      const points = reroute(wire, waypoints, style);
      return points !== undefined && needlessBend(points, waypoints) === undefined;
    };
    const removeAll = `remove its waypoints (the <Array as="points"> in its geometry) to let draw.io route it`;
    let fix: string | undefined;
    if (found.waypoint !== undefined && works(found.waypoints)) fix = found.fix;
    else if (works([])) fix = removeAll;
    if (fix === undefined) {
      const source = wire.source === undefined ? undefined : boxes.get(wire.source);
      const target = wire.target === undefined ? undefined : boxes.get(wire.target);
      if (source === undefined || target === undefined) continue;
      // Fixed ends at different heights (or offsets) make the jog: put one level with the other
      const start = wire.points[0]!;
      const end = wire.points[wire.points.length - 1]!;
      const level = (box: Box, point: Point) => (found.vertical ? (point.y - box.y) / box.height : (point.x - box.x) / box.width);
      // Exact enough to land on the other end: two decimals left a one-unit step behind
      const fraction = (value: number) => Math.round(value * 10_000) / 10_000;
      const entry = wire.entry === undefined ? undefined : fraction(level(target, start));
      const exit = wire.exit === undefined ? undefined : fraction(level(source, end));
      const axis = found.vertical ? "Y" : "X";
      if (entry !== undefined && entry > 0 && entry < 1 && works(wire.waypoints, { [`entry${axis}`]: entry })) {
        fix = `put its entry level with its exit: entry${axis}=${entry}`;
      } else if (exit !== undefined && exit > 0 && exit < 1 && works(wire.waypoints, { [`exit${axis}`]: exit })) {
        fix = `put its exit level with its entry: exit${axis}=${exit}`;
      } else if ((wire.exit !== undefined || wire.entry !== undefined) && works(wire.waypoints, { ...(wire.exit ? { exitX: Number.NaN } : {}), ...(wire.entry ? { entryX: Number.NaN } : {}) })) {
        fix = "drop exitX/exitY and entryX/entryY to let draw.io choose where it leaves and enters";
      }
    }
    if (fix === undefined) {
      // No waypoint and no fixed end makes it: the two shapes it joins are out of line by the jog
      const source = boxes.get(wire.source!)!;
      const target = boxes.get(wire.target!)!;
      const dy = Math.round(source.y + source.height / 2 - (target.y + target.height / 2));
      const dx = Math.round(source.x + source.width / 2 - (target.x + target.width / 2));
      const axis = found.vertical ? { name: "y", by: dy } : { name: "x", by: dx };
      if (axis.by === 0) continue;
      fix = `line up the shapes it joins, whose middles are ${Math.abs(axis.by)} units apart: move ${describe(wire.target!)} by ${axis.by > 0 ? "+" : ""}${axis.by} on ${axis.name}`;
    }
    issues.push({
      rule: "needless-bend",
      wires: [wire.id],
      shapes: [],
      message: `connector ${describe(wire.id)} has a needless bend near ${roundedAt(found.where)}: ${found.why}. Fix it: ${fix}`,
    });
  }
  return issues;
}
