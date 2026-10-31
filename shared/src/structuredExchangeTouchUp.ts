/**
 * A structured-exchange graph arranged in draw.io's touch-up, read back (structured-exchange-arrangement,
 * design 6): the page the figure drew is opened in the touch-up, and what comes back is read into
 * the arrangement by identity — boxes' places, wires' ends, bends and labels.
 *
 * Only arrangement is taken. The document's content is the document's: a box's text edited, a
 * wire deleted or re-attached, a shape added — none of it changes the document from here, and
 * each is named so the reader knows it was not kept.
 */
import type { DrawioCell, DrawioPage } from "./drawio/read.ts";
import { cellStyle } from "./drawio/routes.ts";
import type { ArrangementView } from "./structuredExchangeArrangement.ts";
import { displayLabel } from "./structuredExchangeModel.ts";
import { viewFromPage } from "./structuredExchangePlacement.ts";
import type { StructuredGraphData } from "./structuredExchange.ts";
import type { Orientation } from "./diagramOrientation.ts";

export interface TouchUpReading {
  /** The arrangement the touch-up amounts to, over the arrangement it started from. */
  view: ArrangementView;
  /** What was done in the touch-up that is not arrangement, and so was not kept. */
  notKept: string[];
}

/** Style keys a touch-up may change and the arrangement keeps: where a wire meets its boxes. */
const ARRANGED_STYLE = /^(exit|entry)(X|Y|Dx|Dy|Perimeter)$/;

/**
 * The touch-up's `saved` page read against the `drawn` page it started from. Cells are matched by
 * id — the element and relationship cells the figure wrote — so nothing is matched by position or
 * by text.
 */
export function readTouchUp(
  data: StructuredGraphData,
  drawn: DrawioPage,
  saved: DrawioPage,
  current: ArrangementView | undefined,
  orientation: Orientation,
): TouchUpReading {
  const before = new Map(drawn.cells.filter((cell) => cell.id !== undefined).map((cell) => [cell.id!, cell]));
  const after = new Map(saved.cells.filter((cell) => cell.id !== undefined).map((cell) => [cell.id!, cell]));
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const name = (cell: DrawioCell): string => {
    if (cell.id?.startsWith("n:")) {
      const node = nodes.get(cell.id.slice(2));
      return `"${node === undefined ? cell.label : displayLabel(node)}"`;
    }
    const edge = cell.id?.startsWith("r:") ? data.edges[Number(cell.id.slice(2))] : undefined;
    if (edge === undefined) return cell.label === "" ? "a connector" : `"${cell.label}"`;
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    return `"${from === undefined ? edge.from : displayLabel(from)} → ${to === undefined ? edge.to : displayLabel(to)}"`;
  };
  const notKept: string[] = [];

  for (const [id, cell] of before) {
    if (!cell.vertex && !cell.edge) continue;
    const now = after.get(id);
    if (now === undefined) {
      notKept.push(`${name(cell)} was deleted: the document still holds it, so it is drawn again`);
      continue;
    }
    if (now.label !== cell.label) notKept.push(`the text of ${name(cell)} was changed to "${now.label}": the document's text is not changed from here`);
    if (cell.edge && (now.source !== cell.source || now.target !== cell.target)) {
      notKept.push(`${name(cell)} was attached to other boxes: a relationship's ends are the document's, so it keeps them`);
    }
    if (styleBeyondArrangement(cell.style, cell.edge) !== styleBeyondArrangement(now.style, now.edge)) {
      notKept.push(`the look of ${name(cell)} was changed: colours and styles come from the document's kinds and the project`);
    }
  }
  for (const [id, cell] of after) {
    if (before.has(id) || (!cell.vertex && !cell.edge)) continue;
    notKept.push(`${cell.vertex ? "a box" : "a connector"}${cell.label === "" ? "" : ` "${cell.label}"`} was added: the document is not changed from here`);
  }

  // Only the cells the figure drew, at the places and with the ends the touch-up left them
  const arranged: DrawioPage = {
    ...saved,
    cells: saved.cells.filter((cell) => cell.id !== undefined && before.has(cell.id) && (before.get(cell.id)!.source === cell.source) && (before.get(cell.id)!.target === cell.target)),
  };
  const recorded = viewFromPage(data, arranged, orientation);
  return {
    view: {
      orientation,
      elements: { ...current?.elements, ...recorded.elements },
      relationships: { ...current?.relationships, ...recorded.relationships },
    },
    notKept,
  };
}

/** A cell's style without what the arrangement keeps, in a stable order. */
function styleBeyondArrangement(style: string, edge: boolean): string {
  return Object.entries(cellStyle(style, edge))
    .filter(([key]) => !ARRANGED_STYLE.test(key))
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join(";");
}
