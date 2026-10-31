/**
 * Where a graph's elements go when it has an arrangement (structured-exchange-arrangement,
 * design 4): what the arrangement places stays there, and what it does not is put near what it
 * relates to.
 *
 * The automatic layout is a function of the whole graph, so one added element can move every
 * other — the instability that made a revised figure a fresh one to check by eye. Here an
 * arranged box is fixed. A new element takes the first free slot beside an element it relates
 * to, scanned in a fixed order; only when none is free are boxes moved, and those moves are
 * reported. A removed element leaves its place empty.
 *
 * Deterministic: document order, a fixed scan, no randomness.
 */
import type { DrawioPage } from "./drawio/read.ts";
import { cellStyle } from "./drawio/routes.ts";
import type { ArrangedPoint, ArrangedRelationship, ArrangementView } from "./structuredExchangeArrangement.ts";
import { elementKey, relationshipKeys, snap } from "./structuredExchangeArrangement.ts";
import { elementCellId, relationshipCellId } from "./structuredExchangeWiring.ts";
import type { StructuredElement, StructuredGraphData } from "./structuredExchange.ts";
import type { Orientation } from "./diagramOrientation.ts";

export interface PlacedBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Placement {
  boxes: PlacedBox[];
  /** Elements the arrangement placed. */
  arranged: string[];
  /** Elements placed here because the arrangement did not name them. */
  placed: string[];
  /** Arranged elements moved to make room, with where they were. */
  shifted: Array<{ id: string; from: ArrangedPoint }>;
  /** Element entries naming nothing the graph holds. */
  gone: string[];
}

/** Space kept between boxes along the reading direction, and across it (the layout's own). */
export const PLACEMENT_RANK_GAP = 64;
export const PLACEMENT_NODE_GAP = 24;
/** How far, in grid steps of the gaps, the scan looks before it makes room instead. */
const SCAN_RINGS = 4;

/** Whether the arrangement places anything in this graph: otherwise the automatic layout applies whole. */
export function arrangesAnything(data: StructuredGraphData, view: ArrangementView | undefined): boolean {
  return view !== undefined && data.nodes.some((node) => view.elements[elementKey(node)] !== undefined);
}

const overlaps = (a: PlacedBox, b: PlacedBox, margin: number) =>
  a.x < b.x + b.width + margin && b.x < a.x + a.width + margin && a.y < b.y + b.height + margin && b.y < a.y + a.height + margin;

/**
 * The graph's boxes with its arrangement applied. `size` gives each element's box, as the
 * figure measures it; `orientation` says which way ranks run, so a new element goes after what
 * it relates to in reading order.
 */
export function placeArranged(
  data: StructuredGraphData,
  view: ArrangementView,
  size: (node: StructuredElement) => { width: number; height: number },
  orientation: Orientation,
): Placement {
  const keys = new Map(data.nodes.map((node) => [node.id, elementKey(node)]));
  const boxes = new Map<string, PlacedBox>();
  const arranged: string[] = [];
  for (const node of data.nodes) {
    const at = view.elements[keys.get(node.id)!];
    if (at === undefined) continue;
    const { width, height } = size(node);
    boxes.set(node.id, { id: node.id, x: at.x, y: at.y, width, height });
    arranged.push(node.id);
  }
  const held = new Set(keys.values());
  const gone = Object.keys(view.elements).filter((key) => !held.has(key)).sort();

  const neighbours = new Map<string, string[]>();
  for (const edge of data.edges) {
    if (edge.from === edge.to) continue;
    neighbours.set(edge.from, [...(neighbours.get(edge.from) ?? []), edge.to]);
    neighbours.set(edge.to, [...(neighbours.get(edge.to) ?? []), edge.from]);
  }

  const landscape = orientation === "landscape";
  const free = (candidate: PlacedBox) => [...boxes.values()].every((other) => !overlaps(candidate, other, PLACEMENT_NODE_GAP));
  const placed: string[] = [];
  const shifted: Placement["shifted"] = [];

  // Unplaced elements, those related to something placed first, then the rest, each in document order
  const pending = data.nodes.filter((node) => !boxes.has(node.id));
  while (pending.length > 0) {
    const index = Math.max(0, pending.findIndex((node) => (neighbours.get(node.id) ?? []).some((other) => boxes.has(other))));
    const node = pending.splice(index, 1)[0]!;
    const { width, height } = size(node);
    const box = (x: number, y: number): PlacedBox => ({ id: node.id, ...snap({ x, y }), width, height });
    const anchors = (neighbours.get(node.id) ?? []).map((other) => boxes.get(other)).filter((other): other is PlacedBox => other !== undefined);
    const anchor = anchors[0];

    let chosen: PlacedBox | undefined;
    if (anchor === undefined) {
      // Related to nothing placed: after everything, in reading order
      const extent = [...boxes.values()];
      chosen = extent.length === 0
        ? box(PLACEMENT_NODE_GAP, PLACEMENT_NODE_GAP)
        : landscape
          ? box(Math.max(...extent.map((other) => other.x + other.width)) + PLACEMENT_RANK_GAP, Math.min(...extent.map((other) => other.y)))
          : box(Math.min(...extent.map((other) => other.x)), Math.max(...extent.map((other) => other.y + other.height)) + PLACEMENT_RANK_GAP);
    } else {
      // Next rank, then the rank before, then beside it, then rings further out
      const after = landscape ? { dx: anchor.width + PLACEMENT_RANK_GAP, dy: 0 } : { dx: 0, dy: anchor.height + PLACEMENT_RANK_GAP };
      const before = landscape ? { dx: -(width + PLACEMENT_RANK_GAP), dy: 0 } : { dx: 0, dy: -(height + PLACEMENT_RANK_GAP) };
      const across = landscape ? { dx: 0, dy: anchor.height + PLACEMENT_NODE_GAP } : { dx: anchor.width + PLACEMENT_NODE_GAP, dy: 0 };
      const stepAcross = landscape ? height + PLACEMENT_NODE_GAP : width + PLACEMENT_NODE_GAP;
      const candidates: PlacedBox[] = [];
      for (let ring = 0; ring <= SCAN_RINGS; ring++) {
        for (const base of [after, before]) {
          const shift = ring * stepAcross;
          for (const sign of ring === 0 ? [0] : [1, -1]) {
            candidates.push(landscape ? box(anchor.x + base.dx, anchor.y + sign * shift) : box(anchor.x + sign * shift, anchor.y + base.dy));
          }
        }
        for (const sign of [1, -1]) {
          const reach = ring + 1;
          candidates.push(landscape ? box(anchor.x, anchor.y + sign * reach * across.dy) : box(anchor.x + sign * reach * across.dx, anchor.y));
        }
      }
      chosen = candidates.find(free);
      if (chosen === undefined) {
        // No room near it: make room after it, moving what lies beyond in reading order
        const at = box(anchor.x + after.dx, anchor.y + after.dy);
        chosen = at;
        // Everything reaching the new box in reading order moves on together, by what clears the nearest
        const beyond = [...boxes.values()]
          .filter((other) => (landscape ? other.x + other.width + PLACEMENT_NODE_GAP > at.x : other.y + other.height + PLACEMENT_NODE_GAP > at.y))
          .sort((a, b) => a.id.localeCompare(b.id));
        const nearest = Math.min(...beyond.map((other) => (landscape ? other.x : other.y)));
        const room = Math.max(0, (landscape ? at.x + width : at.y + height) + PLACEMENT_RANK_GAP - nearest);
        for (const other of beyond) {
          if (room === 0) break;
          if (arranged.includes(other.id)) shifted.push({ id: other.id, from: { x: other.x, y: other.y } });
          if (landscape) other.x += room;
          else other.y += room;
        }
      }
    }
    boxes.set(node.id, chosen);
    placed.push(node.id);
  }

  return { boxes: data.nodes.map((node) => boxes.get(node.id)!), arranged, placed, shifted, gone };
}

/**
 * The arrangement a drawn page amounts to: every element's place, and every relationship's
 * fixed ends, bends and moved label. Recorded so the next version of the document finds them
 * (`ANewElementIsRecordedForNextTime`), and read back from touch-up the same way.
 */
export function viewFromPage(data: StructuredGraphData, page: DrawioPage, orientation?: Orientation): ArrangementView {
  const view: ArrangementView = { ...(orientation === undefined ? {} : { orientation }), elements: {}, relationships: {} };
  const cells = new Map(page.cells.filter((cell) => cell.id !== undefined).map((cell) => [cell.id!, cell]));
  for (const node of data.nodes) {
    const geometry = cells.get(elementCellId(node.id))?.geometry;
    if (geometry !== undefined) view.elements[elementKey(node)] = snap({ x: geometry.x, y: geometry.y });
  }
  relationshipKeys(data).forEach((key, index) => {
    const cell = cells.get(relationshipCellId(index));
    if (cell === undefined || cell.geometry === undefined) return;
    const style = cellStyle(cell.style, true);
    const fixed = (prefix: "exit" | "entry"): ArrangedPoint | undefined => {
      const x = Number(style[`${prefix}X`]);
      const y = Number(style[`${prefix}Y`]);
      return style[`${prefix}X`] === undefined || style[`${prefix}Y`] === undefined || !Number.isFinite(x) || !Number.isFinite(y) ? undefined : { x, y };
    };
    const entry: ArrangedRelationship = {};
    const exit = fixed("exit");
    const enter = fixed("entry");
    if (exit !== undefined) entry.exit = exit;
    if (enter !== undefined) entry.entry = enter;
    if (cell.geometry.points.length > 0) entry.waypoints = cell.geometry.points.map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) }));
    const offset = cell.geometry.offset ?? { x: 0, y: 0 };
    if (cell.geometry.x !== 0 || cell.geometry.y !== 0 || offset.x !== 0 || offset.y !== 0) {
      entry.label = { along: cell.geometry.x, ...(cell.geometry.y === 0 ? {} : { across: cell.geometry.y }), offset: { x: offset.x, y: offset.y } };
    }
    view.relationships[key] = entry;
  });
  return view;
}
