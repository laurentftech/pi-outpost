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
import type { DrawioCell, DrawioPage, Geometry } from "./drawio/read.ts";
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
  /** The label along the route, -1 at the source to 1 at the target, and its offset across. */
  label?: { along: number; offset: Point };
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
  /** The longest straight run, which is what a label has to fit in. */
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
    const placed: Geometry = { ...geometry({ x: ends?.label?.along ?? 0, y: 0, width: 0, height: 0 }), relative: true, points: (ends?.waypoints ?? []).map((point) => ({ ...point })) };
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
    wires.set(Number(cell.id.slice(RELATIONSHIP.length)), {
      points: route.points,
      labelAt: labelPoint(route, { x: along, y: 0 }, cell.geometry?.offset),
      span: Math.max(0, ...route.segments),
    });
  }
  return wires;
}

/** A route as an SVG path: straight segments, as draw.io draws an unrounded connector. */
export function wirePath(points: readonly Point[]): string {
  const at = (point: Point) => `${round(point.x)} ${round(point.y)}`;
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${at(point)}`).join(" ");
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
      // Round the outside: odd ones one way, even ones the other, further out each pair
      const turn = index - room;
      const far = turn % 2 === 1;
      const along = fraction((Math.floor(turn / 2) + 1) / (Math.ceil(around / 2) + 1));
      const side: Point = horizontal(from, to) ? { x: along, y: far ? 1 : 0 } : { x: far ? 1 : 0, y: along };
      ends.set(relationship.index, { exit: side, entry: { ...side } });
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
