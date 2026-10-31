/**
 * What an arrangement leaves for a person to look at (structured-exchange-arrangement,
 * design 5): the wire rules' warnings the cleanup could not resolve, a relationship drawn
 * through a box, entries naming nothing the document still holds, and boxes moved to make room.
 *
 * Said in the document's terms — element labels, "from → to" for a relationship — rather than in
 * the draw.io cell ids the rules work on, and with the value that fixes it wherever there is one.
 */
import { checkPages } from "./drawio/check.ts";
import { ANCHOR } from "./drawio/followAdvice.ts";
import type { DrawioCell, DrawioPage } from "./drawio/read.ts";
import { lengthInside, pageGeometry, routeWire, type Point } from "./drawio/routes.ts";
import { elementKey, relationshipKeys, type ArrangementView } from "./structuredExchangeArrangement.ts";
import { arrangedGraph } from "./structuredExchangeFigure.ts";
import { displayLabel, type Narrowing } from "./structuredExchangeModel.ts";
import type { Orientation } from "./diagramOrientation.ts";
import type { StructuredGraphData } from "./structuredExchange.ts";

export interface ArrangementFinding {
  /** Element ids concerned. */
  elements: string[];
  /** Relationship indexes concerned, in the document's order. */
  relationships: number[];
  message: string;
}

const ELEMENT_CELL = /"n:([^"]*)"(?: \([^)]*\))?/g;
const RELATIONSHIP_CELL = /"r:(\d+)"(?: \([^)]*\))?/g;
/** Clearance kept from a box a waypoint goes around. */
const AROUND = 20;

/** The arrangement checked against the graph it is drawn for. An empty list means nothing to look at. */
export function checkArrangement(
  data: StructuredGraphData,
  options: { hidden?: Narrowing; orientation?: Orientation; arrangement?: ArrangementView } = {},
): ArrangementFinding[] {
  const { shown, page, placement } = arrangedGraph(data, options);
  const label = new Map(shown.nodes.map((node) => [node.id, displayLabel(node)]));
  const named = (id: string) => `"${label.get(id) ?? id}"`;
  const relationship = (index: number) => {
    const edge = shown.edges[index];
    if (edge === undefined) return `relationship ${index}`;
    const said = edge.label ?? edge.kind;
    return `"${label.get(edge.from) ?? edge.from} → ${label.get(edge.to) ?? edge.to}"${said === undefined ? "" : ` (${said})`}`;
  };
  const inDocumentTerms = (message: string) =>
    message
      .replace(ELEMENT_CELL, (_all, id: string) => named(id))
      .replace(RELATIONSHIP_CELL, (_all, index: string) => relationship(Number(index)))
      .replace(/ in the mxGeometry of [^:.,]*/g, "")
      .replace(/To change a connector with edit[^.]*\./g, "");
  const findings: ArrangementFinding[] = [];

  for (const issue of checkPages([page]).issues) {
    const elements = issue.cells.filter((cell) => cell.startsWith("n:")).map((cell) => cell.slice(2));
    const relationships = issue.cells.filter((cell) => cell.startsWith("r:")).map((cell) => Number(cell.slice(2)));
    if (/runs through shape/.test(issue.message) && relationships.length === 1 && elements.length === 1) {
      const fix = avoiding(page, relationships[0]!, elements[0]!);
      findings.push({
        elements,
        relationships,
        message: `${relationship(relationships[0]!)} runs through ${named(elements[0]!)}: ${fix ?? "move the box off its path, or give the relationship waypoints that go around it"}`,
      });
      continue;
    }
    if (!ANCHOR.test(issue.message)) continue;
    findings.push({ elements, relationships, message: inDocumentTerms(issue.message).trim() });
  }

  const view = options.arrangement;
  if (view !== undefined) {
    const keys = new Set(relationshipKeys(data));
    const elementKeys = new Set(data.nodes.map(elementKey));
    for (const key of Object.keys(view.elements).sort()) {
      if (!elementKeys.has(key)) findings.push({ elements: [], relationships: [], message: `the arrangement places "${key}", which the document no longer holds: nothing is drawn for it, and it can be removed from the arrangement` });
    }
    for (const key of Object.keys(view.relationships).sort()) {
      if (!keys.has(key)) findings.push({ elements: [], relationships: [], message: `the arrangement routes "${key}", which the document no longer holds: nothing is drawn for it, and it can be removed from the arrangement` });
    }
  }
  for (const moved of placement?.shifted ?? []) {
    const now = placement!.boxes.find((box) => box.id === moved.id)!;
    findings.push({
      elements: [moved.id],
      relationships: [],
      message: `${named(moved.id)} was moved from (${moved.from.x}, ${moved.from.y}) to (${now.x}, ${now.y}) to make room for ${placement!.placed.map(named).join(", ")}: check it still reads as you arranged it`,
    });
  }
  return findings;
}

/**
 * A change that takes relationship `index` clear of every box but its own ends, tried on the
 * route before it is given: its waypoints dropped, or two waypoints going round the box it
 * crosses on whichever side makes the shorter route.
 */
function avoiding(page: DrawioPage, index: number, obstacle: string): string | undefined {
  const cells = new Map(page.cells.filter((cell) => cell.id !== undefined).map((cell) => [cell.id!, cell]));
  const wire = cells.get(`r:${index}`);
  const box = cells.get(`n:${obstacle}`)?.geometry;
  if (wire?.geometry === undefined || box === undefined) return undefined;
  const geometry = pageGeometry(page);
  const ends = [wire.source, wire.target];
  const clear = (points: Point[]) =>
    [...geometry.terminals].every(([id, terminal]) => ends.includes(id) || points.every((point, at) => at === 0 || lengthInside(points[at - 1]!, point, terminal.box, "box", 2) === 0));
  const routed = (waypoints: Point[]): Point[] | undefined => {
    const trial: DrawioCell = { ...wire, geometry: { ...wire.geometry!, points: waypoints } };
    return routeWire(trial, geometry)?.points;
  };
  const length = (points: Point[]) => points.reduce((sum, point, at) => (at === 0 ? 0 : sum + Math.hypot(point.x - points[at - 1]!.x, point.y - points[at - 1]!.y)), 0);

  if (wire.geometry.points.length > 0) {
    const without = routed([]);
    if (without !== undefined && clear(without)) return "remove its waypoints";
  }
  const current = routed(wire.geometry.points);
  if (current === undefined || current.length < 2) return undefined;
  const start = current[0]!;
  const end = current[current.length - 1]!;
  const lanes: Point[][] = [
    // Over and under the box, then round its left and right
    [{ x: start.x, y: box.y - AROUND }, { x: end.x, y: box.y - AROUND }],
    [{ x: start.x, y: box.y + box.height + AROUND }, { x: end.x, y: box.y + box.height + AROUND }],
    [{ x: box.x - AROUND, y: start.y }, { x: box.x - AROUND, y: end.y }],
    [{ x: box.x + box.width + AROUND, y: start.y }, { x: box.x + box.width + AROUND, y: end.y }],
  ].map((lane) => lane.map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) })));
  const best = lanes
    .map((lane) => ({ lane, route: routed(lane) }))
    .filter((trial): trial is { lane: Point[]; route: Point[] } => trial.route !== undefined && clear(trial.route))
    .sort((a, b) => length(a.route) - length(b.route))[0];
  return best === undefined ? undefined : `give it waypoints at ${best.lane.map((point) => `(${point.x}, ${point.y})`).join(", ")}`;
}
