/**
 * A graph's relationships, routed the way draw.io routes an orthogonal connector
 * (structured-exchange-arrangement, design 1).
 *
 * The placed graph is written as the cells a draw.io page would hold — a vertex per element, an
 * `orthogonalEdgeStyle` connector per relationship — and routed by the port of draw.io's routing
 * that drawio_check uses and the e2e checks against the vendored viewer. So the routes a figure
 * draws are the viewer's by construction, the wire rules apply to them without an adapter, and a
 * figure opened in touch-up is the same cells written out.
 *
 * Nothing here measures or renders: boxes come in placed, routes go out as points.
 */
import { followAdvice } from "./drawio/followAdvice.ts";
import { readDrawio, type DrawioCell, type DrawioPage, type Geometry } from "./drawio/read.ts";
import { writeDrawio } from "./drawio/write.ts";
import { NEEDLESS_SEGMENT } from "./drawio/anchors.ts";
import { labelPoint, lengthInside, pageGeometry, routeWire, type Point } from "./drawio/routes.ts";

/** A placed box, in figure units. */
export interface WiredBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where a relationship meets its boxes and bends, when something has decided it. */
export interface WireEnds {
  /** Fixed exit on the source, as fractions of its box (draw.io's exitX/exitY). */
  exit?: Point;
  /** Fixed entry on the target (entryX/entryY). */
  entry?: Point;
  /** Waypoints, in figure units. */
  waypoints?: Point[];
  /**
   * The label: along the route (-1 at the source to 1 at the target), its distance across it
   * (draw.io's geometry y), and a free offset.
   */
  label?: { along: number; across?: number; offset: Point };
}

export interface WiredRelationship {
  /** The relationship's place in the list it came from; becomes its cell id. */
  index: number;
  from: string;
  to: string;
  label: string;
  ends?: WireEnds;
}

/** A relationship as drawn: its route and where its label goes. */
export interface Wire {
  points: Point[];
  labelAt: Point;
  /**
   * The room the label has across its run: the run's length when the run is horizontal, since
   * the label is written along it, or the run's length set against a line of text when it is
   * vertical, since the label is written across it.
   */
  span: number;
}

const ELEMENT = "n:";
const RELATIONSHIP = "r:";
export const elementCellId = (id: string) => `${ELEMENT}${id}`;
export const relationshipCellId = (index: number) => `${RELATIONSHIP}${index}`;

const geometry = (box: WiredBox): Geometry => ({ ...box, relative: false, unreadable: [], sourcePoint: false, targetPoint: false, points: [] });

/** The connector style for a relationship's ends, in draw.io's terms. */
export function wireStyle(ends: WireEnds | undefined): string {
  const fixed = (prefix: "exit" | "entry", at: Point | undefined) => (at === undefined ? "" : `${prefix}X=${at.x};${prefix}Y=${at.y};`);
  return `edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=block;${fixed("exit", ends?.exit)}${fixed("entry", ends?.entry)}`;
}

/** The draw.io page of a placed graph: its elements as vertices, its relationships as connectors. */
export function graphPage(boxes: ReadonlyMap<string, WiredBox>, relationships: readonly WiredRelationship[], labels: ReadonlyMap<string, string> = new Map()): DrawioPage {
  const cells: DrawioCell[] = [
    { id: "0", parent: undefined, vertex: false, edge: false, source: undefined, target: undefined, label: "", style: "", geometry: undefined },
    { id: "1", parent: "0", vertex: false, edge: false, source: undefined, target: undefined, label: "", style: "", geometry: undefined },
  ];
  for (const [id, box] of boxes) {
    cells.push({ id: elementCellId(id), parent: "1", vertex: true, edge: false, source: undefined, target: undefined, label: labels.get(id) ?? id, style: "rounded=0;whiteSpace=wrap;html=1;", geometry: geometry(box) });
  }
  for (const relationship of relationships) {
    if (!boxes.has(relationship.from) || !boxes.has(relationship.to)) continue;
    const ends = relationship.ends;
    const placed: Geometry = { ...geometry({ x: ends?.label?.along ?? 0, y: ends?.label?.across ?? 0, width: 0, height: 0 }), relative: true, points: (ends?.waypoints ?? []).map((point) => ({ ...point })) };
    if (ends?.label !== undefined && (ends.label.offset.x !== 0 || ends.label.offset.y !== 0)) placed.offset = { ...ends.label.offset };
    cells.push({
      id: relationshipCellId(relationship.index),
      parent: "1",
      vertex: false,
      edge: true,
      source: elementCellId(relationship.from),
      target: elementCellId(relationship.to),
      label: relationship.label,
      style: wireStyle(ends),
      geometry: placed,
    });
  }
  return { name: "Figure", cells };
}

/**
 * Every relationship between two distinct placed elements, routed. A loop is left out — the
 * port does not follow draw.io's loop style, and the figure draws loops itself.
 */
export function routeGraph(page: DrawioPage): Map<number, Wire> {
  const placed = pageGeometry(page);
  const wires = new Map<number, Wire>();
  for (const cell of page.cells) {
    if (!cell.edge || cell.id === undefined || !cell.id.startsWith(RELATIONSHIP) || cell.source === cell.target) continue;
    const route = routeWire(cell, placed);
    if (route === undefined) continue;
    const along = cell.geometry?.x ?? 0;
    const labelAt = labelPoint(route, { x: along, y: cell.geometry?.y ?? 0 }, cell.geometry?.offset);
    wires.set(Number(cell.id.slice(RELATIONSHIP.length)), { points: route.points, labelAt, span: roomAt(route.points, labelAt) });
  }
  return wires;
}

/** Coordinates closer than this are one: fixed ends as four-decimal fractions land a few thousandths apart. */
const ALIGNED = 0.5;

/**
 * A route as an SVG path: straight segments, as draw.io draws an unrounded connector. A
 * coordinate within `ALIGNED` of the one before it is drawn equal to it, so a run meant to be
 * horizontal or vertical is drawn so, not a few thousandths aslant.
 */
export function wirePath(points: readonly Point[]): string {
  const drawn: Point[] = [];
  for (const point of points) {
    const before = drawn[drawn.length - 1];
    drawn.push(before === undefined ? { x: round(point.x), y: round(point.y) } : {
      x: Math.abs(point.x - before.x) < ALIGNED ? before.x : round(point.x),
      y: Math.abs(point.y - before.y) < ALIGNED ? before.y : round(point.y),
    });
  }
  return drawn.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

const round = (value: number) => Math.round(value * 100) / 100;

/** Closer than this, two wires on one side read as one (drawio_check's SAME_LINE is 8). */
const WIRE_GAP = 10;

/**
 * Fixed ends for relationships that share a pair of elements, either way round: draw.io would
 * route them on the same pixels, so each gets its own point. As many as the shorter facing side
 * has room for are spread along the sides the two boxes face each other by; the rest go round,
 * over the top and under the bottom (or round the sides), alternately. A relationship alone
 * between its pair is left to draw.io.
 */
export function spreadParallelEnds(boxes: ReadonlyMap<string, WiredBox>, relationships: readonly WiredRelationship[]): Map<number, WireEnds> {
  const groups = new Map<string, WiredRelationship[]>();
  for (const relationship of relationships) {
    if (relationship.from === relationship.to) continue;
    const pair = JSON.stringify([relationship.from, relationship.to].sort());
    groups.set(pair, [...(groups.get(pair) ?? []), relationship]);
  }
  const ends = new Map<number, WireEnds>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const first = boxes.get(group[0]!.from);
    const second = boxes.get(group[0]!.to);
    if (first === undefined || second === undefined) continue;
    const across = horizontal(first, second) ? Math.min(first.height, second.height) : Math.min(first.width, second.width);
    const room = Math.max(1, Math.min(group.length, Math.floor(across / WIRE_GAP) - 1));
    const around = group.length - room;
    group.forEach((relationship, index) => {
      const from = boxes.get(relationship.from);
      const to = boxes.get(relationship.to);
      if (from === undefined || to === undefined) return;
      if (index < room) {
        const along = fraction((index + 1) / (room + 1));
        ends.set(relationship.index, { exit: sidePoint(from, to, along), entry: sidePoint(to, from, along) });
        return;
      }
      // Round the outside: odd ones one way, even ones the other, further out each pair, with
      // waypoints far enough out that the turn is not a hook
      const turn = index - room;
      const far = turn % 2 === 1;
      const ring = Math.floor(turn / 2) + 1;
      const along = fraction(ring / (Math.ceil(around / 2) + 1));
      const sideBySide = horizontal(from, to);
      const side: Point = sideBySide ? { x: along, y: far ? 1 : 0 } : { x: far ? 1 : 0, y: along };
      const out = NEEDLESS_SEGMENT * ring;
      const waypoints = sideBySide
        ? [from, to].map((box) => ({ x: Math.round(box.x + box.width * along), y: far ? Math.max(from.y + from.height, to.y + to.height) + out : Math.min(from.y, to.y) - out }))
        : [from, to].map((box) => ({ x: far ? Math.max(from.x + from.width, to.x + to.width) + out : Math.min(from.x, to.x) - out, y: Math.round(box.y + box.height * along) }));
      ends.set(relationship.index, { exit: side, entry: { ...side }, waypoints });
    });
  }
  return ends;
}

const fraction = (value: number) => Math.round(value * 10_000) / 10_000;

/** Whether two boxes face each other left and right rather than above and below. */
function horizontal(a: WiredBox, b: WiredBox): boolean {
  return Math.abs(b.x + b.width / 2 - (a.x + a.width / 2)) >= Math.abs(b.y + b.height / 2 - (a.y + a.height / 2));
}

/** The point `along` the side of `box` facing `other`, as fractions of `box`. */
function sidePoint(box: WiredBox, other: WiredBox, along: number): Point {
  const dx = other.x + other.width / 2 - (box.x + box.width / 2);
  const dy = other.y + other.height / 2 - (box.y + box.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return { x: dx >= 0 ? 1 : 0, y: along };
  return { x: along, y: dy >= 0 ? 1 : 0 };
}

/** Whether a route runs through a box other than its own ends. */
export function crossesABox(points: readonly Point[], boxes: ReadonlyMap<string, WiredBox>, ends: readonly string[]): boolean {
  for (const [id, box] of boxes) {
    if (ends.includes(id)) continue;
    for (let index = 1; index < points.length; index++) {
      if (lengthInside(points[index - 1]!, points[index]!, box, "box", 2) > 0) return true;
    }
  }
  return false;
}

/**
 * Waypoints for the relationships draw.io would route through another box: the layout
 * engine's own route, which goes around what it spans. draw.io's orthogonal routing does not
 * avoid shapes, and the layered layout puts long relationships' bends in the gaps it keeps
 * free for them. A relationship whose straight route is clear is left with none.
 */
export function detourWaypoints(
  boxes: ReadonlyMap<string, WiredBox>,
  relationships: readonly WiredRelationship[],
  layoutRoutes: ReadonlyMap<number, readonly Point[]>,
): Map<number, Point[]> {
  const direct = routeGraph(graphPage(boxes, relationships));
  const out = new Map<number, Point[]>();
  for (const relationship of relationships) {
    const wire = direct.get(relationship.index);
    const route = layoutRoutes.get(relationship.index);
    if (wire === undefined || route === undefined || route.length < 3) continue;
    if (!crossesABox(wire.points, boxes, [relationship.from, relationship.to])) continue;
    const waypoints = route.slice(1, -1).map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) }));
    out.set(relationship.index, waypoints);
  }
  return out;
}

/** Rounds of advice a cleanup follows at most; the advice converges well within it on every corpus. */
export const CLEANUP_ROUNDS = 12;

/**
 * The page with drawio_check's wire advice followed for the relationships in `movable`
 * (structured-exchange-arrangement, design 4 step 5): their ends, bends and labels are moved as
 * the rules say, until no rule applies to them or the advice runs out. Boxes never move, and a
 * relationship outside `movable` — one a person arranged — is never changed: if it is defective,
 * the check says so.
 */
export function cleanUpWires(page: DrawioPage, movable: ReadonlySet<number>): DrawioPage {
  if (movable.size === 0) return page;
  const allowed = new Set([...movable].map(relationshipCellId));
  const followed = followAdvice(writeDrawio(page), CLEANUP_ROUNDS, undefined, { only: (cell) => allowed.has(cell), moveShapes: false });
  const [cleaned] = readDrawio(followed.xml);
  return cleaned === undefined ? page : { ...cleaned, name: page.name };
}

/** A line of label text, and the room a vertical run must leave above and below it. */
const TEXT_LINE = 14;

/** The room a label at `at` has on the run it sits on (see `Wire.span`). */
function roomAt(points: readonly Point[], at: Point): number {
  for (let index = 1; index < points.length; index++) {
    const p = points[index - 1]!;
    const q = points[index]!;
    const onX = Math.min(p.x, q.x) - 1 <= at.x && at.x <= Math.max(p.x, q.x) + 1;
    const onY = Math.min(p.y, q.y) - 1 <= at.y && at.y <= Math.max(p.y, q.y) + 1;
    if (!onX || !onY) continue;
    if (Math.abs(p.y - q.y) < ALIGNED) return Math.abs(q.x - p.x);
    // Across a vertical run any width fits, as long as the run is taller than a line of text
    return Math.abs(q.y - p.y) >= TEXT_LINE * 2 ? Number.POSITIVE_INFINITY : 0;
  }
  return 0;
}

/**
 * Fixed ends for relationships draw.io would route with a jog of a few units: boxes facing each
 * other with their sides overlapping, but their centres not lined up. Both ends go to the middle
 * of the overlap, so the line runs straight. Relationships with ends or bends of their own are
 * left alone.
 */
export function straightenJogs(boxes: ReadonlyMap<string, WiredBox>, relationships: readonly WiredRelationship[]): Map<number, WireEnds> {
  const free = relationships.filter((relationship) => relationship.ends === undefined && relationship.from !== relationship.to);
  const routed = routeGraph(graphPage(boxes, free));
  const out = new Map<number, WireEnds>();
  for (const relationship of free) {
    const wire = routed.get(relationship.index);
    const from = boxes.get(relationship.from);
    const to = boxes.get(relationship.to);
    if (wire === undefined || from === undefined || to === undefined) continue;
    const jog = wire.points.some((point, index) => index > 0 && Math.hypot(point.x - wire.points[index - 1]!.x, point.y - wire.points[index - 1]!.y) < NEEDLESS_SEGMENT);
    if (!jog) continue;
    const sideBySide = horizontal(from, to);
    // The stretch both facing sides share, across the direction the wire runs
    const low = sideBySide ? Math.max(from.y, to.y) : Math.max(from.x, to.x);
    const high = sideBySide ? Math.min(from.y + from.height, to.y + to.height) : Math.min(from.x + from.width, to.x + to.width);
    if (high - low < 2) continue;
    const middle = Math.round((low + high) / 2);
    const across = (box: WiredBox) => fraction(sideBySide ? (middle - box.y) / box.height : (middle - box.x) / box.width);
    const towards = (box: WiredBox, other: WiredBox): Point => {
      const forwards = sideBySide ? other.x > box.x : other.y > box.y;
      return sideBySide ? { x: forwards ? 1 : 0, y: across(box) } : { x: across(box), y: forwards ? 1 : 0 };
    };
    out.set(relationship.index, { exit: towards(from, to), entry: towards(to, from) });
  }
  return out;
}

type Side = "top" | "bottom" | "left" | "right";

/** The side of `box` a wire to `other` leaves by: along the ranks when they are in different ranks, else facing. */
function rankSide(box: WiredBox, other: WiredBox, portrait: boolean): Side {
  const below = other.y >= box.y + box.height;
  const above = other.y + other.height <= box.y;
  const after = other.x >= box.x + box.width;
  const before = other.x + other.width <= box.x;
  if (portrait) {
    if (below) return "bottom";
    if (above) return "top";
    return other.x + other.width / 2 >= box.x + box.width / 2 ? "right" : "left";
  }
  if (after) return "right";
  if (before) return "left";
  return other.y + other.height / 2 >= box.y + box.height / 2 ? "bottom" : "top";
}

const sidePointAt = (side: Side, along: number): Point =>
  side === "top" ? { x: along, y: 0 } : side === "bottom" ? { x: along, y: 1 } : side === "left" ? { x: 0, y: along } : { x: 1, y: along };

/**
 * Ends for every relationship that has none of its own, the way a layered drawing places them
 * (structured-exchange-arrangement, design 4): each leaves and enters by the sides facing along
 * the ranks, so runs fall in the gaps between ranks rather than along a rank's row; the ends on
 * one side are spread along it in the order of where their other ends are, so wires leaving a
 * side do not cross each other on the way out. A wire alone on both its sides, between sides
 * that overlap, runs straight down the middle of the overlap instead. Loops are left alone.
 */
export function rankEnds(boxes: ReadonlyMap<string, WiredBox>, relationships: readonly WiredRelationship[], portrait: boolean): Map<number, WireEnds> {
  type End = { relationship: WiredRelationship; role: "exit" | "entry"; side: Side; other: WiredBox };
  const bySide = new Map<string, End[]>();
  const free = relationships.filter((relationship) => relationship.ends === undefined && relationship.from !== relationship.to);
  for (const relationship of free) {
    const from = boxes.get(relationship.from);
    const to = boxes.get(relationship.to);
    if (from === undefined || to === undefined) continue;
    for (const [role, box, other, id] of [["exit", from, to, relationship.from], ["entry", to, from, relationship.to]] as const) {
      const side = rankSide(box, other, portrait);
      const key = `${id}\u0000${side}`;
      bySide.set(key, [...(bySide.get(key) ?? []), { relationship, role, side, other }]);
    }
  }
  const placed = new Map<string, Point>();
  const alone = new Set<string>();
  for (const ends of bySide.values()) {
    const across = (end: End) => (end.side === "top" || end.side === "bottom" ? end.other.x + end.other.width / 2 : end.other.y + end.other.height / 2);
    // In the order of the other ends, ties in document order; a relationship's two ends on one side kept apart
    const ordered = [...ends].sort((a, b) => across(a) - across(b) || a.relationship.index - b.relationship.index || (a.role === "exit" ? -1 : 1));
    ordered.forEach((end, index) => placed.set(`${end.relationship.index}:${end.role}`, sidePointAt(end.side, fraction((index + 1) / (ordered.length + 1)))));
    if (ordered.length === 1) alone.add(`${ordered[0]!.relationship.index}:${ordered[0]!.role}`);
  }
  const out = new Map<number, WireEnds>();
  for (const relationship of free) {
    const exit = placed.get(`${relationship.index}:exit`);
    const entry = placed.get(`${relationship.index}:entry`);
    if (exit === undefined || entry === undefined) continue;
    const from = boxes.get(relationship.from)!;
    const to = boxes.get(relationship.to)!;
    if (alone.has(`${relationship.index}:exit`) && alone.has(`${relationship.index}:entry`)) {
      const straight = straightBetween(from, to, exit, entry);
      if (straight !== undefined) {
        out.set(relationship.index, straight);
        continue;
      }
    }
    out.set(relationship.index, { exit, entry });
  }
  return out;
}

/** Ends that draw a straight line between two facing sides that overlap, at the middle of the overlap. */
function straightBetween(from: WiredBox, to: WiredBox, exit: Point, entry: Point): WireEnds | undefined {
  const vertical = (exit.y === 0 || exit.y === 1) && (entry.y === 0 || entry.y === 1) && exit.y !== entry.y;
  const sideways = (exit.x === 0 || exit.x === 1) && (entry.x === 0 || entry.x === 1) && exit.x !== entry.x;
  if (!vertical && !sideways) return undefined;
  const low = vertical ? Math.max(from.x, to.x) : Math.max(from.y, to.y);
  const high = vertical ? Math.min(from.x + from.width, to.x + to.width) : Math.min(from.y + from.height, to.y + to.height);
  if (high - low < 2) return undefined;
  const middle = Math.round((low + high) / 2);
  const at = (box: WiredBox) => fraction(vertical ? (middle - box.x) / box.width : (middle - box.y) / box.height);
  return vertical ? { exit: { x: at(from), y: exit.y }, entry: { x: at(to), y: entry.y } } : { exit: { x: exit.x, y: at(from) }, entry: { x: entry.x, y: at(to) } };
}

/**
 * The page with each label in `which` placed at the middle of its relationship's longest run,
 * where it has the most room: the middle of the whole route often falls on a short step, where
 * the figure has no room to write it. A label the arrangement places is not in `which`.
 */
export function labelsOnLongestRuns(page: DrawioPage, which: ReadonlySet<number>): DrawioPage {
  const routes = routeGraph(page);
  return {
    ...page,
    cells: page.cells.map((cell) => {
      if (!cell.edge || cell.id === undefined || !cell.id.startsWith(RELATIONSHIP) || cell.geometry === undefined) return cell;
      const index = Number(cell.id.slice(RELATIONSHIP.length));
      const wire = routes.get(index);
      if (!which.has(index) || wire === undefined || wire.points.length < 3) return cell;
      const lengths = wire.points.slice(1).map((point, at) => Math.hypot(point.x - wire.points[at]!.x, point.y - wire.points[at]!.y));
      const total = lengths.reduce((sum, length) => sum + length, 0);
      if (total === 0) return cell;
      const longest = lengths.indexOf(Math.max(...lengths));
      const middle = lengths.slice(0, longest).reduce((sum, length) => sum + length, 0) + lengths[longest]! / 2;
      // labelPoint puts a label at (x / 2 + 0.5) of the route's length
      return { ...cell, geometry: { ...cell.geometry, x: fraction((middle / total - 0.5) * 2) } };
    }),
  };
}
