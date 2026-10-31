/**
 * Reading a draw.io file into its pages and cells, wherever it is needed: the server's
 * drawio_check, and a structured-exchange figure read back from touch-up in the browser.
 *
 * A file is an `<mxfile>` of `<diagram>` pages, or a bare `<mxGraphModel>`. A page holds
 * its model as XML, or — draw.io's default when saving — compressed: base64 of the
 * raw-deflated, URI-encoded XML. Inflating needs a decompressor the caller supplies; the
 * server passes one with a cap, so a small file cannot become a large one.
 *
 * SECURITY: the input is the agent's or the user's file. It is read with the shared
 * scanner, which refuses a DOCTYPE (entity expansion is unreachable).
 */
import { scanXml, XmlError } from "../xml.ts";

/** How a compressed page's text becomes its model's XML; throws `DrawioReadError` when it cannot. */
export type InflatePage = (text: string) => string;

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

export interface Geometry {
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
export function readDrawio(xml: string, inflatePage?: InflatePage): DrawioPage[] {
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
      if (body.startsWith("<")) model = body;
      else if (inflatePage === undefined) throw new DrawioReadError("its compressed data cannot be read here");
      else model = inflatePage(body);
    } catch (error) {
      throw error instanceof DrawioReadError ? new DrawioReadError(`page "${name}" cannot be read: ${error.message}`) : error;
    }
    pages.push({ name, cells: readModel(model, name) });
  }
  if (pages.length === 0) throw new DrawioReadError("the <mxfile> holds no <diagram> page");
  return pages;
}
