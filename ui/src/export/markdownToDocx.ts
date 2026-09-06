/**
 * Markdown, as Word structure.
 *
 * The document is parsed with the same remark stack the viewer renders through —
 * `remark-gfm` for tables and strikethrough, `remark-math` for equations, and
 * `normalizeMathDelimiters` ahead of both. That sharing is the point rather than a
 * convenience: the defect this module most needs to avoid is an export that
 * disagrees with the rendering the reader was looking at when they asked for it.
 * A second parser would make every disagreement possible; one parser makes a whole
 * class of them unrepresentable.
 *
 * What comes out is Word's own structure — heading styles, list numbering, table
 * rows — and never Markdown punctuation. A `#` that survives into the export is a
 * bug, not a heading.
 */
import {
  AlignmentType,
  BorderStyle,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  Math as MathEquation,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { Code, Heading, List, PhrasingContent, Root, RootContent, Table as MdTable } from "mdast";
import { normalizeMathDelimiters } from "../util/markdownMath";
import { latexToOmml } from "./mathmlToOmml";
import { xmlSafe } from "./xmlText";
import { renderDiagram, type DiagramImage } from "./mermaidToImage";

/** A block Word understands: everything here reduces to one of these two. */
export type DocxBlock = Paragraph | Table;

/** The face code is set in. Word resolves the first of these it has. */
const MONOSPACE = "Consolas, Courier New, monospace";

/** Bullets and numbers are indented by half an inch per level, as Word's own are. */
const INDENT_PER_LEVEL = 360;

/** The numbering definition ordered lists are drawn from; declared by `docxExport`. */
export const ORDERED_NUMBERING = "md-ordered";

/**
 * The document as a tree.
 *
 * `parse()` rather than `run()`: the plugins used here are parser extensions —
 * they teach micromark to recognise tables and `$…$`, and produce their nodes
 * during parsing. No transform pass is wanted, and running one would invite
 * plugins that rewrite the tree between what is read and what is rendered.
 */
export function parseMarkdown(text: string): Root {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .parse(normalizeMathDelimiters(text));
}

/** What can sit inside a paragraph: a run, a link, or a native equation. */
type InlineContent = TextRun | ExternalHyperlink | MathEquation | ImageRun;

/** Marks carried down the inline tree, since Word states them per run. */
type Marks = {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  code?: boolean;
};

function runOf(text: string, marks: Marks): TextRun {
  return new TextRun({
    text: xmlSafe(text),
    bold: marks.bold,
    italics: marks.italics,
    strike: marks.strike,
    ...(marks.code === true ? { font: MONOSPACE } : {}),
  });
}

/**
 * Inline content as runs.
 *
 * Word has no nesting inside a run: bold-inside-a-link is a run that is bold and a
 * hyperlink, not a hyperlink containing bold. The marks therefore travel down the
 * tree as a value and are applied at each leaf.
 */
function inlineRuns(nodes: readonly PhrasingContent[], marks: Marks = {}): InlineContent[] {
  const out: InlineContent[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        out.push(runOf(node.value, marks));
        break;
      case "strong":
        out.push(...inlineRuns(node.children, { ...marks, bold: true }));
        break;
      case "emphasis":
        out.push(...inlineRuns(node.children, { ...marks, italics: true }));
        break;
      case "delete":
        out.push(...inlineRuns(node.children, { ...marks, strike: true }));
        break;
      case "inlineCode":
        out.push(runOf(node.value, { ...marks, code: true }));
        break;
      case "link":
        // The children carry the label; the hyperlink carries the target. A link
        // whose runs were dropped would leave a target with nothing to click.
        out.push(
          new ExternalHyperlink({
            children: inlineRuns(node.children, marks),
            link: node.url,
          }),
        );
        break;
      case "break":
        out.push(new TextRun({ text: "", break: 1 }));
        break;
      case "image":
        // A Markdown image is not carried as a picture (see the capability's scope);
        // its alt text is the readable thing it has, and dropping it silently would
        // lose content the author wrote.
        out.push(runOf(node.alt ?? node.url, marks));
        break;
      case "inlineMath":
        out.push(...equationRuns(node.value, false, marks));
        break;
      default:
        // Anything the mapping does not know is still content: carry whatever text
        // hangs beneath it rather than dropping the node on the floor.
        out.push(...inlineRuns(childPhrasing(node), marks));
        break;
    }
  }
  return out;
}

/**
 * An equation, as a native Word equation where that is possible.
 *
 * The fallback is the point of the shape here: a formula the transform cannot model
 * comes back as its own LaTeX source in a monospace run, because a reader who sees
 * `\frac{a}{b}` knows what was meant, and a reader shown a confidently wrong
 * equation does not know anything is missing. One unmappable formula must never
 * cost the document.
 */
function equationRuns(latex: string, displayMode: boolean, marks: Marks): InlineContent[] {
  try {
    return [new MathEquation({ children: latexToOmml(latex, displayMode) })];
  } catch {
    return [runOf(latex, { ...marks, code: true })];
  }
}

/** The phrasing children of a node the mapping does not recognise, if it has any. */
function childPhrasing(node: RootContent): readonly PhrasingContent[] {
  const children = (node as { children?: unknown }).children;
  return Array.isArray(children) ? (children as PhrasingContent[]) : [];
}

const HEADING_FOR_DEPTH = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;

function headingBlock(node: Heading): Paragraph {
  return new Paragraph({
    heading: HEADING_FOR_DEPTH[Math.min(node.depth, 6) - 1],
    children: inlineRuns(node.children),
  });
}

/**
 * A code block, line by line.
 *
 * One paragraph per line rather than one paragraph with breaks: Word keeps a
 * paragraph together, and a long listing that cannot break across a page is a
 * listing that runs off the bottom of one. Leading whitespace is preserved by
 * carrying the line's text verbatim — the writer marks the run `xml:space="preserve"`.
 */
function codeBlocks(node: Code): Paragraph[] {
  return node.value.split("\n").map(
    (line) =>
      new Paragraph({
        // A blank line still needs a run, or the paragraph collapses and the
        // listing loses the gap the author put in it.
        children: [new TextRun({ text: xmlSafe(line === "" ? " " : line), font: MONOSPACE })],
        spacing: { before: 0, after: 0 },
      }),
  );
}

/**
 * How wide the text is on the page, in the pixels the writer measures images in.
 *
 * A Letter page with one-inch margins leaves 6.5 inches. The writer converts a
 * pixel to an EMU at 96 dpi (9525 EMU each), so 624 px is 5 943 600 EMU — the
 * figure the capability states. Anything wider is scaled down to it, keeping its
 * proportions, because a picture wider than the text block is a picture with its
 * right-hand side off the page.
 */
const TEXT_WIDTH_PX = 624;

/** A diagram's size on the page: its own, unless that is wider than the text. */
export function diagramSize(width: number, height: number): { width: number; height: number } {
  if (width <= TEXT_WIDTH_PX) return { width: Math.round(width), height: Math.round(height) };
  return { width: TEXT_WIDTH_PX, height: Math.round((height * TEXT_WIDTH_PX) / width) };
}

/** Whether a fence is a diagram rather than a listing. */
function isDiagram(node: Code): boolean {
  return (node.lang ?? "").toLowerCase() === "mermaid";
}

/**
 * Every diagram in the document, drawn before the tree is walked.
 *
 * Rendering is asynchronous and the walk is not, so the pictures are made first
 * and looked up by node during it. A diagram that will not draw maps to `undefined`
 * and falls back to its source, which is a local failure by design: one diagram
 * that cannot be produced must not cost the document.
 */
async function renderDiagrams(root: Root): Promise<Map<Code, DiagramImage>> {
  const fences: Code[] = [];
  const walk = (node: { type: string; children?: unknown[] }) => {
    if (node.type === "code" && isDiagram(node as Code)) fences.push(node as Code);
    for (const child of (node.children ?? []) as { type: string; children?: unknown[] }[]) walk(child);
  };
  walk(root);

  const drawn = new Map<Code, DiagramImage>();
  for (const [index, fence] of fences.entries()) {
    try {
      drawn.set(fence, await renderDiagram(fence.value, `docx-export-${index}`));
    } catch {
      // Left out of the map on purpose: the walk falls back to the source text.
    }
  }
  return drawn;
}

/**
 * A diagram as a picture, vector with a raster behind it.
 *
 * The raster is not optional — it is what a reader without SVG support sees, and
 * the writer's own type requires it. Word draws the vector.
 */
function diagramBlock(image: DiagramImage): Paragraph {
  const transformation = diagramSize(image.width, image.height);
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new ImageRun({
        type: "svg",
        // Bytes, not the markup string: the writer reads a `string` here as base64
        // and tries to decode it, so handing it SVG source throws before a single
        // diagram is written. Encoding it makes the intent unambiguous.
        data: new TextEncoder().encode(image.svg),
        fallback: { type: "png", data: image.png },
        transformation,
      }),
    ],
  });
}

/**
 * Where ordered lists are up to, and whether we are inside a quotation.
 *
 * The quotation depth is carried rather than applied afterwards: a `Paragraph` is
 * built from its options and cannot be re-styled once made, so the indent and the
 * rule have to be known at the point each paragraph is constructed.
 */
type ListState = { instance: number; quoteDepth: number; diagrams: Map<Code, DiagramImage> };

/** Indented and ruled on the left, which is what a quotation looks like in Word. */
function quoteStyle(depth: number) {
  return depth === 0
    ? {}
    : {
        indent: { left: INDENT_PER_LEVEL * depth },
        border: { left: { style: BorderStyle.SINGLE, size: 12, color: "CCCCCC", space: 12 } },
      };
}

/**
 * A list, flattened.
 *
 * Word has no nested list element: nesting is a level on each paragraph, and the
 * numbering definition supplies the marker. An ordered list takes a fresh
 * `instance` so the second list in a document starts at 1 rather than continuing
 * the first one's count.
 */
function listBlocks(node: List, state: ListState, level = 0): DocxBlock[] {
  const ordered = node.ordered === true;
  const instance = ordered ? state.instance++ : 0;
  const out: DocxBlock[] = [];

  for (const item of node.children) {
    let first = true;
    for (const child of item.children) {
      if (child.type === "list") {
        out.push(...listBlocks(child, state, level + 1));
        continue;
      }
      if (child.type === "paragraph") {
        out.push(
          new Paragraph({
            children: inlineRuns(child.children),
            // Only the item's first paragraph carries the marker; a second one is a
            // continuation of the same item and must not be numbered again.
            ...(first
              ? ordered
                ? { numbering: { reference: ORDERED_NUMBERING, level, instance } }
                : { bullet: { level } }
              : { indent: { left: INDENT_PER_LEVEL * (level + 1) } }),
          }),
        );
        first = false;
        continue;
      }
      out.push(...blocksFrom([child], state));
    }
  }
  return out;
}

function tableBlock(node: MdTable): Table {
  const rows = node.children.map(
    (row, index) =>
      new TableRow({
        // The header row repeats when the table breaks across pages, which is what
        // marking it as a header is actually for.
        tableHeader: index === 0,
        children: row.children.map(
          (cell) =>
            new TableCell({
              children: [new Paragraph({ children: inlineRuns(cell.children) })],
            }),
        ),
      }),
  );
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

/** A horizontal rule: an empty paragraph wearing a bottom border. */
function thematicBreakBlock(): Paragraph {
  return new Paragraph({
    children: [],
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } },
  });
}

function blocksFrom(nodes: readonly RootContent[], state: ListState): DocxBlock[] {
  const out: DocxBlock[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "heading":
        out.push(headingBlock(node));
        break;
      case "paragraph":
        out.push(new Paragraph({ children: inlineRuns(node.children), ...quoteStyle(state.quoteDepth) }));
        break;
      case "list":
        out.push(...listBlocks(node, state));
        break;
      case "table":
        out.push(tableBlock(node));
        break;
      case "code": {
        // A diagram that drew becomes a picture; one that did not falls back to its
        // source, which is still the thing the author wrote.
        const drawn = state.diagrams.get(node);
        if (drawn === undefined) out.push(...codeBlocks(node));
        else out.push(diagramBlock(drawn));
        break;
      }
      case "blockquote":
        out.push(...blocksFrom(node.children, { ...state, quoteDepth: state.quoteDepth + 1 }));
        break;
      case "thematicBreak":
        out.push(thematicBreakBlock());
        break;
      case "math":
        // A display equation is a block of its own, centred — never folded into the
        // paragraph beside it, which is the distinction the source drew by using
        // `$$` and the reader saw on screen.
        out.push(
          new Paragraph({
            children: equationRuns(node.value, true, {}),
            alignment: AlignmentType.CENTER,
          }),
        );
        break;
      default: {
        // Unknown block: keep whatever text it holds rather than losing it.
        const runs = inlineRuns(childPhrasing(node));
        if (runs.length > 0) out.push(new Paragraph({ children: runs }));
        break;
      }
    }
  }
  return out;
}

/**
 * The document's blocks, in the order it declares them.
 *
 * Asynchronous only because diagrams have to be drawn, which happens once up front
 * rather than during the walk: the mapping itself stays a plain recursive function
 * over the tree, which is much easier to reason about than one that awaits inside
 * itself.
 */
export async function markdownToDocx(text: string): Promise<DocxBlock[]> {
  const root = parseMarkdown(text);
  const diagrams = await renderDiagrams(root);
  return blocksFrom(root.children, { instance: 0, quoteDepth: 0, diagrams });
}
