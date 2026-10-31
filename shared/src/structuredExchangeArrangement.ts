/**
 * A graph's arrangement: where a person, or an earlier figure, put things
 * (structured-exchange-arrangement, design 3).
 *
 * It lives beside the document, one view per viewpoint and one ("") for the whole document,
 * and names elements and relationships by identity, so a new version of the document finds its
 * arrangement again. It is partial — what it does not name is computed — and presentation only:
 * it never enters the document and never travels to an authority.
 *
 * Written as canonical text, so the file can be versioned: the same arrangement is the same
 * bytes, and a moved box is a one-entry diff.
 */
import type { Orientation } from "./diagramOrientation.ts";
import type { StructuredGraphData } from "./structuredExchange.ts";

export const ARRANGEMENT_FORMAT = "pi-outpost/structured-exchange-arrangement-1";
/** Places are kept on this grid, as draw.io snaps them. */
export const ARRANGEMENT_GRID = 10;

export interface ArrangedPoint {
  x: number;
  y: number;
}

/** A relationship's ends, bends and label, as draw.io holds them on a connector. */
export interface ArrangedRelationship {
  /** Fixed exit on the source, as fractions of its box. */
  exit?: ArrangedPoint;
  /** Fixed entry on the target, as fractions of its box. */
  entry?: ArrangedPoint;
  /** Waypoints, in figure units. */
  waypoints?: ArrangedPoint[];
  /** The label along the route (-1 at the source, 1 at the target), its distance across it, and a free offset. */
  label?: { along: number; across?: number; offset: ArrangedPoint };
}

export interface ArrangementView {
  orientation?: Orientation;
  /** Top-left corners, by element key. */
  elements: Record<string, ArrangedPoint>;
  relationships: Record<string, ArrangedRelationship>;
}

export interface Arrangement {
  format: typeof ARRANGEMENT_FORMAT;
  /** By viewpoint identifier; "" is the whole document. */
  views: Record<string, ArrangementView>;
}

export const emptyArrangement = (): Arrangement => ({ format: ARRANGEMENT_FORMAT, views: {} });
export const emptyView = (): ArrangementView => ({ elements: {}, relationships: {} });

/** Where a document's arrangement is kept: `vehicle.json` → `vehicle.arrangement.json`. */
export function arrangementPathFor(documentPath: string): string {
  return /\.json$/i.test(documentPath) ? documentPath.replace(/\.json$/i, ".arrangement.json") : `${documentPath}.arrangement.json`;
}

/** Whether a path names an arrangement rather than a document. */
export const isArrangementPath = (path: string) => /\.arrangement\.json$/i.test(path);

/**
 * A key part, with the characters keys are built from escaped, so a reference holding them
 * cannot make two keys read alike. References are opaque and may hold anything.
 */
const part = (text: string) => text.replace(/[%>#[\]\s]/g, (char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0").toUpperCase()}`);

/** An element's key: its reference when it carries one, which survives a new envelope, else its envelope id. */
export function elementKey(element: { id: string; ref?: string }): string {
  return element.ref === undefined ? `id:${part(element.id)}` : `ref:${part(element.ref)}`;
}

/**
 * Each relationship's key, in document order: its reference when it carries one, else its
 * endpoints' keys, its kind, and its rank among those sharing all three. Endpoints are a
 * relationship's identity in the contract; its label is state, so relabelling keeps the key.
 */
export function relationshipKeys(data: StructuredGraphData): string[] {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const seen = new Map<string, number>();
  return data.edges.map((edge) => {
    if (edge.ref !== undefined) return `ref:${part(edge.ref)}`;
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    const base = `${from === undefined ? `id:${part(edge.from)}` : elementKey(from)}>${to === undefined ? `id:${part(edge.to)}` : elementKey(to)}[${part(edge.kind ?? "")}]`;
    const rank = seen.get(base) ?? 0;
    seen.set(base, rank + 1);
    return `${base}#${rank}`;
  });
}

export type ArrangementReading = { ok: true; arrangement: Arrangement } | { ok: false; reason: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isPoint = (value: unknown): value is ArrangedPoint => isRecord(value) && Number.isFinite(value.x) && Number.isFinite(value.y);

/** An arrangement file read, or why it cannot be: a bad one is reported, never half-applied. */
export function readArrangement(text: string): ArrangementReading {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "it is not parseable JSON" };
  }
  if (!isRecord(parsed) || parsed.format !== ARRANGEMENT_FORMAT) return { ok: false, reason: `it does not declare "format": "${ARRANGEMENT_FORMAT}"` };
  if (!isRecord(parsed.views)) return { ok: false, reason: "it has no views" };
  const views: Record<string, ArrangementView> = {};
  for (const [name, raw] of Object.entries(parsed.views)) {
    if (!isRecord(raw)) return { ok: false, reason: `view "${name}" is not an object` };
    const view = emptyView();
    if (raw.orientation !== undefined) {
      if (raw.orientation !== "landscape" && raw.orientation !== "portrait") return { ok: false, reason: `view "${name}" has an unknown orientation` };
      view.orientation = raw.orientation;
    }
    for (const [key, point] of Object.entries(isRecord(raw.elements) ? raw.elements : {})) {
      if (!isPoint(point)) return { ok: false, reason: `element "${key}" of view "${name}" has no x and y` };
      view.elements[key] = { x: point.x, y: point.y };
    }
    for (const [key, entry] of Object.entries(isRecord(raw.relationships) ? raw.relationships : {})) {
      if (!isRecord(entry)) return { ok: false, reason: `relationship "${key}" of view "${name}" is not an object` };
      const read: ArrangedRelationship = {};
      for (const end of ["exit", "entry"] as const) {
        if (entry[end] === undefined) continue;
        if (!isPoint(entry[end])) return { ok: false, reason: `relationship "${key}" of view "${name}" has an unreadable ${end}` };
        read[end] = { x: entry[end].x, y: entry[end].y };
      }
      if (entry.waypoints !== undefined) {
        if (!Array.isArray(entry.waypoints) || !entry.waypoints.every(isPoint)) return { ok: false, reason: `relationship "${key}" of view "${name}" has unreadable waypoints` };
        read.waypoints = entry.waypoints.map((point) => ({ x: point.x, y: point.y }));
      }
      if (entry.label !== undefined) {
        const label = entry.label;
        if (!isRecord(label) || !Number.isFinite(label.along) || !isPoint(label.offset)) return { ok: false, reason: `relationship "${key}" of view "${name}" has an unreadable label` };
        if (label.across !== undefined && !Number.isFinite(label.across)) return { ok: false, reason: `relationship "${key}" of view "${name}" has an unreadable label` };
        read.label = { along: label.along as number, ...(label.across === undefined ? {} : { across: label.across as number }), offset: { x: label.offset.x, y: label.offset.y } };
      }
      view.relationships[key] = read;
    }
    views[name] = view;
  }
  return { ok: true, arrangement: { format: ARRANGEMENT_FORMAT, views } };
}

const fraction = (value: number) => Math.round(value * 10_000) / 10_000;
const onGrid = (value: number) => Math.round(value / ARRANGEMENT_GRID) * ARRANGEMENT_GRID;

/** A place snapped to the grid, as the arrangement keeps it. */
export const snap = (point: ArrangedPoint): ArrangedPoint => ({ x: onGrid(point.x), y: onGrid(point.y) });

function canonicalRelationship(entry: ArrangedRelationship): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (entry.entry !== undefined) out.entry = { x: fraction(entry.entry.x), y: fraction(entry.entry.y) };
  if (entry.exit !== undefined) out.exit = { x: fraction(entry.exit.x), y: fraction(entry.exit.y) };
  if (entry.label !== undefined) {
    out.label = {
      ...(entry.label.across === undefined || entry.label.across === 0 ? {} : { across: Math.round(entry.label.across) }),
      along: fraction(entry.label.along),
      offset: { x: Math.round(entry.label.offset.x), y: Math.round(entry.label.offset.y) },
    };
  }
  if (entry.waypoints !== undefined && entry.waypoints.length > 0) out.waypoints = entry.waypoints.map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) }));
  return out;
}

const sorted = <T>(record: Record<string, T>) => Object.keys(record).sort().map((key) => [key, record[key]!] as const);

/** The arrangement as canonical text: sorted keys, rounded numbers, one place per line. */
export function writeArrangement(arrangement: Arrangement): string {
  const views: Record<string, unknown> = {};
  for (const [name, view] of sorted(arrangement.views)) {
    views[name] = {
      elements: Object.fromEntries(sorted(view.elements).map(([key, point]) => [key, snap(point)])),
      ...(view.orientation === undefined ? {} : { orientation: view.orientation }),
      relationships: Object.fromEntries(sorted(view.relationships).map(([key, entry]) => [key, canonicalRelationship(entry)])),
    };
  }
  const text = JSON.stringify({ format: ARRANGEMENT_FORMAT, views }, null, 2);
  // A point on one line, so moving a box changes one line of the file
  return `${text.replace(/\{\n\s*"x": (-?[\d.]+),\n\s*"y": (-?[\d.]+)\n\s*\}/g, '{ "x": $1, "y": $2 }')}\n`;
}
