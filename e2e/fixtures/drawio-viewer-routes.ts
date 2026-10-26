/**
 * The routes the vendored draw.io viewer gives a diagram's wires, and its labels' boxes, read
 * from the viewer itself in a page: the ground truth drawio_check's routing is held to
 * (drawio-wire-overlaps, design 3). Model coordinates: scale 1, no translate.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

export const DRAWIO_VIEWER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "web", "public", "vendor", "drawio", "viewer-static.min.js");

export interface ViewerEdge {
  id: string;
  points: Array<{ x: number; y: number }>;
  label?: { x: number; y: number; width: number; height: number };
}

/** Loads the viewer into a blank page, once. */
export async function loadViewer(page: Page): Promise<void> {
  await page.setContent("<!doctype html><html><body><div id=g style='width:4000px;height:4000px'></div></body></html>");
  await page.addScriptTag({ path: DRAWIO_VIEWER });
}

/** Every page's edges, by page name, for one .drawio text. */
export async function viewerRoutes(page: Page, xml: string): Promise<Record<string, ViewerEdge[]>> {
  return (await page.evaluate((text) => {
    const w = window as unknown as Record<string, any>;
    const doc = w.mxUtils.parseXml(text);
    const diagrams = [...doc.documentElement.getElementsByTagName("diagram")] as Element[];
    const models = diagrams.length > 0
      ? diagrams.map((diagram) => [diagram.getAttribute("name") ?? "", diagram.firstElementChild ?? w.mxUtils.parseXml(w.Graph.decompress(diagram.textContent)).documentElement] as const)
      : [["Page-1", doc.documentElement] as const];
    const result: Record<string, unknown[]> = {};
    for (const [name, node] of models) {
      const container = document.getElementById("g")!;
      container.innerHTML = "";
      const graph = new w.Graph(container);
      new w.mxCodec(node.ownerDocument).decode(node, graph.getModel());
      graph.view.scale = 1;
      graph.view.setTranslate(0, 0);
      graph.refresh();
      const edges: unknown[] = [];
      for (const cell of Object.values(graph.getModel().cells) as any[]) {
        if (!cell.edge) continue;
        const state = graph.view.getState(cell);
        if (!state?.absolutePoints) continue;
        const text = state.text?.boundingBox;
        edges.push({
          id: cell.id,
          points: state.absolutePoints.map((p: { x: number; y: number }) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 })),
          ...(text && cell.value ? { label: { x: Math.round(text.x), y: Math.round(text.y), width: Math.round(text.width), height: Math.round(text.height) } } : {}),
        });
      }
      result[name] = edges;
      graph.destroy();
    }
    return result;
  }, xml)) as Record<string, ViewerEdge[]>;
}

type Point = { x: number; y: number };

/**
 * The route without points lying on the segment between their neighbours, or on the point
 * before: the viewer sometimes keeps such a point where the port drops it, which draws the same
 * line and crosses the same boxes.
 */
export function straightened(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last !== undefined && Math.abs(last.x - point.x) <= 0.5 && Math.abs(last.y - point.y) <= 0.5) continue;
    while (out.length >= 2) {
      const [a, b] = [out[out.length - 2]!, out[out.length - 1]!];
      const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
      const onward = (b.x - a.x) * (point.x - b.x) + (b.y - a.y) * (point.y - b.y) >= 0;
      if (Math.abs(cross) <= 0.5 * Math.hypot(point.x - a.x, point.y - a.y) && onward) out.pop();
      else break;
    }
    out.push(point);
  }
  return out;
}

const within = (a: Point[], b: Point[]) => a.length === b.length && a.every((point, index) => Math.abs(point.x - b[index]!.x) <= 0.5 && Math.abs(point.y - b[index]!.y) <= 0.5);

/** The same route, point for point within half a unit, or once straightened. */
export function sameRoute(ours: Point[], viewer: Point[]): boolean {
  return within(ours, viewer) || within(straightened(ours), straightened(viewer));
}
