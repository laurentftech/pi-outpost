/**
 * The routes draw.io draws a diagram's wires along, computed the way the viewer pi-outpost
 * ships computes them (drawio-wire-overlaps, design 1-2). A wire's route is not in the file:
 * draw.io works it out from the shapes, the wire's style and its waypoints when drawing. To
 * tell whether a wire crosses a box, the check needs that same route, not a guess at it.
 *
 * This is a port of draw.io's routing at the vendored release (v32.5.5): mxGraph's
 * mxGraphView (fixed and floating terminal points, label position), mxEdgeStyle
 * (OrthConnector, SegmentConnector) and mxPerimeter (rectangle, ellipse, rhombus), with
 * draw.io's own overrides from js/grapheditor/Graph.js (the elbow connectors, centerPerimeter,
 * legacy anchor points). Copyright (c) JGraph Ltd, under the Apache License 2.0; see
 * web/public/vendor/drawio/LICENSE. Model coordinates throughout: scale 1, translate 0.
 *
 * Only what the port follows exactly is routed. A wire whose ends or style lie outside it —
 * rotated, flipped or directed shapes, stencils, ports, loops, other edge styles, other
 * perimeters — comes back unrouted, and the check leaves it alone rather than guess.
 */
import type { DrawioCell, DrawioPage } from "./drawio.ts";

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Style = Record<string, string | number>;

/** The default stylesheet's styles that matter for routing (styles/default.xml). */
const DEFAULT_VERTEX: Style = { shape: "label", perimeter: "rectanglePerimeter" };
const DEFAULT_EDGE: Style = { shape: "connector", endArrow: "classic", rounded: 1 };
const NAMED: Record<string, Style> = {
  ellipse: { shape: "ellipse", perimeter: "ellipsePerimeter" },
  rhombus: { shape: "rhombus", perimeter: "rhombusPerimeter" },
  triangle: { shape: "triangle", perimeter: "trianglePerimeter" },
  line: { shape: "line" },
  image: { shape: "image" },
  roundImage: { shape: "image", perimeter: "ellipsePerimeter" },
  rhombusImage: { shape: "image", perimeter: "rhombusPerimeter" },
  arrow: { shape: "arrow", edgeStyle: "none" },
  swimlane: { shape: "swimlane" },
};

/** mxStylesheet.getCellStyle: named styles merged in order, `key=value` over them, `none` removing a key. */
export function cellStyle(text: string, edge: boolean): Style {
  const style: Style = text.startsWith(";") ? {} : { ...(edge ? DEFAULT_EDGE : DEFAULT_VERTEX) };
  for (const pair of text.split(";")) {
    const at = pair.indexOf("=");
    if (at >= 0) {
      const key = pair.slice(0, at);
      const value = pair.slice(at + 1);
      if (value === "none") delete style[key];
      else if (value.trim() !== "" && Number.isFinite(Number(value))) style[key] = Number.parseFloat(value);
      else style[key] = value;
    } else if (Object.hasOwn(NAMED, pair)) {
      for (const [key, value] of Object.entries(NAMED[pair]!)) {
        if (value === "none") delete style[key];
        else style[key] = value;
      }
    }
  }
  return style;
}

const number = (style: Style, key: string, fallback: number): number => {
  const value = style[key];
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
};

// mxConstants
const WEST = 1;
const NORTH = 2;
const SOUTH = 4;
const EAST = 8;
const ALL = 15;
const DEFAULT_MARKERSIZE = 6;

/** A shape the routing can end a wire on: its absolute box and style. */
export interface Terminal {
  box: Box;
  style: Style;
}

const center = (box: Box): Point => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
const round1 = (value: number) => Math.round(value * 10) / 10;
const contains = (box: Box, x: number, y: number) => x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;

/** Whether the port follows how draw.io draws to this shape's outline. */
function routable(terminal: Terminal): boolean {
  const { style } = terminal;
  if (number(style, "rotation", 0) % 360 !== 0) return false;
  if (style.direction !== undefined && style.direction !== "east") return false;
  if (number(style, "flipH", 0) === 1 || number(style, "flipV", 0) === 1) return false;
  // Stencils may keep a fixed aspect inside their box, and draw to that, not the box
  const shape = String(style.shape ?? "");
  if (shape.startsWith("mxgraph.") || shape.startsWith("stencil(")) return false;
  if (number(style, "roundedPerimeter", 0) === 1 && number(style, "rounded", 0) === 1) return false;
  const perimeter = style.perimeter;
  return perimeter === undefined || ["rectanglePerimeter", "ellipsePerimeter", "rhombusPerimeter", "centerPerimeter"].includes(String(perimeter));
}

// mxPerimeter ----------------------------------------------------------------------------

function intersection(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): Point | null {
  const denom = (y3 - y2) * (x1 - x0) - (x3 - x2) * (y1 - y0);
  const nume_a = (x3 - x2) * (y0 - y2) - (y3 - y2) * (x0 - x2);
  const nume_b = (x1 - x0) * (y0 - y2) - (y1 - y0) * (x0 - x2);
  const ua = nume_a / denom;
  const ub = nume_b / denom;
  if (ua >= 0.0 && ua <= 1.0 && ub >= 0.0 && ub <= 1.0) return { x: x0 + ua * (x1 - x0), y: y0 + ua * (y1 - y0) };
  return null;
}

function rectanglePerimeter(bounds: Box, next: Point, orthogonal: boolean): Point {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const alpha = Math.atan2(next.y - cy, next.x - cx);
  const p = { x: 0, y: 0 };
  const pi = Math.PI;
  const beta = pi / 2 - alpha;
  const t = Math.atan2(bounds.height, bounds.width);
  if (alpha < -pi + t || alpha > pi - t) {
    p.x = bounds.x;
    p.y = cy - (bounds.width * Math.tan(alpha)) / 2;
  } else if (alpha < -t) {
    p.y = bounds.y;
    p.x = cx - (bounds.height * Math.tan(beta)) / 2;
  } else if (alpha < t) {
    p.x = bounds.x + bounds.width;
    p.y = cy + (bounds.width * Math.tan(alpha)) / 2;
  } else {
    p.y = bounds.y + bounds.height;
    p.x = cx + (bounds.height * Math.tan(beta)) / 2;
  }
  if (orthogonal) {
    if (next.x >= bounds.x && next.x <= bounds.x + bounds.width) p.x = next.x;
    else if (next.y >= bounds.y && next.y <= bounds.y + bounds.height) p.y = next.y;
    if (next.x < bounds.x) p.x = bounds.x;
    else if (next.x > bounds.x + bounds.width) p.x = bounds.x + bounds.width;
    if (next.y < bounds.y) p.y = bounds.y;
    else if (next.y > bounds.y + bounds.height) p.y = bounds.y + bounds.height;
  }
  return p;
}

function ellipsePerimeter(bounds: Box, next: Point, orthogonal: boolean): Point {
  const { x, y } = bounds;
  const a = bounds.width / 2;
  const b = bounds.height / 2;
  const cx = x + a;
  const cy = y + b;
  const px = next.x;
  const py = next.y;
  // parseInt truncates toward zero
  const dx = Math.trunc(px - cx);
  const dy = Math.trunc(py - cy);
  if (dx === 0 && dy !== 0) return { x: cx, y: cy + (b * dy) / Math.abs(dy) };
  if (dx === 0 && dy === 0) return { x: px, y: py };
  if (orthogonal) {
    if (py >= y && py <= y + bounds.height) {
      const ty = py - cy;
      let tx = Math.sqrt(a * a * (1 - (ty * ty) / (b * b))) || 0;
      if (px <= x) tx = -tx;
      return { x: cx + tx, y: py };
    }
    if (px >= x && px <= x + bounds.width) {
      const tx = px - cx;
      let ty = Math.sqrt(b * b * (1 - (tx * tx) / (a * a))) || 0;
      if (py <= y) ty = -ty;
      return { x: px, y: cy + ty };
    }
  }
  const t = (a * b) / Math.sqrt(b * b * dx * dx + a * a * dy * dy);
  return { x: cx + t * dx, y: cy + t * dy };
}

function rhombusPerimeter(bounds: Box, next: Point, orthogonal: boolean): Point | null {
  const { x, y } = bounds;
  const w = bounds.width;
  const h = bounds.height;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const px = next.x;
  const py = next.y;
  if (cx === px) return cy > py ? { x: cx, y } : { x: cx, y: y + h };
  if (cy === py) return cx > px ? { x, y: cy } : { x: x + w, y: cy };
  let tx = cx;
  let ty = cy;
  if (orthogonal) {
    if (px >= x && px <= x + w) tx = px;
    else if (py >= y && py <= y + h) ty = py;
  }
  if (px < cx) {
    if (py < cy) return intersection(px, py, tx, ty, cx, y, x, cy);
    return intersection(px, py, tx, ty, cx, y + h, x, cy);
  } else if (py < cy) return intersection(px, py, tx, ty, cx, y, x + w, cy);
  return intersection(px, py, tx, ty, cx, y + h, x + w, cy);
}

/** mxGraphView.getPerimeterPoint (no flip: such shapes are not routed). */
function perimeterPoint(terminal: Terminal, next: Point, orthogonal: boolean, border: number): Point {
  const spacing = border + number(terminal.style, "perimeterSpacing", 0);
  const bounds = { x: terminal.box.x - spacing, y: terminal.box.y - spacing, width: terminal.box.width + 2 * spacing, height: terminal.box.height + 2 * spacing };
  const perimeter = terminal.style.perimeter;
  let point: Point | null = null;
  if (perimeter !== undefined && (bounds.width > 0 || bounds.height > 0)) {
    if (perimeter === "ellipsePerimeter") point = ellipsePerimeter(bounds, next, orthogonal);
    else if (perimeter === "rhombusPerimeter") point = rhombusPerimeter(bounds, next, orthogonal);
    else if (perimeter === "rectanglePerimeter") point = rectanglePerimeter(bounds, next, orthogonal);
    // centerPerimeter is no registered function: getPerimeterFunction answers null
  }
  return point ?? center(terminal.box);
}

// Edge styles ------------------------------------------------------------------------------

interface EdgeState {
  style: Style;
  /** The route so far: [fixed source point or null, fixed target point or null]. */
  absolutePoints: Array<Point | null>;
  /** The edge's parent's absolute origin, which its waypoints are relative to. */
  origin: Point;
}

/**
 * As in mxGraphView.updatePoints, `result` arrives holding the route's first point — the fixed
 * source point, or null for a floating one — and the style appends to it: several styles read
 * that first entry or test `result.length == 1` for "nothing added".
 */
type EdgeStyleFunction = (state: EdgeState, source: Terminal | null, target: Terminal | null, points: Point[] | null, result: Array<Point | null>) => void;

const transformControlPoint = (state: EdgeState, pt: Point): Point => ({ x: pt.x + state.origin.x, y: pt.y + state.origin.y });

function reversePortConstraints(constraint: number): number {
  let result = (constraint & WEST) << 3;
  result |= (constraint & NORTH) << 1;
  result |= (constraint & SOUTH) >> 1;
  result |= (constraint & EAST) >> 3;
  return result;
}

/** mxUtils.getPortConstraints, for unrotated shapes. */
function portConstraints(terminal: Terminal, edge: EdgeState, source: boolean): number {
  const value = terminal.style.portConstraint ?? edge.style[source ? "sourcePortConstraint" : "targetPortConstraint"];
  if (value === undefined) return ALL;
  const directions = String(value);
  let result = 0;
  if (directions.includes("north")) result |= NORTH;
  if (directions.includes("west")) result |= WEST;
  if (directions.includes("south")) result |= SOUTH;
  if (directions.includes("east")) result |= EAST;
  return result;
}

const ORTH_BUFFER = 10;

function jettySize(state: EdgeState, isSource: boolean): number {
  const value = state.style[isSource ? "sourceJettySize" : "targetJettySize"] ?? state.style.jettySize ?? ORTH_BUFFER;
  if (value === "auto") {
    const type = state.style[isSource ? "startArrow" : "endArrow"];
    if (type !== undefined && type !== "none") {
      const size = number(state.style, isSource ? "startSize" : "endSize", DEFAULT_MARKERSIZE);
      return Math.max(2, Math.ceil((size + ORTH_BUFFER) / ORTH_BUFFER)) * ORTH_BUFFER;
    }
    return 2 * ORTH_BUFFER;
  }
  return typeof value === "number" ? value : Number.parseFloat(String(value));
}

const SegmentConnector: EdgeStyleFunction = (state, source, target, controlHints, result) => {
  const pts = state.absolutePoints.map((p) => (p === null ? null : { x: round1(p.x), y: round1(p.y) }));
  const sourceChannel = source?.box ?? null;
  const targetChannel = target?.box ?? null;
  const tol = 1;
  const tempPoints: Point[] = [];
  const addPoint = (pt: Point) => tempPoints.push(pt);
  let lastPushed: Point | null = result.length > 0 && result[0] != null ? { x: result[0].x, y: result[0].y } : null;
  let horizontal = true;
  let hint: Point | null = null;
  const pushPoint = (pt: Point) => {
    pt.x = round1(pt.x);
    pt.y = round1(pt.y);
    if (lastPushed === null || Math.abs(lastPushed.x - pt.x) >= tol || Math.abs(lastPushed.y - pt.y) >= tol) {
      result.push({ x: pt.x, y: pt.y });
      lastPushed = pt;
    }
    return lastPushed;
  };

  let pt: Point | null = pts[0] ?? null;
  if (pt === null && source !== null) pt = center(source.box);
  else if (pt !== null) pt = { ...pt };
  const lastInx = pts.length - 1;
  let pe: Point | null | undefined;

  if (controlHints !== null && controlHints.length > 0) {
    let hints: Point[] = controlHints.map((hintPoint) => transformControlPoint(state, hintPoint));
    if (hints.length === 0) return;
    if (pt !== null && hints[0] !== undefined) {
      if (Math.abs(hints[0].x - pt.x) < tol) hints[0].x = pt.x;
      if (Math.abs(hints[0].y - pt.y) < tol) hints[0].y = pt.y;
    }
    pe = pts[lastInx];
    if (pe != null && hints[hints.length - 1] !== undefined) {
      if (Math.abs(hints[hints.length - 1]!.x - pe.x) < tol) hints[hints.length - 1]!.x = pe.x;
      if (Math.abs(hints[hints.length - 1]!.y - pe.y) < tol) hints[hints.length - 1]!.y = pe.y;
    }
    hint = hints[0]!;
    let currentTerm: Terminal | null = source;
    let currentChannel = sourceChannel;
    let currentPt = pts[0];
    let hozChan = false;
    let vertChan = false;
    let currentHint = hint;
    if (currentPt != null) currentTerm = null;
    for (let i = 0; i < 2; i++) {
      const fixedVertAlign = currentPt != null && currentPt.x === currentHint.x;
      const fixedHozAlign = currentPt != null && currentPt.y === currentHint.y;
      const inHozChan = currentTerm !== null && currentHint.y >= currentChannel!.y && currentHint.y <= currentChannel!.y + currentChannel!.height;
      const inVertChan = currentTerm !== null && currentHint.x >= currentChannel!.x && currentHint.x <= currentChannel!.x + currentChannel!.width;
      hozChan = fixedHozAlign || (currentPt == null && inHozChan);
      vertChan = fixedVertAlign || (currentPt == null && inVertChan);
      if (!(i === 0 && ((hozChan && vertChan) || (fixedVertAlign && fixedHozAlign)))) {
        if (currentPt != null && !fixedHozAlign && !fixedVertAlign && (inHozChan || inVertChan)) {
          horizontal = !inHozChan;
          break;
        }
        if (vertChan || hozChan) {
          horizontal = hozChan;
          if (i === 1) horizontal = hints.length % 2 === 0 ? hozChan : vertChan;
          break;
        }
      }
      currentTerm = target;
      currentChannel = targetChannel;
      currentPt = pts[lastInx];
      if (currentPt != null) currentTerm = null;
      currentHint = hints[hints.length - 1]!;
      if (fixedVertAlign && fixedHozAlign) hints = hints.slice(1);
    }
    if (horizontal && ((pts[0] != null && pts[0].y !== hint.y) || (pts[0] == null && source !== null && (hint.y < sourceChannel!.y || hint.y > sourceChannel!.y + sourceChannel!.height)))) {
      addPoint({ x: pt!.x, y: hint.y });
    } else if (!horizontal && ((pts[0] != null && pts[0].x !== hint.x) || (pts[0] == null && source !== null && (hint.x < sourceChannel!.x || hint.x > sourceChannel!.x + sourceChannel!.width)))) {
      addPoint({ x: hint.x, y: pt!.y });
    }
    if (horizontal) pt!.y = hint.y;
    else pt!.x = hint.x;
    for (const each of hints) {
      horizontal = !horizontal;
      hint = each;
      if (horizontal) pt!.y = hint.y;
      else pt!.x = hint.x;
      addPoint({ ...pt! });
    }
  } else {
    hint = pt;
    horizontal = true;
  }

  pt = pts[lastInx] ?? null;
  if (pt === null && target !== null) pt = center(target.box);
  if (pt !== null && hint !== null) {
    if (horizontal && ((pts[lastInx] != null && pts[lastInx]!.y !== hint.y) || (pts[lastInx] == null && target !== null && (hint.y < targetChannel!.y || hint.y > targetChannel!.y + targetChannel!.height)))) {
      addPoint({ x: pt.x, y: hint.y });
    } else if (!horizontal && ((pts[lastInx] != null && pts[lastInx]!.x !== hint.x) || (pts[lastInx] == null && target !== null && (hint.x < targetChannel!.x || hint.x > targetChannel!.x + targetChannel!.width)))) {
      addPoint({ x: hint.x, y: pt.y });
    }
  }
  // Loops are not routed, so the innerLoopWaypoints case never arises
  if (pts[0] == null && source !== null) {
    while (tempPoints.length > 0 && contains(sourceChannel!, tempPoints[0]!.x, tempPoints[0]!.y)) tempPoints.splice(0, 1);
  }
  if (pts[lastInx] == null && target !== null) {
    while (tempPoints.length > 0 && contains(targetChannel!, tempPoints[tempPoints.length - 1]!.x, tempPoints[tempPoints.length - 1]!.y)) tempPoints.splice(tempPoints.length - 1, 1);
  }
  for (const each of tempPoints) pushPoint(each);
  // `pe` is only set when there were hints, as in the original (a var hoisted out of the if)
  const final = result[result.length - 1];
  if (pe != null && final != null && Math.abs(pe.x - final.x) <= tol && Math.abs(pe.y - final.y) <= tol) {
    result.splice(result.length - 1, 1);
    const last = result[result.length - 1];
    if (last != null) {
      if (Math.abs(last.x - pe.x) < tol) last.x = pe.x;
      if (Math.abs(last.y - pe.y) < tol) last.y = pe.y;
    }
  }
};

const dirVectors = [[-1, 0], [0, -1], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 0]] as const;
const routePatterns = [
  [[513, 2308, 2081, 2562], [513, 1090, 514, 2184, 2114, 2561], [513, 1090, 514, 2564, 2184, 2562], [513, 2308, 2561, 1090, 514, 2568, 2308]],
  [[514, 1057, 513, 2308, 2081, 2562], [514, 2184, 2114, 2561], [514, 2184, 2562, 1057, 513, 2564, 2184], [514, 1057, 513, 2568, 2308, 2561]],
  [[1090, 514, 1057, 513, 2308, 2081, 2562], [2114, 2561], [1090, 2562, 1057, 513, 2564, 2184], [1090, 514, 1057, 513, 2308, 2561, 2568]],
  [[2081, 2562], [1057, 513, 1090, 514, 2184, 2114, 2561], [1057, 513, 1090, 514, 2184, 2562, 2564], [1057, 2561, 1090, 514, 2568, 2308]],
];
const SOURCE_MASK = 1024;
const TARGET_MASK = 2048;
const SIDE_MASK = 480;
const CENTER_MASK = 512;

const OrthConnector: EdgeStyleFunction = (state, sourceTerminal, targetTerminal, controlHints, result) => {
  const pts = state.absolutePoints.map((p) => (p === null ? null : { x: round1(p.x), y: round1(p.y) }));
  const source = sourceTerminal === null ? null : { ...sourceTerminal.box, x: round1(sourceTerminal.box.x), y: round1(sourceTerminal.box.y), width: round1(sourceTerminal.box.width), height: round1(sourceTerminal.box.height) };
  const target = targetTerminal === null ? null : { ...targetTerminal.box, x: round1(targetTerminal.box.x), y: round1(targetTerminal.box.y), width: round1(targetTerminal.box.width), height: round1(targetTerminal.box.height) };
  const p0 = pts[0] ?? null;
  const pe = pts[pts.length - 1] ?? null;

  const sourceX = source !== null ? source.x : p0!.x;
  const sourceY = source !== null ? source.y : p0!.y;
  const sourceWidth = source !== null ? source.width : 1;
  const sourceHeight = source !== null ? source.height : 1;
  const targetX = target !== null ? target.x : pe!.x;
  const targetY = target !== null ? target.y : pe!.y;
  const targetWidth = target !== null ? target.width : 1;
  const targetHeight = target !== null ? target.height : 1;

  const sourceBuffer = jettySize(state, true);
  const targetBuffer = jettySize(state, false);
  const totalBuffer = targetBuffer + sourceBuffer;
  let tooShort = false;
  if (p0 !== null && pe !== null) {
    const dx = pe.x - p0.x;
    const dy = pe.y - p0.y;
    tooShort = dx * dx + dy * dy < totalBuffer * totalBuffer;
  }
  if (tooShort || (controlHints !== null && controlHints.length > 0)) {
    SegmentConnector(state, sourceTerminal, targetTerminal, controlHints, result);
    return;
  }

  const portConstraint = [ALL, ALL];
  if (sourceTerminal !== null) portConstraint[0] = portConstraints(sourceTerminal, state, true);
  if (targetTerminal !== null) portConstraint[1] = portConstraints(targetTerminal, state, false);
  if (sourceWidth === 0 || sourceHeight === 0 || targetWidth === 0 || targetHeight === 0) return;

  const dir = [0, 0];
  const geo = [[sourceX, sourceY, sourceWidth, sourceHeight], [targetX, targetY, targetWidth, targetHeight]] as const;
  const buffer = [sourceBuffer, targetBuffer];
  const limits = [[0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0]];
  for (let i = 0; i < 2; i++) {
    limits[i]![1] = geo[i]![0] - buffer[i]!;
    limits[i]![2] = geo[i]![1] - buffer[i]!;
    limits[i]![4] = geo[i]![0] + geo[i]![2] + buffer[i]!;
    limits[i]![8] = geo[i]![1] + geo[i]![3] + buffer[i]!;
  }
  const sourceCenX = geo[0][0] + geo[0][2] / 2.0;
  const sourceCenY = geo[0][1] + geo[0][3] / 2.0;
  const targetCenX = geo[1][0] + geo[1][2] / 2.0;
  const targetCenY = geo[1][1] + geo[1][3] / 2.0;
  const dx = sourceCenX - targetCenX;
  const dy = sourceCenY - targetCenY;
  let quad = 0;
  if (dx < 0) quad = dy < 0 ? 2 : 1;
  else if (dy <= 0) {
    quad = 3;
    if (dx === 0) quad = 2;
  }

  let currentTerm: Point | null = sourceTerminal !== null ? p0 : null;
  const constraint = [[0.5, 0.5], [0.5, 0.5]];
  if (sourceTerminal === null) constraint[0] = [0, 0];
  if (targetTerminal === null) constraint[1] = [0, 0];
  for (let i = 0; i < 2; i++) {
    if (currentTerm !== null) {
      constraint[i]![0] = (currentTerm.x - geo[i]![0]) / geo[i]![2];
      if (Math.abs(currentTerm.x - geo[i]![0]) <= 1) dir[i] = WEST;
      else if (Math.abs(currentTerm.x - geo[i]![0] - geo[i]![2]) <= 1) dir[i] = EAST;
      constraint[i]![1] = (currentTerm.y - geo[i]![1]) / geo[i]![3];
      if (Math.abs(currentTerm.y - geo[i]![1]) <= 1) dir[i] = NORTH;
      else if (Math.abs(currentTerm.y - geo[i]![1] - geo[i]![3]) <= 1) dir[i] = SOUTH;
    }
    currentTerm = targetTerminal !== null ? pe : null;
  }

  const sourceTopDist = geo[0][1] - (geo[1][1] + geo[1][3]);
  const sourceLeftDist = geo[0][0] - (geo[1][0] + geo[1][2]);
  const sourceBottomDist = geo[1][1] - (geo[0][1] + geo[0][3]);
  const sourceRightDist = geo[1][0] - (geo[0][0] + geo[0][2]);
  const vertexSeperations: number[] = [];
  vertexSeperations[1] = Math.max(sourceLeftDist - totalBuffer, 0);
  vertexSeperations[2] = Math.max(sourceTopDist - totalBuffer, 0);
  vertexSeperations[4] = Math.max(sourceBottomDist - totalBuffer, 0);
  vertexSeperations[3] = Math.max(sourceRightDist - totalBuffer, 0);

  const dirPref: number[] = [];
  const horPref: number[] = [];
  const vertPref: number[] = [];
  horPref[0] = sourceLeftDist >= sourceRightDist ? WEST : EAST;
  vertPref[0] = sourceTopDist >= sourceBottomDist ? NORTH : SOUTH;
  horPref[1] = reversePortConstraints(horPref[0]);
  vertPref[1] = reversePortConstraints(vertPref[0]);
  const preferredHorizDist = sourceLeftDist >= sourceRightDist ? sourceLeftDist : sourceRightDist;
  const preferredVertDist = sourceTopDist >= sourceBottomDist ? sourceTopDist : sourceBottomDist;
  const prefOrdering = [[0, 0], [0, 0]];
  let preferredOrderSet = false;
  for (let i = 0; i < 2; i++) {
    if (dir[i] !== 0) continue;
    if ((horPref[i]! & portConstraint[i]!) === 0) horPref[i] = reversePortConstraints(horPref[i]!);
    if ((vertPref[i]! & portConstraint[i]!) === 0) vertPref[i] = reversePortConstraints(vertPref[i]!);
    prefOrdering[i]![0] = vertPref[i]!;
    prefOrdering[i]![1] = horPref[i]!;
  }
  if (preferredVertDist > 0 && preferredHorizDist > 0) {
    if ((horPref[0]! & portConstraint[0]!) > 0 && (vertPref[1]! & portConstraint[1]!) > 0) {
      prefOrdering[0] = [horPref[0]!, vertPref[0]!];
      prefOrdering[1] = [vertPref[1]!, horPref[1]!];
      preferredOrderSet = true;
    } else if ((vertPref[0]! & portConstraint[0]!) > 0 && (horPref[1]! & portConstraint[1]!) > 0) {
      prefOrdering[0] = [vertPref[0]!, horPref[0]!];
      prefOrdering[1] = [horPref[1]!, vertPref[1]!];
      preferredOrderSet = true;
    }
  }
  if (preferredVertDist > 0 && !preferredOrderSet) {
    prefOrdering[0] = [vertPref[0]!, horPref[0]!];
    prefOrdering[1] = [vertPref[1]!, horPref[1]!];
    preferredOrderSet = true;
  }
  if (preferredHorizDist > 0 && !preferredOrderSet) {
    prefOrdering[0] = [horPref[0]!, vertPref[0]!];
    prefOrdering[1] = [horPref[1]!, vertPref[1]!];
    preferredOrderSet = true;
  }
  for (let i = 0; i < 2; i++) {
    if (dir[i] !== 0) continue;
    if ((prefOrdering[i]![0]! & portConstraint[i]!) === 0) prefOrdering[i]![0] = prefOrdering[i]![1]!;
    dirPref[i] = prefOrdering[i]![0]! & portConstraint[i]!;
    dirPref[i]! |= (prefOrdering[i]![1]! & portConstraint[i]!) << 8;
    dirPref[i]! |= (prefOrdering[1 - i]![i]! & portConstraint[i]!) << 16;
    dirPref[i]! |= (prefOrdering[1 - i]![1 - i]! & portConstraint[i]!) << 24;
    if ((dirPref[i]! & 0xf) === 0) dirPref[i] = dirPref[i]! << 8;
    if ((dirPref[i]! & 0xf00) === 0) dirPref[i] = (dirPref[i]! & 0xf) | (dirPref[i]! >> 8);
    if ((dirPref[i]! & 0xf0000) === 0) dirPref[i] = (dirPref[i]! & 0xffff) | ((dirPref[i]! & 0xf000000) >> 8);
    dir[i] = dirPref[i]! & 0xf;
    if (portConstraint[i] === WEST || portConstraint[i] === NORTH || portConstraint[i] === EAST || portConstraint[i] === SOUTH) dir[i] = portConstraint[i]!;
  }

  let sourceIndex = dir[0] === EAST ? 3 : dir[0]!;
  let targetIndex = dir[1] === EAST ? 3 : dir[1]!;
  sourceIndex -= quad;
  targetIndex -= quad;
  if (sourceIndex < 1) sourceIndex += 4;
  if (targetIndex < 1) targetIndex += 4;
  const routePattern = routePatterns[sourceIndex - 1]![targetIndex - 1]!;

  const wayPoints1: number[][] = Array.from({ length: 12 }, () => [0, 0]);
  wayPoints1[0]![0] = geo[0][0];
  wayPoints1[0]![1] = geo[0][1];
  switch (dir[0]) {
    case WEST:
      wayPoints1[0]![0] -= sourceBuffer;
      wayPoints1[0]![1] += constraint[0]![1]! * geo[0][3];
      break;
    case SOUTH:
      wayPoints1[0]![0] += constraint[0]![0]! * geo[0][2];
      wayPoints1[0]![1] += geo[0][3] + sourceBuffer;
      break;
    case EAST:
      wayPoints1[0]![0] += geo[0][2] + sourceBuffer;
      wayPoints1[0]![1] += constraint[0]![1]! * geo[0][3];
      break;
    case NORTH:
      wayPoints1[0]![0] += constraint[0]![0]! * geo[0][2];
      wayPoints1[0]![1] -= sourceBuffer;
      break;
  }

  let currentIndex = 0;
  let lastOrientation = (dir[0]! & (EAST | WEST)) > 0 ? 0 : 1;
  const initialOrientation = lastOrientation;
  let currentOrientation = 0;
  for (const step of routePattern) {
    const nextDirection = step & 0xf;
    let directionIndex = nextDirection === EAST ? 3 : nextDirection;
    directionIndex += quad;
    if (directionIndex > 4) directionIndex -= 4;
    const direction = dirVectors[directionIndex - 1]!;
    currentOrientation = directionIndex % 2 > 0 ? 0 : 1;
    if (currentOrientation !== lastOrientation) {
      currentIndex++;
      wayPoints1[currentIndex]![0] = wayPoints1[currentIndex - 1]![0]!;
      wayPoints1[currentIndex]![1] = wayPoints1[currentIndex - 1]![1]!;
    }
    const tar = (step & TARGET_MASK) > 0;
    const sou = (step & SOURCE_MASK) > 0;
    let side = (step & SIDE_MASK) >> 5;
    side = side << quad;
    if (side > 0xf) side = side >> 4;
    const isCenter = (step & CENTER_MASK) > 0;
    if ((sou || tar) && side < 9) {
      let limit = 0;
      const souTar = sou ? 0 : 1;
      if (isCenter && currentOrientation === 0) limit = geo[souTar]![0] + constraint[souTar]![0]! * geo[souTar]![2];
      else if (isCenter) limit = geo[souTar]![1] + constraint[souTar]![1]! * geo[souTar]![3];
      else limit = limits[souTar]![side]!;
      if (currentOrientation === 0) {
        const lastX = wayPoints1[currentIndex]![0]!;
        const deltaX = (limit - lastX) * direction[0];
        if (deltaX > 0) wayPoints1[currentIndex]![0] += direction[0] * deltaX;
      } else {
        const lastY = wayPoints1[currentIndex]![1]!;
        const deltaY = (limit - lastY) * direction[1];
        if (deltaY > 0) wayPoints1[currentIndex]![1] += direction[1] * deltaY;
      }
    } else if (isCenter) {
      wayPoints1[currentIndex]![0] += direction[0] * Math.abs(vertexSeperations[directionIndex]! / 2);
      wayPoints1[currentIndex]![1] += direction[1] * Math.abs(vertexSeperations[directionIndex]! / 2);
    }
    if (currentIndex > 0 && wayPoints1[currentIndex]![currentOrientation] === wayPoints1[currentIndex - 1]![currentOrientation]) currentIndex--;
    else lastOrientation = currentOrientation;
  }

  for (let i = 0; i <= currentIndex; i++) {
    if (i === currentIndex) {
      const targetOrientation = (dir[1]! & (EAST | WEST)) > 0 ? 0 : 1;
      const sameOrient = targetOrientation === initialOrientation ? 0 : 1;
      if (sameOrient !== (currentIndex + 1) % 2) break;
    }
    result.push({ x: round1(wayPoints1[i]![0]!), y: round1(wayPoints1[i]![1]!) });
  }
  let index = 1;
  while (index < result.length) {
    const [before, here] = [result[index - 1], result[index]];
    if (before == null || here == null || before.x !== here.x || before.y !== here.y) index++;
    else result.splice(index, 1);
  }
};

/** draw.io's copies (Graph.js), testing terminals in model units: the same at scale 1. */
const elbowContains = (terminal: Box, x: number, y: number) => contains(terminal, x, y);

const SideToSide: EdgeStyleFunction = (state, sourceTerminal, targetTerminal, points, result) => {
  let pt = points !== null && points.length > 0 ? transformControlPoint(state, points[0]!) : null;
  const p0 = state.absolutePoints[0];
  const pe = state.absolutePoints[state.absolutePoints.length - 1];
  const source: Box | null = p0 != null ? { x: p0.x, y: p0.y, width: 0, height: 0 } : sourceTerminal?.box ?? null;
  const target: Box | null = pe != null ? { x: pe.x, y: pe.y, width: 0, height: 0 } : targetTerminal?.box ?? null;
  if (source === null || target === null) return;
  const l = Math.max(source.x, target.x);
  const r = Math.min(source.x + source.width, target.x + target.width);
  const x = pt !== null ? pt.x : Math.round(r + (l - r) / 2);
  let y1 = source.y + source.height / 2;
  let y2 = target.y + target.height / 2;
  if (pt !== null) {
    if (pt.y >= source.y && pt.y <= source.y + source.height) y1 = pt.y;
    if (pt.y >= target.y && pt.y <= target.y + target.height) y2 = pt.y;
  }
  if (!elbowContains(target, x, y1) && !elbowContains(source, x, y1)) result.push({ x, y: y1 });
  if (!elbowContains(target, x, y2) && !elbowContains(source, x, y2)) result.push({ x, y: y2 });
  if (result.length === 1) {
    if (pt !== null) {
      if (!elbowContains(target, x, pt.y) && !elbowContains(source, x, pt.y)) result.push({ x, y: pt.y });
    } else {
      const t = Math.max(source.y, target.y);
      const b = Math.min(source.y + source.height, target.y + target.height);
      result.push({ x, y: t + (b - t) / 2 });
    }
  }
  pt = null;
};

const TopToBottom: EdgeStyleFunction = (state, sourceTerminal, targetTerminal, points, result) => {
  const pt = points !== null && points.length > 0 ? transformControlPoint(state, points[0]!) : null;
  const p0 = state.absolutePoints[0];
  const pe = state.absolutePoints[state.absolutePoints.length - 1];
  const source: Box | null = p0 != null ? { x: p0.x, y: p0.y, width: 0, height: 0 } : sourceTerminal?.box ?? null;
  const target: Box | null = pe != null ? { x: pe.x, y: pe.y, width: 0, height: 0 } : targetTerminal?.box ?? null;
  if (source === null || target === null) return;
  const t = Math.max(source.y, target.y);
  const b = Math.min(source.y + source.height, target.y + target.height);
  let x = source.x + source.width / 2;
  if (pt !== null && pt.x >= source.x && pt.x <= source.x + source.width) x = pt.x;
  const y = pt !== null ? pt.y : Math.round(b + (t - b) / 2);
  if (!elbowContains(target, x, y) && !elbowContains(source, x, y)) result.push({ x, y });
  if (pt !== null && pt.x >= target.x && pt.x <= target.x + target.width) x = pt.x;
  else x = target.x + target.width / 2;
  if (!elbowContains(target, x, y) && !elbowContains(source, x, y)) result.push({ x, y });
  if (result.length === 1) {
    if (pt !== null) {
      if (!elbowContains(target, pt.x, y) && !elbowContains(source, pt.x, y)) result.push({ x: pt.x, y });
    } else {
      const l = Math.max(source.x, target.x);
      const r = Math.min(source.x + source.width, target.x + target.width);
      result.push({ x: l + (r - l) / 2, y });
    }
  }
};

const ElbowConnector: EdgeStyleFunction = (state, source, target, points, result) => {
  let pt = points !== null && points.length > 0 ? points[0]! : null;
  let vertical = false;
  let horizontal = false;
  if (source !== null && target !== null) {
    const s = source.box;
    const t = target.box;
    if (pt !== null) {
      const left = Math.min(s.x, t.x);
      const right = Math.max(s.x + s.width, t.x + t.width);
      const top = Math.min(s.y, t.y);
      const bottom = Math.max(s.y + s.height, t.y + t.height);
      pt = transformControlPoint(state, pt);
      vertical = pt.y < top || pt.y > bottom;
      horizontal = pt.x < left || pt.x > right;
    } else {
      vertical = Math.max(s.x, t.x) === Math.min(s.x + s.width, t.x + t.width);
      if (!vertical) horizontal = Math.max(s.y, t.y) === Math.min(s.y + s.height, t.y + t.height);
    }
  }
  if (!horizontal && (vertical || state.style.elbow === "vertical")) TopToBottom(state, source, target, points, result);
  else SideToSide(state, source, target, points, result);
};

const EDGE_STYLES: Record<string, EdgeStyleFunction> = {
  orthogonalEdgeStyle: OrthConnector,
  segmentEdgeStyle: SegmentConnector,
  elbowEdgeStyle: ElbowConnector,
  sideToSideEdgeStyle: SideToSide,
  topToBottomEdgeStyle: TopToBottom,
};
const ORTHOGONAL_STYLES = new Set([OrthConnector, SegmentConnector, ElbowConnector, SideToSide, TopToBottom]);
const DUPLICATES_REMOVED = new Set([ElbowConnector, SideToSide, TopToBottom]);

// The page ------------------------------------------------------------------------------

/** A wire's route, and what its label is placed by. */
export interface WireRoute {
  points: Point[];
  /** Segment lengths, as mxGraphView.updateEdgeBounds keeps them. */
  segments: number[];
  length: number;
}

/** The cells of a page, with absolute boxes for the shapes the routing can use. */
export interface PageGeometry {
  terminals: Map<string, Terminal>;
  /** Absolute origin of each cell's coordinate space (its parent's top-left), by cell id. */
  origins: Map<string, Point | null>;
}

/** Absolute boxes: a cell's geometry is relative to its parent shape, layers adding nothing. */
export function pageGeometry(page: DrawioPage): PageGeometry {
  const byId = new Map(page.cells.filter((cell) => cell.id !== undefined).map((cell) => [cell.id!, cell]));
  const origins = new Map<string, Point | null>();
  const originOf = (cell: DrawioCell, seen = new Set<string>()): Point | null => {
    if (cell.id !== undefined && origins.has(cell.id)) return origins.get(cell.id)!;
    let origin: Point | null = { x: 0, y: 0 };
    const parent = cell.parent === undefined ? undefined : byId.get(cell.parent);
    if (parent !== undefined && !seen.has(parent.id ?? "")) {
      seen.add(parent.id ?? "");
      if (parent.edge) origin = null;
      else if (parent.vertex) {
        const above = originOf(parent, seen);
        const geometry = parent.geometry;
        origin = above === null || geometry === undefined || geometry.relative ? null : { x: above.x + geometry.x, y: above.y + geometry.y };
      }
    }
    if (cell.id !== undefined) origins.set(cell.id, origin);
    return origin;
  };
  const terminals = new Map<string, Terminal>();
  for (const cell of page.cells) {
    if (cell.id === undefined) continue;
    const origin = originOf(cell);
    if (!cell.vertex || cell.geometry === undefined || cell.geometry.relative || origin === null || cell.geometry.unreadable.length > 0) continue;
    terminals.set(cell.id, { box: { x: origin.x + cell.geometry.x, y: origin.y + cell.geometry.y, width: cell.geometry.width, height: cell.geometry.height }, style: cellStyle(cell.style, false) });
  }
  return { terminals, origins };
}

/** mxGraphView.updateEdgeState up to the absolute points, or undefined when the port does not follow this wire. */
export function routeWire(edge: DrawioCell, geometry: PageGeometry): WireRoute | undefined {
  const geo = edge.geometry;
  if (geo === undefined || edge.id === undefined) return undefined;
  const origin = geometry.origins.get(edge.id);
  if (origin === null || origin === undefined) return undefined;
  const style = cellStyle(edge.style, true);
  if (style.sourcePort !== undefined || style.targetPort !== undefined || style.snapToPoint !== undefined || number(style, "fixedPointSpacing", 0) === 1 || style.orthogonal !== undefined) return undefined;
  const source = edge.source === undefined ? null : geometry.terminals.get(edge.source);
  const target = edge.target === undefined ? null : geometry.terminals.get(edge.target);
  // A terminal that is named but not a routable shape (a label, an edge, a relative child…)
  if (source === undefined || target === undefined) return undefined;
  if ((source !== null && !routable(source)) || (target !== null && !routable(target))) return undefined;
  // Loops take the loop style, not ported
  if (source !== null && source === target) return undefined;

  const name = number(style, "noEdgeStyle", 0) === 1 ? undefined : style.edgeStyle;
  const edgeStyle = name === undefined ? null : EDGE_STYLES[String(name)];
  if (edgeStyle === undefined) return undefined;

  const state: EdgeState = { style, absolutePoints: [null, null], origin };
  // Fixed terminal points (getConnectionConstraint, Graph.getLegacyConnectionPoint)
  const fixed = (terminal: Terminal | null, isSource: boolean): Point | null => {
    const prefix = isSource ? "exit" : "entry";
    if (terminal !== null && terminal.style.perimeter === "centerPerimeter") return center(terminal.box);
    const px = style[`${prefix}X`];
    const py = style[`${prefix}Y`];
    if (terminal !== null && px !== undefined && py !== undefined) {
      const fx = Number.parseFloat(String(px));
      const fy = Number.parseFloat(String(py));
      const perimeter = style[`${prefix}Perimeter`] === undefined ? true : Boolean(Number(style[`${prefix}Perimeter`]));
      const dx = number(style, `${prefix}Dx`, 0);
      const dy = number(style, `${prefix}Dy`, 0);
      let point = { x: terminal.box.x + fx * terminal.box.width + dx, y: terminal.box.y + fy * terminal.box.height + dy };
      if (perimeter) point = perimeterPoint(terminal, point, false, 0);
      return point;
    }
    if (terminal === null) {
      const point = isSource ? geo.sourcePointAt : geo.targetPointAt;
      return point === undefined ? null : { x: point.x + origin.x, y: point.y + origin.y };
    }
    return null;
  };
  state.absolutePoints = [fixed(source, true), fixed(target, false)];
  if (source === null && state.absolutePoints[0] === null) return undefined;
  if (target === null && state.absolutePoints[1] === null) return undefined;

  // updatePoints
  const waypoints = geo.points.length > 0 ? geo.points : null;
  const pts: Array<Point | null> = [state.absolutePoints[0]!];
  if (edgeStyle !== null) {
    edgeStyle(state, source, target, waypoints, pts);
  } else if (waypoints !== null) {
    for (const point of waypoints) pts.push(transformControlPoint(state, point));
  }
  pts.push(state.absolutePoints[1]!);

  // updateFloatingTerminalPoints: the target first, then the source toward it
  const orth = edgeStyle !== null && ORTHOGONAL_STYLES.has(edgeStyle);
  const floating = (start: Terminal, end: Terminal | null, isSource: boolean): Point => {
    const count = pts.length;
    let next = pts[isSource ? Math.min(1, count - 1) : Math.max(0, count - 2)] ?? null;
    if (next === null && end !== null) next = center(end.box);
    const border = number(style, "perimeterSpacing", 0) + number(style, isSource ? "sourcePerimeterSpacing" : "targetPerimeterSpacing", 0);
    return next === null ? center(start.box) : perimeterPoint(start, next, orth, border);
  };
  if (pts[pts.length - 1] === null && target !== null) pts[pts.length - 1] = floating(target, source, false);
  if (pts[0] === null && source !== null) pts[0] = floating(source, target, true);

  // removeDuplicatePoints
  const removes = edgeStyle !== null && (DUPLICATES_REMOVED.has(edgeStyle) || (edgeStyle === OrthConnector && waypoints === null));
  if (removes && pts.length > 2) {
    const equals = (a: Point | null, b: Point | null) => a !== null && b !== null && Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;
    let duplicates = false;
    for (let i = 1; i < pts.length && !duplicates; i++) duplicates = equals(pts[i - 1]!, pts[i]!);
    if (duplicates) {
      for (let i = pts.length - 2; i > 0 && pts.length > 2; i--) {
        if (equals(pts[i]!, pts[i + 1]!) || equals(pts[i]!, pts[i - 1]!)) pts.splice(i, 1);
      }
    }
  }
  if (pts.some((point) => point === null) || pts.length < 2) return undefined;
  const points = pts as Point[];
  const segments: number[] = [];
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const segment = Math.hypot(points[i - 1]!.x - points[i]!.x, points[i - 1]!.y - points[i]!.y);
    segments.push(segment);
    length += segment;
  }
  return { points, segments, length };
}

/**
 * mxGraphView.getPoint: where a label goes on a route, by its geometry's relative x (from -1
 * at the source to 1 at the target), y (across the segment) and offset.
 */
export function labelPoint(route: WireRoute, relative: { x: number; y: number }, offset: Point = { x: 0, y: 0 }): Point {
  const { points, segments } = route;
  const gx = relative.x / 2;
  const dist = Math.round((gx + 0.5) * route.length);
  let segment = segments[0] ?? 0;
  let length = 0;
  let index = 1;
  while (dist >= Math.round(length + segment) && index < points.length - 1) {
    length += segment;
    segment = segments[index++]!;
  }
  const factor = segment === 0 ? 0 : (dist - length) / segment;
  const p0 = points[index - 1]!;
  const pe = points[index]!;
  const dx = pe.x - p0.x;
  const dy = pe.y - p0.y;
  const nx = segment === 0 ? 0 : dy / segment;
  const ny = segment === 0 ? 0 : dx / segment;
  return { x: p0.x + dx * factor + (nx * relative.y + offset.x), y: p0.y + dy * factor - (ny * relative.y - offset.y) };
}

// What a route crosses ---------------------------------------------------------------------

/** How a shape's inside is drawn: its outline for ellipses and rhombuses, its box otherwise. */
export type Outline = "box" | "ellipse" | "rhombus";

export function outlineOf(style: Style): Outline {
  const shape = String(style.shape ?? "");
  if (shape === "ellipse" || shape === "doubleEllipse") return "ellipse";
  if (shape === "rhombus") return "rhombus";
  return "box";
}

/**
 * The length of segment p→q that lies strictly inside the shape shrunk by `inset`: zero for a
 * segment that misses it, runs along its edge, or ends on its outline.
 */
export function lengthInside(p: Point, q: Point, box: Box, outline: Outline, inset: number): number {
  const a = box.width / 2 - inset;
  const b = box.height / 2 - inset;
  if (a <= 0 || b <= 0) return 0;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  // In the shape's own frame, scaled so the shrunk shape is the unit circle, square or diamond
  const x0 = (p.x - cx) / a;
  const y0 = (p.y - cy) / b;
  const dx = (q.x - p.x) / a;
  const dy = (q.y - p.y) / b;
  let t0 = 0;
  let t1 = 1;
  if (outline === "ellipse") {
    const A = dx * dx + dy * dy;
    if (A === 0) return 0;
    const B = 2 * (x0 * dx + y0 * dy);
    const C = x0 * x0 + y0 * y0 - 1;
    const disc = B * B - 4 * A * C;
    if (disc <= 0) return 0;
    const root = Math.sqrt(disc);
    t0 = Math.max(0, (-B - root) / (2 * A));
    t1 = Math.min(1, (-B + root) / (2 * A));
  } else {
    // Cyrus-Beck against the half-planes n·(x, y) <= 1
    const normals = outline === "box" ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (const [nx, ny] of normals as Array<[number, number]>) {
      const start = nx * x0 + ny * y0 - 1;
      const step = nx * dx + ny * dy;
      if (step === 0) {
        if (start >= 0) return 0;
        continue;
      }
      const t = -start / step;
      if (step < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
    }
  }
  if (t1 <= t0) return 0;
  return (t1 - t0) * Math.hypot(q.x - p.x, q.y - p.y);
}

/** Area shared by two boxes. */
export function sharedArea(a: Box, b: Box): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

/**
 * A label's box, estimated: the server measures no text. Calibrated on the viewer's measured
 * boxes (Helvetica, 0.44 of the font size per character at the median) and kept on the small
 * side, so a label reported on a shape really is on it.
 */
export function labelBox(centre: Point, text: string, fontSize: number): Box {
  const width = Math.max(1, text.length) * fontSize * 0.45;
  const height = fontSize * 1.18;
  return { x: centre.x - width / 2, y: centre.y - height / 2, width, height };
}
