/**
 * A draw.io diagram in a poster: a picture of one of its pages, drawn by draw.io's viewer in a
 * host that serves it, and kept as an SVG picture so it prints sharp (poster-drawio-pictures,
 * design 2). The frame keeps where it came from: `data-drawio`, the diagram's path from the
 * poster's directory, and `data-drawio-page`, the page's name or number from 1.
 *
 * Isomorphic.
 */

/** A diagram the host can draw: its path as a frame names it, and its pages' names. */
export interface DiagramChoice {
  path: string;
  pages: string[];
}

/** The attributes naming a frame's diagram and page. */
export const DRAWIO_ATTRIBUTE = "data-drawio";
export const DRAWIO_PAGE_ATTRIBUTE = "data-drawio-page";

/** Largest SVG put in a poster: a poster holds 8 MB, and a diagram this large embeds pictures of its own. */
export const MAX_DIAGRAM_SVG_BYTES = 2 * 1024 * 1024;

function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return btoa(binary);
}

/**
 * The SVG as a picture's source, with its size in CSS pixels for placing it in proportion.
 * Throws, saying why, for one too large or with no size to read.
 */
export function diagramPicture(svg: string): { src: string; width: number; height: number } {
  const bytes = new TextEncoder().encode(svg).length;
  if (bytes > MAX_DIAGRAM_SVG_BYTES) throw new Error(`its picture is ${Math.round(bytes / 1024)} kB, more than a poster takes (${MAX_DIAGRAM_SVG_BYTES / 1024 / 1024} MB)`);
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!root) throw new Error("the viewer drew no picture of it");
  const attribute = (name: string) => new RegExp(`\\s${name}="([^"]*)"`, "i").exec(root)?.[1];
  let width = Number.parseFloat(attribute("width") ?? "");
  let height = Number.parseFloat(attribute("height") ?? "");
  if (!(width > 0 && height > 0)) {
    const box = attribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
    if (box?.length === 4) [, , width, height] = box as [number, number, number, number];
  }
  if (!(width > 0 && height > 0)) throw new Error("its picture has no size");
  return { src: `data:image/svg+xml;base64,${base64(svg)}`, width, height };
}
