/**
 * Saying what would make a draw.io diagram open wrong or read badly.
 *
 * The agent cannot see a diagram without draw.io itself, so this stands in for the look
 * it cannot take: errors are what draw.io would refuse or mis-draw, warnings are what a
 * reader would trip on. Nothing here renders; it walks the cells, and routes wires the way
 * the viewer does. Shared, so a structured-exchange figure is cleaned up by the same rules.
 */
import { anchorWire, movingEndValues, needlessBend, wireAnchorIssues, type AnchorWire } from "./anchors.ts";
import { labelBox, labelPoint, lengthInside, outlineOf, pageGeometry, routeWire, sharedArea, type Box, type Point, type WireRoute } from "./routes.ts";
import { MAX_LISTED_ISSUES, readDrawio, type DrawioCell, type DrawioIssue, type DrawioPage, type DrawioReport, type Geometry, type InflatePage } from "./read.ts";

function describe(cell: DrawioCell): string {
  const label = cell.label.length > 40 ? `${cell.label.slice(0, 39)}…` : cell.label;
  return label === "" ? `"${cell.id}"` : `"${cell.id}" (${label})`;
}

/** Strictly inside one another: sharing an edge is not overlapping. */
function overlapArea(a: Geometry, b: Geometry): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

function contains(outer: Geometry, inner: Geometry): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

/** How much of the smaller of two shapes may be covered before it counts as an overlap. */
const OVERLAP_SHARE = 0.1;

/**
 * A shape whose overlap a reader trips on: one that carries text.
 *
 * Floor plans, tables, venn diagrams and images overlap on purpose — the official
 * templates are full of it — and lines, images, groups and free text have no box to
 * collide. Two labelled boxes over one another hide each other's words.
 */
function isLabelledBox(cell: DrawioCell): boolean {
  if (cell.label === "") return false;
  const first = cell.style.split(";")[0];
  if (["line", "image", "group", "text", "edgeLabel"].includes(first)) return false;
  return !/(^|;)(shape=(line|image)|image=)/.test(cell.style);
}

/**
 * The order a page's warnings are fixed in: each step can change what the next ones are about.
 * Shapes first (a moved box reroutes its wires), then where wires meet their shapes, then the
 * routes, and labels last — a label moves with its wire. Listed in that order, so a model that
 * works down the list fixes the causes before the effects (one fixated on a label it kept
 * moving while the wire under it stayed wrong).
 */
export const FIX_ORDER = { shapes: 0, ends: 1, sharedPoints: 2, detours: 3, crossings: 4, labels: 5 } as const;
type FixStep = (typeof FIX_ORDER)[keyof typeof FIX_ORDER];
type Report = (severity: DrawioIssue["severity"], cells: string[], message: string, step?: FixStep) => void;

function checkPage(page: DrawioPage, issues: DrawioIssue[]): void {
  const first = issues.length;
  const steps = new Map<DrawioIssue, number>();
  const report: Report = (severity, cells, message, step) => {
    const issue = { severity, page: page.name, cells, message };
    issues.push(issue);
    if (step !== undefined) steps.set(issue, step);
  };
  const byId = new Map<string, DrawioCell>();

  for (const cell of page.cells) {
    if (cell.id === undefined || cell.id === "") {
      report("error", [], `a cell${cell.label ? ` labelled "${cell.label}"` : ""} has no id`);
      continue;
    }
    if (byId.has(cell.id)) report("error", [cell.id], `the id "${cell.id}" is used by more than one cell`);
    else byId.set(cell.id, cell);
  }

  // The first cell is the model's root: the only one that may have no parent
  const root = page.cells[0];
  for (const cell of page.cells) {
    if (cell.id === undefined) continue;
    if (cell.parent === undefined) {
      if (cell !== root) report("error", [cell.id], `cell ${describe(cell)} has no parent; every cell but the root belongs to a layer or a container`);
    } else if (!byId.has(cell.parent)) {
      report("error", [cell.id], `cell ${describe(cell)} belongs to "${cell.parent}", which does not exist`);
    }
  }

  const isEdgeLabel = (cell: DrawioCell) => cell.geometry?.relative === true || (cell.parent !== undefined && byId.get(cell.parent)?.edge === true);

  for (const cell of page.cells) {
    if (cell.id === undefined) continue;
    if (cell.edge) {
      for (const [end, id, point] of [["start", cell.source, cell.geometry?.sourcePoint], ["end", cell.target, cell.geometry?.targetPoint]] as const) {
        if (id !== undefined && !byId.has(id)) report("error", [cell.id], `connector ${describe(cell)} has its ${end} on "${id}", which does not exist`);
        else if (id === undefined && point !== true) report("error", [cell.id], `connector ${describe(cell)} is attached to nothing at its ${end}: give it a ${end === "start" ? "source" : "target"}, or a ${end === "start" ? "sourcePoint" : "targetPoint"}`);
      }
      if (cell.geometry === undefined) report("error", [cell.id], `connector ${describe(cell)} has no <mxGeometry relative="1" as="geometry">`);
    }
    if (cell.vertex) {
      const geometry = cell.geometry;
      if (geometry === undefined) {
        report("error", [cell.id], `shape ${describe(cell)} has no <mxGeometry as="geometry">, so it has no size or place`);
      } else if (geometry.unreadable.length > 0) {
        report("error", [cell.id], `shape ${describe(cell)} has geometry that is not numbers: ${geometry.unreadable.join(", ")}`);
      } else if (geometry.width < 0 || geometry.height < 0) {
        report("error", [cell.id], `shape ${describe(cell)} is ${geometry.width} × ${geometry.height}: a negative size cannot be drawn`);
      } else if (!isEdgeLabel(cell) && geometry.width === 0 && geometry.height === 0) {
        // One zero side is a line, and draws; both is nothing at all
        report("warning", [cell.id], `shape ${describe(cell)} is 0 × 0, so nothing of it shows`, FIX_ORDER.shapes);
      }
    }
  }

  // Layout, among shapes that have a usable box
  const shapes = page.cells.filter(
    (cell): cell is DrawioCell & { id: string; geometry: Geometry } =>
      cell.vertex && cell.id !== undefined && cell.geometry !== undefined && cell.geometry.unreadable.length === 0 && !isEdgeLabel(cell) && cell.geometry.width > 0 && cell.geometry.height > 0,
  );
  const containers = new Set(shapes.filter((shape) => shapes.some((other) => other.parent === shape.id)).map((shape) => shape.id));
  const siblings = new Map<string, typeof shapes>();
  for (const shape of shapes) {
    const parent = shape.parent ?? "";
    siblings.set(parent, [...(siblings.get(parent) ?? []), shape]);
  }
  for (const group of siblings.values()) {
    const boxes = group.filter(isLabelledBox);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i], boxes[j]];
        // Stacking one shape wholly on another is deliberate (a badge, a label on a box);
        // a partial overlap, by more than a sliver, is what a layout that went wrong produces
        const smaller = Math.min(a.geometry.width * a.geometry.height, b.geometry.width * b.geometry.height);
        if (overlapArea(a.geometry, b.geometry) > OVERLAP_SHARE * smaller && !contains(a.geometry, b.geometry) && !contains(b.geometry, a.geometry)) {
          report("warning", [a.id, b.id], `shapes ${describe(a)} and ${describe(b)} overlap`, FIX_ORDER.shapes);
        }
      }
    }
  }
  for (const shape of shapes) {
    const parent = shape.parent === undefined ? undefined : byId.get(shape.parent);
    if (parent === undefined || !parent.vertex || !containers.has(parent.id ?? "") || parent.geometry === undefined) continue;
    // A group draws nothing of its own and its rotated children overflow its box by
    // design; only a container a reader sees — a lane, a frame — has an inside
    if (parent.style.split(";")[0] === "group" || /(^|;)rotation=(?!0(;|$))/.test(parent.style)) continue;
    // A child's geometry is relative to its container's top-left corner
    const box = { ...parent.geometry, x: 0, y: 0 };
    if (!contains(box, shape.geometry)) report("warning", [shape.id, parent.id ?? ""], `shape ${describe(shape)} lies partly outside its container ${describe(parent)}`, FIX_ORDER.shapes);
  }
  checkWires(page, byId, containers, report);
  // The page's issues in fixing order; errors and unranked issues keep their place ahead
  const pageIssues = issues.splice(first);
  const rank = (issue: DrawioIssue) => (issue.severity === "error" ? -1 : (steps.get(issue) ?? -1));
  issues.push(...pageIssues.map((issue, index) => ({ issue, index })).sort((a, b) => rank(a.issue) - rank(b.issue) || a.index - b.index).map(({ issue }) => issue));
}

/** How far inside a shape a wire must run to cross it: grazing an edge or ending on the outline is not crossing. */
const CROSSING_INSET = 2;
/** How much of a label must lie on a shape to hide its words. */
const LABEL_SHARE = 0.3;

/**
 * Wires through boxes and labels on them (drawio-wire-overlaps): each wire routed as the viewer
 * routes it (routes.ts), then its segments and label tested against the labelled boxes.
 * A wire the routing does not follow is left alone.
 */
function checkWires(page: DrawioPage, byId: Map<string, DrawioCell>, containers: Set<string>, report: Report): void {
  const geometry = pageGeometry(page);
  // Boxes a reader cannot see a wire through: labelled, not containers (a wire inside a
  // lane or frame is meant to run across it)
  const obstacles = [...geometry.terminals.entries()].flatMap(([id, terminal]) => {
    const cell = byId.get(id);
    return cell !== undefined && isLabelledBox(cell) && !containers.has(id) && terminal.box.width > 0 && terminal.box.height > 0 ? [{ id, cell, box: terminal.box, outline: outlineOf(terminal.style) }] : [];
  });
  const ancestors = (id: string | undefined): Set<string> => {
    const found = new Set<string>();
    for (let at = id === undefined ? undefined : byId.get(id); at?.parent !== undefined && !found.has(at.parent); at = byId.get(at.parent)) found.add(at.parent);
    return found;
  };
  const crosses = (points: Point[], box: Box, outline: ReturnType<typeof outlineOf>) => points.some((point, index) => index > 0 && lengthInside(points[index - 1]!, point, box, outline, CROSSING_INSET) > 0);

  // For the anchor rules, after every wire's own checks: the routed wires, and those already
  // warned for running through their own ends (one message about a wire's ends, not two)
  const routed: AnchorWire[] = [];
  // Every wire's labels and route, for the checks between wires once all are known
  const placedLabels: PlacedLabel[] = [];
  const routes = new Map<string, WireRoute>();
  const ownEnds = new Map<string, Array<"exit" | "entry">>();
  // Reported once every wire is known: the facing points are handed out across the page, so
  // two wires sent to the same side are not both told to use its middle
  const throughOwn: Array<{ edge: DrawioCell & { id: string }; own: Array<{ role: string; id: string; prefix: "exit" | "entry" }>; waypoints: boolean }> = [];
  for (const edge of page.cells) {
    if (!edge.edge || edge.id === undefined) continue;
    const route = routeWire(edge, geometry);
    if (route === undefined) continue;
    routed.push(anchorWire({ ...edge, id: edge.id }, page.cells, route.points, geometry.origins.get(edge.id) ?? undefined));
    routes.set(edge.id, route);
    const ends = new Set([edge.source, edge.target].filter((id): id is string => id !== undefined));
    const around = new Set([...ancestors(edge.source), ...ancestors(edge.target), ...ancestors(edge.id)]);
    for (const obstacle of obstacles) {
      if (ends.has(obstacle.id) || around.has(obstacle.id)) continue;
      if (crosses(route.points, obstacle.box, obstacle.outline)) {
        report("warning", [edge.id, obstacle.id], `connector ${describe(edge)} runs through shape ${describe(obstacle.cell)}: move the shape off its path, give the connector a waypoint that goes around it (<Array as="points"><mxPoint x="…" y="…"/></Array> in its geometry), or fix its exit and entry on other sides (exitX/exitY, entryX/entryY)`, FIX_ORDER.crossings);
      }
    }
    // Through its own ends: a fixed exit or entry facing away from the other end. Not when the
    // two ends overlap, where no route can stay out of both
    const source = edge.source === undefined ? undefined : geometry.terminals.get(edge.source);
    const target = edge.target === undefined ? undefined : geometry.terminals.get(edge.target);
    if (source !== undefined && target !== undefined && sharedArea(source.box, target.box) === 0) {
      const through = [
        ["source", edge.source!, source, target, "exit"],
        ["target", edge.target!, target, source, "entry"],
      ] as const;
      const own = through.filter(([, id, end]) => {
        const cell = byId.get(id);
        return cell !== undefined && crosses(route.points, end.box, outlineOf(end.style));
      });
      if (own.length > 0) {
        // Waypoints take a wire wherever they lie: with them and no fixed end, moving the ends
        // changes nothing, so those ends are not sent anywhere — the waypoints are the fix
        const waypoints = (edge.geometry?.points.length ?? 0) > 0;
        const fixed = (prefix: "exit" | "entry") => new RegExp(`(?:^|;)${prefix}X=`).test(edge.style) && new RegExp(`(?:^|;)${prefix}Y=`).test(edge.style);
        ownEnds.set(edge.id, own.map(([, , , , prefix]) => prefix).filter((prefix) => !waypoints || fixed(prefix)));
        throughOwn.push({ edge: { ...edge, id: edge.id }, own: own.map(([role, id, , , prefix]) => ({ role, id, prefix })), waypoints });
      }
    }
    // Its label, and the labels attached to it as child cells
    const labels: Array<{ text: string; centre: Point; style: string; holder: string; along: { x: number; y: number }; offset?: Point }> = [];
    if (edge.label !== "" && edge.geometry !== undefined) {
      const along = edge.geometry.relative ? { x: edge.geometry.x, y: edge.geometry.y } : { x: 0, y: 0 };
      labels.push({ text: edge.label, centre: labelPoint(route, along, edge.geometry.offset), style: edge.style, holder: edge.id, along, ...(edge.geometry.offset ? { offset: edge.geometry.offset } : {}) });
    }
    for (const child of page.cells) {
      if (child.parent !== edge.id || child.label === "" || child.geometry === undefined || !child.geometry.relative || child.id === undefined) continue;
      const along = { x: child.geometry.x, y: child.geometry.y };
      labels.push({ text: child.label, centre: labelPoint(route, along, child.geometry.offset), style: child.style, holder: child.id, along, ...(child.geometry.offset ? { offset: child.geometry.offset } : {}) });
    }
    for (const label of labels) {
      const fontSize = Number(/(?:^|;)fontSize=([\d.]+)/.exec(label.style)?.[1] ?? 11) || 11;
      const box = labelBox(label.centre, label.text, fontSize);
      placedLabels.push({ wire: edge.id, holder: label.holder, text: label.text, fontSize, along: label.along, ...(label.offset ? { offset: label.offset } : {}), box, around });
      for (const obstacle of obstacles) {
        if (around.has(obstacle.id)) continue;
        if (sharedArea(box, obstacle.box) > LABEL_SHARE * box.width * box.height) {
          report("warning", [edge.id, obstacle.id], `the label "${label.text.length > 40 ? `${label.text.slice(0, 39)}…` : label.text}" of connector ${describe(edge)} sits on shape ${describe(obstacle.cell)}: move the label along the connector (its mxGeometry x, from -1 at the source to 1 at the target) or beside it (y), or move the shape`, FIX_ORDER.labels);
        }
      }
    }
  }
  const named = (id: string) => {
    const cell = byId.get(id);
    return cell === undefined ? `"${id}"` : describe(cell);
  };
  const boxes = new Map([...geometry.terminals].map(([id, terminal]) => [id, terminal.box]));
  const placed = movingEndValues(routed, boxes, ownEnds);
  for (const { edge, own, waypoints } of throughOwn) {
    const names = own.map(({ role, id }) => `its ${role} ${describe(byId.get(id)!)}`).join(" and ");
    const fixes = own.flatMap(({ prefix }) => placed.get(`${edge.id}:${prefix}`) ?? []).join(";");
    const removeWaypoints = `remove its waypoints (the <Array as="points"> in its geometry) to let draw.io route it, or move the first and last of them off those shapes`;
    const message =
      waypoints && fixes === ""
        ? `connector ${describe(edge)} runs through ${names}: its waypoints take it back across them. Fix it: ${removeWaypoints}`
        : waypoints
          ? `connector ${describe(edge)} runs through ${names}: its exit or entry is on a side facing away from the other end, and it has waypoints. Put them on the sides facing each other (${fixes}), and ${removeWaypoints}`
          : `connector ${describe(edge)} runs through ${names}: its exit or entry is on a side facing away from the other end. Put them on the sides facing each other (${fixes}), or drop exitX/exitY and entryX/entryY to let draw.io choose`;
    report("warning", [edge.id, ...own.map(({ id }) => id)], message, FIX_ORDER.ends);
  }
  const step = { "shared-point": FIX_ORDER.sharedPoints, "facing-away": FIX_ORDER.ends, detour: FIX_ORDER.detours, "needless-bend": FIX_ORDER.detours } as const;
  // A fix for a needless bend is tried on the routing before it is given
  const reroute = (wire: AnchorWire, waypoints: Point[], values: Record<string, number> = {}) => {
    const cell = byId.get(wire.id);
    const origin = geometry.origins.get(wire.id);
    if (cell?.geometry === undefined || origin === null || origin === undefined) return undefined;
    // A value of NaN drops the fixed end it names, both of its coordinates
    let style = cell.style;
    for (const [key, value] of Object.entries(values)) {
      const keys = Number.isNaN(value) ? [key, key.replace(/X$/, "Y")] : [key];
      for (const name of keys) style = style.replace(new RegExp(`(^|;)${name}=[^;]*`), "$1");
      if (!Number.isNaN(value)) style = `${style}${style.endsWith(";") ? "" : ";"}${key}=${value};`;
    }
    const moved = { ...cell, style, geometry: { ...cell.geometry, points: waypoints.map((point) => ({ x: point.x - origin.x, y: point.y - origin.y })) } };
    return routeWire(moved, geometry)?.points;
  };
  // Wires already told to move where they meet their shapes: what they share with others now
  // — a run, a label's place — moves with them, and is checked once they have moved
  const pending = new Set<string>(ownEnds.keys());
  for (const issue of wireAnchorIssues(routed, boxes, named, ownEnds, reroute)) {
    report("warning", [...issue.wires, ...issue.shapes], issue.message, step[issue.rule]);
    for (const wire of issue.wires) pending.add(wire);
  }
  checkLabelsAndRuns(placedLabels, routes, routed, obstacles, named, report, reroute, crosses, pending);
}

/** A wire's label as drawn: what it says, where along the wire, and the box it takes. */
interface PlacedLabel {
  wire: string;
  /** The cell whose mxGeometry places it: the wire itself, or its label cell. */
  holder: string;
  text: string;
  fontSize: number;
  along: { x: number; y: number };
  offset?: Point;
  box: Box;
  /** The shapes the wire belongs to or ends on, which its label may touch. */
  around: Set<string>;
}

/** Wires of different data running along one line for at least this long are one line to a reader. */
export const SHARED_RUN = 12;
/**
 * Parallel lines closer than this read as one: Luna's wires out of one box ran 3 to 5 units
 * apart and looked like a single thicker line.
 */
export const SAME_LINE = 8;
/** Positions offered along a wire for a label that must move: from the middle out. */
const LABEL_POSITIONS = [0, -0.3, 0.3, -0.6, 0.6, -0.8, 0.8];
/** Then beside the wire: draw.io's y for an edge label is its distance across the wire. */
const LABEL_BESIDE = [-14, 14, -28, 28];
/** How far a waypoint is moved off a shared line, tried in turn. */
const RUN_SHIFTS = [10, -10, 20, -20, 30, -30, 40, -40];

const shortText = (text: string) => (text.length > 40 ? `${text.slice(0, 39)}…` : text);

/**
 * Between wires (drawio-wire-anchors): labels on one another, a label on another wire, and wires
 * of different data drawn along the same line. Each fix is tried before it is given: a label is
 * placed where it covers no label, shape or other wire; a wire is moved off the line only where
 * the moved route shares it no more, crosses no shape and leaves no needless bend.
 */
function checkLabelsAndRuns(
  labels: PlacedLabel[],
  routes: Map<string, WireRoute>,
  wires: AnchorWire[],
  obstacles: Array<{ id: string; box: Box; outline: ReturnType<typeof outlineOf> }>,
  named: (id: string) => string,
  report: Report,
  reroute: (wire: AnchorWire, waypoints: Point[], values?: Record<string, number>) => Point[] | undefined,
  crosses: (points: Point[], box: Box, outline: ReturnType<typeof outlineOf>) => boolean,
  pending: ReadonlySet<string>,
): void {
  const overlaps = (a: Box, b: Box) => sharedArea(a, b) > LABEL_SHARE * Math.min(a.width * a.height, b.width * b.height);
  const onWire = (box: Box, route: WireRoute) => route.points.reduce((total, point, index) => (index === 0 ? 0 : total + lengthInside(route.points[index - 1]!, point, box, "box", 0)), 0);
  const clearAt = (label: PlacedLabel, box: Box) =>
    labels.every((other) => other === label || !overlaps(box, other.box)) &&
    obstacles.every((obstacle) => label.around.has(obstacle.id) || sharedArea(box, obstacle.box) <= LABEL_SHARE * box.width * box.height) &&
    [...routes].every(([id, route]) => id === label.wire || onWire(box, route) < 4);
  /**
   * A place for the label where it is clear of everything: along its wire first, the nearest to
   * where it is, then beside it (y, across the wire).
   */
  const freePosition = (label: PlacedLabel) => {
    const route = routes.get(label.wire);
    if (route === undefined) return undefined;
    const xs = [label.along.x, ...LABEL_POSITIONS.filter((x) => Math.abs(x - label.along.x) > 0.05).sort((a, b) => Math.abs(a - label.along.x) - Math.abs(b - label.along.x))];
    for (const y of [label.along.y, ...LABEL_BESIDE.map((beside) => label.along.y + beside)]) {
      for (const x of xs) {
        if (x === label.along.x && y === label.along.y) continue;
        if (clearAt(label, labelBox(labelPoint(route, { x, y }, label.offset), label.text, label.fontSize))) return { x, y };
      }
    }
    return undefined;
  };
  const moveLabel = (label: PlacedLabel) => {
    const at = freePosition(label);
    if (at === undefined) return "move the shapes so the connectors part, or shorten the label";
    const y = at.y === label.along.y ? "" : ` y="${at.y}"`;
    return `move it ${y === "" ? "along" : "beside"} its connector: set x="${at.x}"${y} in the mxGeometry of ${named(label.holder)}`;
  };

  // Labels on labels: the second one moves
  const moved = new Set<PlacedLabel>();
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i]!;
      const b = labels[j]!;
      if (a.wire === b.wire || moved.has(a) || moved.has(b) || pending.has(a.wire) || pending.has(b.wire) || !overlaps(a.box, b.box)) continue;
      moved.add(b);
      report("warning", [b.wire, a.wire], `the label "${shortText(b.text)}" of connector ${named(b.wire)} lies on the label "${shortText(a.text)}" of connector ${named(a.wire)}: ${moveLabel(b)}`, FIX_ORDER.labels);
    }
  }
  // A label across another wire
  for (const label of labels) {
    if (moved.has(label) || pending.has(label.wire)) continue;
    for (const [id, route] of routes) {
      if (id === label.wire || pending.has(id) || onWire(label.box, route) < 4) continue;
      moved.add(label);
      report("warning", [label.wire, id], `the label "${shortText(label.text)}" of connector ${named(label.wire)} lies across connector ${named(id)}: ${moveLabel(label)}`, FIX_ORDER.labels);
      break;
    }
  }

  // Wires of different data along one line
  const normalised = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
  const runOf = (a: Point[], b: Point[]) => {
    let total = 0;
    let from: Point | undefined;
    let to: Point | undefined;
    for (let i = 1; i < a.length; i++) {
      for (let j = 1; j < b.length; j++) {
        const [p, q, r, t] = [a[i - 1]!, a[i]!, b[j - 1]!, b[j]!];
        const vertical = Math.abs(p.x - q.x) < 0.5 && Math.abs(r.x - t.x) < 0.5 && Math.abs(p.x - r.x) < SAME_LINE;
        const horizontal = Math.abs(p.y - q.y) < 0.5 && Math.abs(r.y - t.y) < 0.5 && Math.abs(p.y - r.y) < SAME_LINE;
        if (!vertical && !horizontal) continue;
        const [lo, hi] = vertical
          ? [Math.max(Math.min(p.y, q.y), Math.min(r.y, t.y)), Math.min(Math.max(p.y, q.y), Math.max(r.y, t.y))]
          : [Math.max(Math.min(p.x, q.x), Math.min(r.x, t.x)), Math.min(Math.max(p.x, q.x), Math.max(r.x, t.x))];
        if (hi - lo <= 0) continue;
        total += hi - lo;
        if (from === undefined) {
          from = vertical ? { x: p.x, y: lo } : { x: lo, y: p.y };
          to = vertical ? { x: p.x, y: hi } : { x: hi, y: p.y };
        }
      }
    }
    return { total, from, to };
  };
  const reported = new Set<string>();
  // Routes the fixes given in this pass will make: a later fix must part from them too, or two
  // wires moved off one line land together on the next (both sent to x 900, round after round)
  const proposed = new Map<string, Point[]>();
  const routeOf = (wire: AnchorWire) => proposed.get(wire.id) ?? wire.points;
  for (let i = 0; i < wires.length; i++) {
    for (let j = i + 1; j < wires.length; j++) {
      const a = wires[i]!;
      const b = wires[j]!;
      const same = normalised(a.label) !== "" && normalised(a.label) === normalised(b.label);
      if (same || reported.has(b.id) || pending.has(a.id) || pending.has(b.id)) continue;
      const run = runOf(a.points, b.points);
      if (run.total < SHARED_RUN || run.from === undefined || run.to === undefined) continue;
      reported.add(b.id);
      const vertical = Math.abs(run.from.x - run.to.x) < 0.5;
      const middle = { x: (run.from.x + run.to.x) / 2, y: (run.from.y + run.to.y) / 2 };
      const across = (point: Point, by: number) => (vertical ? { x: point.x + by, y: point.y } : { x: point.x, y: point.y + by });
      const at = (point: Point) => `(${Math.round(point.x)}, ${Math.round(point.y)})`;
      // Either wire may move, the second first. A moved route must part from the other, leave
      // no needless bend and cross no shape — its own ends included: a waypoint that takes a
      // wire back through its source is no fix
      // A fix for one wire, tried before it is given: the moved route must leave no needless
      // bend, cross no shape — its own ends included — and run clear of every wire of other
      // data, as they are or as the fixes already given in this pass move them
      const fixFor = (wire: AnchorWire): { wire: AnchorWire; fix: string } | undefined => {
        let accepted: Point[] | undefined;
        const works = (waypoints: Point[], values?: Record<string, number>) => {
          const points = reroute(wire, waypoints, values);
          if (points === undefined || needlessBend(points, waypoints) !== undefined || obstacles.some((obstacle) => crosses(points, obstacle.box, obstacle.outline))) return false;
          const sameData = (w: AnchorWire) => normalised(w.label) !== "" && normalised(w.label) === normalised(wire.label);
          if (!wires.every((w) => w === wire || sameData(w) || runOf(routeOf(w), points).total < SHARED_RUN)) return false;
          accepted = points;
          return true;
        };
        const fix = runFix(wire, works);
        if (fix === undefined || accepted === undefined) return undefined;
        proposed.set(wire.id, accepted);
        return { wire, fix };
      };
      const runFix = (wire: AnchorWire, works: (waypoints: Point[], values?: Record<string, number>) => boolean): string | undefined => {
        for (const shift of RUN_SHIFTS) {
          // One waypoint off the line, then all of them together
          for (const waypoint of wire.waypoints) {
            const to = across(waypoint, shift);
            if (works(wire.waypoints.map((w) => (w === waypoint ? to : w)))) return `move its waypoint at ${at(waypoint)} to ${at(to)}`;
          }
          if (wire.waypoints.length > 1) {
            const moved = wire.waypoints.map((w) => across(w, shift));
            if (works(moved)) return `move its waypoints to ${moved.map(at).join(", ")}`;
          }
          if (wire.waypoints.length === 0) {
            // The corners of its own route, moved off the line together: the turn it already
            // makes, a few units over (two VLANs climbing the same vertical)
            const corners = wire.points.slice(1, -1).map((point) => across(point, shift));
            if (corners.length > 0 && works(corners)) {
              return `add waypoints at ${corners.map(at).join(", ")}: <Array as="points">${corners.map((c) => `<mxPoint x="${Math.round(c.x)}" y="${Math.round(c.y)}"/>`).join("")}</Array> in its geometry`;
            }
            const added = across(middle, shift);
            if (works([added])) return `add a waypoint at ${at(added)}: <Array as="points"><mxPoint x="${Math.round(added.x)}" y="${Math.round(added.y)}"/></Array> in its geometry`;
          }
        }
        // Then another point on the sides of its ends it already uses
        for (const prefix of ["exit", "entry"] as const) {
          const fixed = prefix === "exit" ? wire.exit : wire.entry;
          if (fixed === undefined) continue;
          const side = fixed.x === 0 || fixed.x === 1 ? { axis: "Y", along: fixed.y, keep: `${prefix}X=${fixed.x}` } : { axis: "X", along: fixed.x, keep: `${prefix}Y=${fixed.y}` };
          for (const along of [0.25, 0.75, 0.125, 0.375, 0.625, 0.875, 0.5]) {
            if (Math.abs(along - side.along) < 0.06) continue;
            if (works(wire.waypoints, { [`${prefix}${side.axis}`]: along })) return `move its ${prefix} to ${prefix}${side.axis}=${along} (keeping ${side.keep})`;
          }
        }
        return undefined;
      };
      const found = fixFor(b) ?? fixFor(a);
      const fix = found?.fix;
      const mover = found?.wire ?? b;
      const data = normalised(a.label) === "" || normalised(b.label) === "" ? "they are not labelled as the same data" : "they carry different data";
      report(
        "warning",
        [b.id, a.id],
        `connectors ${named(a.id)} and ${named(b.id)} run along the same line for ${Math.round(run.total)} units from (${Math.round(run.from.x)}, ${Math.round(run.from.y)}), and ${data}: a reader cannot tell them apart. Fix ${named(mover.id)}: ${fix ?? "give it another exit or entry point (exitX/exitY, entryX/entryY), or move a shape so their routes part"}`,
        FIX_ORDER.crossings,
      );
    }
  }
}

/** Read and check a draw.io file. Throws `DrawioReadError` when it cannot be read at all. */
export function checkDrawio(xml: string, inflatePage?: InflatePage): DrawioReport {
  return checkPages(readDrawio(xml, inflatePage));
}

/** Check pages already read, or built from something else (a structured-exchange figure). */
export function checkPages(pages: DrawioPage[]): DrawioReport {
  const issues: DrawioIssue[] = [];
  for (const page of pages) checkPage(page, issues);
  return {
    pages: pages.map((page) => ({
      name: page.name,
      shapes: page.cells.filter((cell) => cell.vertex).length,
      connectors: page.cells.filter((cell) => cell.edge).length,
    })),
    issues,
  };
}

/** The report as the agent reads it: the verdict first, then what to fix, by page. */
export function describeDrawioReport(path: string, report: DrawioReport): string {
  const shapes = report.pages.reduce((sum, page) => sum + page.shapes, 0);
  const connectors = report.pages.reduce((sum, page) => sum + page.connectors, 0);
  const errors = report.issues.filter((issue) => issue.severity === "error");
  const warnings = report.issues.filter((issue) => issue.severity === "warning");
  const summary = `${report.pages.length} page${report.pages.length === 1 ? "" : "s"} (${report.pages.map((page) => `"${page.name}"`).join(", ")}), ${shapes} shape${shapes === 1 ? "" : "s"}, ${connectors} connector${connectors === 1 ? "" : "s"}`;
  if (report.issues.length === 0) return `\`${path}\` is a valid draw.io diagram with no defect found: ${summary}.`;
  const lines = [
    errors.length > 0
      ? `\`${path}\` would not open as intended: ${errors.length} error${errors.length === 1 ? "" : "s"} and ${warnings.length} warning${warnings.length === 1 ? "" : "s"}. ${summary}.`
      : `\`${path}\` opens, but ${warnings.length} warning${warnings.length === 1 ? "" : "s"} would make it read badly. ${summary}.`,
  ];
  const listed = [...errors, ...warnings].slice(0, MAX_LISTED_ISSUES);
  for (const issue of listed) lines.push(`- ${issue.severity} [${issue.page}]: ${issue.message}`);
  if (report.issues.length > listed.length) lines.push(`- … and ${report.issues.length - listed.length} more`);
  lines.push(
    errors.length > 0
      ? "Fix the errors, then run drawio_check again."
      : warnings.length > 1
        ? "Fix the warnings in the order listed, starting with the first: shapes, then where connectors meet them, then their routes, and labels last, since a label moves with its connector. Then run drawio_check again."
        : "Do what the warning says, then run drawio_check again.",
  );
  // Connectors often share a style string word for word, and an edit whose text appears more
  // than once is refused: a model that keeps sending it loops on the same report
  if (report.issues.some((issue) => /^(the label "[^"]*" of )?connectors? /.test(issue.message))) {
    lines.push('To change a connector with edit, include its id="…" in the text you replace: several connectors often have the same style, and the text must appear only once.');
  }
  return lines.join("\n");
}
