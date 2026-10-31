/**
 * A page of cells written as a draw.io file: the inverse of `readDrawio` for what it reads,
 * so a page built from something else (a structured-exchange figure) can be opened in the
 * viewer and in touch-up, and read back.
 *
 * Labels are written as plain text, escaped: what a figure puts in a cell is a name, never
 * markup.
 */
import type { DrawioCell, DrawioPage, Geometry } from "./read.ts";

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\n/g, "&#10;");

const attribute = (name: string, value: string | undefined) => (value === undefined ? "" : ` ${name}="${escape(value)}"`);

function geometryXml(geometry: Geometry): string {
  const numbers = (["x", "y", "width", "height"] as const).map((name) => (geometry[name] === 0 ? "" : ` ${name}="${geometry[name]}"`)).join("");
  const inner = [
    geometry.points.length === 0 ? "" : `<Array as="points">${geometry.points.map((point) => `<mxPoint x="${point.x}" y="${point.y}"/>`).join("")}</Array>`,
    geometry.offset === undefined ? "" : `<mxPoint x="${geometry.offset.x}" y="${geometry.offset.y}" as="offset"/>`,
  ].join("");
  const open = `<mxGeometry${numbers}${geometry.relative ? ' relative="1"' : ""} as="geometry"`;
  return inner === "" ? `${open}/>` : `${open}>${inner}</mxGeometry>`;
}

function cellXml(cell: DrawioCell): string {
  const flags = `${cell.vertex ? ' vertex="1"' : ""}${cell.edge ? ' edge="1"' : ""}`;
  const head = `<mxCell${attribute("id", cell.id)}${attribute("value", cell.label === "" ? undefined : cell.label)}${attribute("style", cell.style === "" ? undefined : cell.style)}${flags}${attribute("parent", cell.parent)}${attribute("source", cell.source)}${attribute("target", cell.target)}`;
  return cell.geometry === undefined ? `${head}/>` : `${head}>${geometryXml(cell.geometry)}</mxCell>`;
}

/** One page as an uncompressed `<mxfile>`. */
export function writeDrawio(page: DrawioPage): string {
  return [
    '<mxfile host="pi-outpost">',
    `<diagram${attribute("name", page.name)}>`,
    "<mxGraphModel><root>",
    ...page.cells.map(cellXml),
    "</root></mxGraphModel>",
    "</diagram>",
    "</mxfile>",
    "",
  ].join("\n");
}
