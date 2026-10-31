/**
 * Reading a draw.io file, and saying what would make it open wrong or read badly.
 *
 * The agent cannot see a diagram without draw.io itself, so this stands in for the look
 * it cannot take: errors are what draw.io would refuse or mis-draw, warnings are what a
 * reader would trip on. Nothing here renders; it walks the cells.
 *
 * A file is an `<mxfile>` of `<diagram>` pages, or a bare `<mxGraphModel>`. A page holds
 * its model as XML, or — draw.io's default when saving — compressed: base64 of the
 * raw-deflated, URI-encoded XML.
 *
 * SECURITY: the input is the agent's or the user's file. It is read with the office
 * package's scanner, which refuses a DOCTYPE (entity expansion is unreachable), and a
 * compressed page is inflated under a cap, so a small file cannot become a large one.
 */
import { inflateRawSync } from "node:zlib";
import { anchorWire, movingEndValues, wireAnchorIssues, type AnchorWire } from "./drawioAnchors.ts";
import { labelBox, labelPoint, lengthInside, outlineOf, pageGeometry, routeWire, sharedArea, type Box, type Point } from "./drawioRoutes.ts";
import { scanXml, XmlError } from "@pi-outpost/office/xml.ts";

/** Largest model one compressed page may inflate to. */
export const MAX_INFLATED_PAGE_BYTES = 32 * 1024 * 1024;
/** Most issues listed; the rest are counted. A diagram with more has a problem one list will not fix. */
export const MAX_LISTED_ISSUES = 60;

export class DrawioReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DrawioReadError";
  }
}

interface Geometry {
  x: number;
  y: number;
  width: number;
  height: number;
  relative: boolean;
  /** Attribute values that are present but not numbers. */
  unreadable: string[];
  sourcePoint: boolean;
  targetPoint: boolean;
  /** Where a loose end is, when it has a sourcePoint or targetPoint. */
  sourcePointAt?: { x: number; y: number };
  targetPointAt?: { x: number; y: number };
  /** A wire's waypoints, relative to its parent: `<Array as="points">`. */
  points: { x: number; y: number }[];
  /** A label's offset: `<mxPoint as="offset">`. */
  offset?: { x: number; y: number };
}

export interface DrawioCell {
  id: string | undefined;
  parent: string | undefined;
  vertex: boolean;
  edge: boolean;
  source: string | undefined;
  target: string | undefined;
  /** The label, tags stripped: what a reader sees. */
  label: string;
  style: string;
  geometry: Geometry | undefined;
}

export interface DrawioPage {
  name: string;
  cells: DrawioCell[];
}

export interface DrawioIssue {
  severity: "error" | "warning";
  page: string;
  /** The cells involved, by id. */
  cells: string[];
  message: string;
}

export interface DrawioReport {
  pages: { name: string; shapes: number; connectors: number }[];
  issues: DrawioIssue[];
}

const NUMERIC = ["x", "y", "width", "height"] as const;

/**
 * A name taken from the file, made safe to quote: a binary file read as text has
 * "element names" that are just bytes, and a message must not carry them.
 */
function quoted(name: string): string {
  const printable = name.replace(/[^\x20-\x7e]/g, "?");
  return printable.length > 40 ? `${printable.slice(0, 39)}…` : printable;
}

/**
 * A label as a reader sees it: HTML labels are common, entities already decoded by the
 * scanner. Only ever quoted in the agent's text report, never written into a page.
 *
 * Tags are dropped character by character rather than by pattern: whatever lies between
 * a `<` and the next `>` goes, a line break becomes a space, and no bracket survives —
 * so a nested `<scr<script>ipt>` cannot rebuild a tag the way one regex pass leaves it.
 */
function plainLabel(value: string | undefined): string {
  let text = "";
  let tag: string | null = null;
  for (const char of value ?? "") {
    if (char === "<") {
      tag = "";
    } else if (char === ">") {
      if (tag !== null && /^br\b/i.test(tag)) text += " ";
      tag = null;
    } else if (tag !== null) {
      tag += char;
    } else {
      text += char;
    }
  }
  return text.replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function readGeometry(attributes: Record<string, string>): Geometry {
  const geometry: Geometry = { x: 0, y: 0, width: 0, height: 0, relative: attributes.relative === "1", unreadable: [], sourcePoint: false, targetPoint: false, points: [] };
  for (const name of NUMERIC) {
    const raw = attributes[name];
    if (raw === undefined) continue;
    const value = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(value)) geometry.unreadable.push(`${name}="${raw}"`);
    else geometry[name] = value;
  }
  return geometry;
}

/** The model of a compressed page: base64 → raw inflate → URI-decoded XML. */
export function inflatePage(text: string): string {
  const compact = text.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) throw new DrawioReadError("its content is neither a <mxGraphModel> nor compressed draw.io data");
  let inflated: Buffer;
  try {
    inflated = inflateRawSync(Buffer.from(compact, "base64"), { maxOutputLength: MAX_INFLATED_PAGE_BYTES });
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE" ? `it inflates past ${MAX_INFLATED_PAGE_BYTES / (1024 * 1024)} MB` : "its compressed data is damaged";
    throw new DrawioReadError(reason);
  }
  try {
    return decodeURIComponent(inflated.toString("latin1"));
  } catch {
    // Some writers deflate the XML itself rather than its URI encoding
    return inflated.toString("utf8");
  }
}

/** The cells of one `<mxGraphModel>` document. */
function readModel(xml: string, page: string): DrawioCell[] {
  const cells: DrawioCell[] = [];
  /** Open elements, by name. */
  const stack: string[] = [];
  /** `<object>`/`<UserObject>` wrapping the next `<mxCell>`: it carries the id and label. */
  let wrapper: Record<string, string> | null = null;
  let cell: DrawioCell | null = null;
  let geometry: Geometry | null = null;
  let sawModel = false;

  try {
    scanXml(xml, (event) => {
      if (event.kind === "text") return;
      if (event.kind === "close") {
        const open = stack.pop();
        if (open !== event.name) throw new DrawioReadError(`</${quoted(event.name)}> closes <${quoted(open ?? "nothing")}>`);
        if (event.name === "mxCell") cell = null;
        else if (event.name === "mxGeometry") geometry = null;
        else if (event.name === "object" || event.name === "UserObject") wrapper = null;
        return;
      }
      const { name, attributes, selfClosing } = event;
      if (stack.length === 0) {
        if (name !== "mxGraphModel") throw new DrawioReadError(`its model is <${quoted(name)}>, not <mxGraphModel>`);
        sawModel = true;
      }
      if (name === "object" || name === "UserObject") {
        wrapper = attributes;
      } else if (name === "mxCell") {
        const own = wrapper ?? attributes;
        const next: DrawioCell = {
          id: own.id ?? attributes.id,
          parent: attributes.parent,
          vertex: attributes.vertex === "1",
          edge: attributes.edge === "1",
          source: attributes.source,
          target: attributes.target,
          label: plainLabel(wrapper ? (wrapper.label ?? wrapper.value) : attributes.value),
          style: attributes.style ?? "",
          geometry: undefined,
        };
        cells.push(next);
        cell = selfClosing ? null : next;
      } else if (name === "mxGeometry" && cell !== null && (attributes.as ?? "geometry") === "geometry") {
        const read = readGeometry(attributes);
        (cell as DrawioCell).geometry = read;
        geometry = selfClosing ? null : read;
      } else if (name === "mxPoint" && geometry !== null) {
        const point = { x: Number(attributes.x ?? 0) || 0, y: Number(attributes.y ?? 0) || 0 };
        const read = geometry as Geometry;
        if (attributes.as === "sourcePoint") {
          read.sourcePoint = true;
          read.sourcePointAt = point;
        } else if (attributes.as === "targetPoint") {
          read.targetPoint = true;
          read.targetPointAt = point;
        } else if (attributes.as === "offset") read.offset = point;
        // A waypoint is an <mxPoint> of the <Array as="points"> right inside the geometry
        else if (stack[stack.length - 1] === "Array" && stack[stack.length - 2] === "mxGeometry") read.points.push(point);
      }
      if (!selfClosing) stack.push(name);
    });
  } catch (error) {
    if (error instanceof DrawioReadError) throw error;
    if (error instanceof XmlError) throw new DrawioReadError(`page "${page}" is not well-formed XML: ${error.message}`);
    throw error;
  }
  if (!sawModel) throw new DrawioReadError(`page "${page}" holds no <mxGraphModel>`);
  if (stack.length > 0) throw new DrawioReadError(`page "${page}" ends inside <${stack[stack.length - 1]}>`);
  return cells;
}

/**
 * The pages of a draw.io file.
 *
 * Throws `DrawioReadError` with the reason when draw.io could not open it at all.
 */
export function readDrawio(xml: string): DrawioPage[] {
  const trimmed = xml.replace(/^﻿/, "").trim();
  let root: string | undefined;
  try {
    scanXml(trimmed, (event) => {
      if (event.kind !== "open") return;
      root = event.name;
      return false;
    });
  } catch (error) {
    if (error instanceof XmlError) throw new DrawioReadError(`this is not well-formed XML: ${error.message}`);
    throw error;
  }
  if (root === "mxGraphModel") return [{ name: "Page-1", cells: readModel(trimmed, "Page-1") }];
  if (root !== "mxfile") throw new DrawioReadError(root === undefined ? "the file is empty" : `its root is <${quoted(root)}>, not <mxfile> or <mxGraphModel>`);

  // Each <diagram>'s span of text, so its model can be read on its own
  const pages: DrawioPage[] = [];
  const pattern = /<diagram\b([^>]*?)(\/>|>([\s\S]*?)<\/diagram>)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(trimmed)) !== null) {
    let name = `Page-${pages.length + 1}`;
    scanXml(`<diagram${match[1]}/>`, (event) => {
      if (event.kind === "open" && event.attributes.name) name = event.attributes.name;
      return false;
    });
    const body = (match[3] ?? "").trim();
    if (body === "") throw new DrawioReadError(`page "${name}" is empty`);
    let model: string;
    try {
      model = body.startsWith("<") ? body : inflatePage(body);
    } catch (error) {
      throw error instanceof DrawioReadError ? new DrawioReadError(`page "${name}" cannot be read: ${error.message}`) : error;
    }
    pages.push({ name, cells: readModel(model, name) });
  }
  if (pages.length === 0) throw new DrawioReadError("the <mxfile> holds no <diagram> page");
  return pages;
}

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
 * routes it (drawioRoutes.ts), then its segments and label tested against the labelled boxes.
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
  const ownEnds = new Map<string, Array<"exit" | "entry">>();
  // Reported once every wire is known: the facing points are handed out across the page, so
  // two wires sent to the same side are not both told to use its middle
  const throughOwn: Array<{ edge: DrawioCell & { id: string }; own: Array<{ role: string; id: string; prefix: "exit" | "entry" }>; waypoints: boolean }> = [];
  for (const edge of page.cells) {
    if (!edge.edge || edge.id === undefined) continue;
    const route = routeWire(edge, geometry);
    if (route === undefined) continue;
    routed.push(anchorWire({ ...edge, id: edge.id }, page.cells, route.points, geometry.origins.get(edge.id) ?? undefined));
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
    const labels: Array<{ text: string; centre: Point; style: string }> = [];
    if (edge.label !== "" && edge.geometry !== undefined) {
      labels.push({ text: edge.label, centre: labelPoint(route, edge.geometry.relative ? { x: edge.geometry.x, y: edge.geometry.y } : { x: 0, y: 0 }, edge.geometry.offset), style: edge.style });
    }
    for (const child of page.cells) {
      if (child.parent !== edge.id || child.label === "" || child.geometry === undefined || !child.geometry.relative) continue;
      labels.push({ text: child.label, centre: labelPoint(route, { x: child.geometry.x, y: child.geometry.y }, child.geometry.offset), style: child.style });
    }
    for (const label of labels) {
      const fontSize = Number(/(?:^|;)fontSize=([\d.]+)/.exec(label.style)?.[1] ?? 11) || 11;
      const box = labelBox(label.centre, label.text, fontSize);
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
  for (const issue of wireAnchorIssues(routed, boxes, named, ownEnds, reroute)) report("warning", [...issue.wires, ...issue.shapes], issue.message, step[issue.rule]);
}

/** Read and check a draw.io file. Throws `DrawioReadError` when it cannot be read at all. */
export function checkDrawio(xml: string): DrawioReport {
  const pages = readDrawio(xml);
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
