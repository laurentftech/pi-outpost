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

/** A label as a reader sees it: HTML labels are common, entities already decoded by the scanner. */
function plainLabel(value: string | undefined): string {
  return (value ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readGeometry(attributes: Record<string, string>): Geometry {
  const geometry: Geometry = { x: 0, y: 0, width: 0, height: 0, relative: attributes.relative === "1", unreadable: [], sourcePoint: false, targetPoint: false };
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
        if (attributes.as === "sourcePoint") (geometry as Geometry).sourcePoint = true;
        if (attributes.as === "targetPoint") (geometry as Geometry).targetPoint = true;
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

function checkPage(page: DrawioPage, issues: DrawioIssue[]): void {
  const report = (severity: DrawioIssue["severity"], cells: string[], message: string) => issues.push({ severity, page: page.name, cells, message });
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
        report("warning", [cell.id], `shape ${describe(cell)} is 0 × 0, so nothing of it shows`);
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
          report("warning", [a.id, b.id], `shapes ${describe(a)} and ${describe(b)} overlap`);
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
    if (!contains(box, shape.geometry)) report("warning", [shape.id, parent.id ?? ""], `shape ${describe(shape)} lies partly outside its container ${describe(parent)}`);
  }
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
  lines.push(errors.length > 0 ? "Fix the errors, then run drawio_check again." : "Move the shapes apart or resize them, then run drawio_check again.");
  return lines.join("\n");
}
