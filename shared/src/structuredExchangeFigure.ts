/**
 * A figure as data, so that two renderers cannot disagree about it.
 *
 * The diagrams are drawn twice: by React in a browser, where they can be pointed at
 * and dragged, and by a serializer in a process with no browser at all, so the agent
 * can write one to disk. The obvious way to do that is to write the picture twice,
 * and it is the way that guarantees the two drift — silently, because nobody opens
 * both and compares them.
 *
 * So the picture is computed once, here, as a list of shapes with the attributes they
 * are drawn with. What each side then does is mechanical: one maps a shape to an SVG
 * element, the other to a string. Neither decides anything. Geometry, colour and text
 * — everything that could differ — is decided before either of them sees it.
 *
 * Nothing here imports React, touches a DOM, or measures anything.
 */
import {
  changeLines,
  LINE_HEIGHT,
  wrapLabel,
} from "./structuredExchangeText.ts";
import {
  assignTints,
  INK,
  kindsPresent,
  MUTED,
  PAPER,
  RELATIONSHIP_PAINT,
  ROLE_PAINT,
  ROLES,
  type Tint,
} from "./structuredExchangePalette.ts";
import { boxHeight, boxWidthWithChanges, changeText } from "./structuredExchangeText.ts";
import { orientationFor, READING_WIDTH, type Orientation } from "./diagramOrientation.ts";
import {
  displayLabel,
  edgePath,
  edgeSummary,
  elementRole,
  elementSummary,
  encloseMembers,
  fieldChanges,
  filterKey,
  isHidden,
  layoutGraph,
  layoutSequence,
  messageSummary,
  NOTHING_HIDDEN,
  pathExtent,
  relationshipRole,
  resolveViewpoint,
  ROLE_LABEL,
  sameNarrowing,
  SELF_LOOP,
  type Box,
  type ChangeRole,
  type FieldChange,
  type Narrowing,
  type Nudge,
} from "./structuredExchangeModel.ts";
import type {
  StructuredElement,
  StructuredGraphData,
  StructuredSequenceData,
  StructuredViewpoint,
} from "./structuredExchange.ts";

/** A shape, with everything needed to draw it and nothing else. */
export type Primitive = PrimitiveShape & {
  /**
   * Rendered as `data-*`, on the shape rather than on its group.
   *
   * An edge is three overlaid paths — the role halo, the line, and in a browser a
   * wide invisible one to point at — and which is which is a property of the shape,
   * not of the relationship they all belong to.
   */
  data?: Record<string, string>;
};

type PrimitiveShape =
  | {
      shape: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
      rx?: number;
      fill?: string;
      stroke?: string;
      strokeWidth?: number;
      strokeDasharray?: string;
      opacity?: number;
    }
  | {
      shape: "text";
      x: number;
      y: number;
      text: string;
      fontSize: number;
      fill: string;
      fontFamily?: string;
      fontWeight?: number;
      textAnchor?: "start" | "middle" | "end";
      opacity?: number;
      /** The halo a label over a line is drawn with, so it stays readable on it. */
      stroke?: string;
      strokeWidth?: number;
      paintOrder?: "stroke";
      /** Carried through to `data-testid`, for the assertions that name it. */
      testId?: string;
    }
  | {
      shape: "line";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      stroke: string;
      strokeWidth?: number;
      strokeDasharray?: string;
      opacity?: number;
      markerEnd?: string;
    }
  | {
      shape: "path";
      d: string;
      stroke?: string;
      fill?: string;
      strokeWidth?: number;
      strokeDasharray?: string;
      opacity?: number;
      strokeLinecap?: "round";
      markerEnd?: string;
    };

/**
 * Shapes that belong to one thing in the document.
 *
 * A box is a rectangle and its lines of text, and a reader points at all of it at
 * once. Grouping is also what carries the identity back out: `data-element-id` on the
 * group is how a rendering says which declared element this drawing is.
 */
export type FigureGroup = {
  id: string;
  /** Rendered as `data-*` attributes, and serialized as the same. */
  data?: Record<string, string>;
  /** The `<title>`: what a pointer or a screen reader gets. */
  title?: string;
  /** Applied to the group, the way a dimmed thing is dimmed as a whole. */
  opacity?: number;
  /** Carried through to `data-testid`, for the assertions that name it. */
  testId?: string;
  primitives: Primitive[];
  /**
   * Groups inside this one.
   *
   * One level of nesting, and it earns its keep: the key is one thing a reader looks
   * at and each of its entries is separately switchable, so it needs both an outer
   * group to be found by and an inner group per entry to be clicked on.
   */
  groups?: FigureGroup[];
};

/** An arrowhead, which cannot inherit the colour of the line it ends. */
export type FigureMarker = { id: string; paint: string };

export type Figure = {
  width: number;
  height: number;
  viewBox: string;
  /** What a screen reader is told the picture is. */
  ariaLabel: string;
  background: string;
  markers: FigureMarker[];
  groups: FigureGroup[];
  /**
   * What this figure is not showing, when it is narrowed.
   *
   * Part of the figure rather than of the page around it, because a figure that
   * leaves — downloaded, or written to disk by the agent — has to keep saying how
   * much of the document it shows. `ReaderMayAdjustAndNarrowTheView` requires it of
   * the interactive export, and a figure written to a file is no different.
   */
  narrowing?: string;
  /**
   * Which way this figure was drawn, when it had a choice.
   *
   * Reported rather than inferred from the extent: a control has to say what the
   * diagram is currently drawn in, and a tall landscape diagram would read as
   * portrait to anything that guessed from the shape. Absent for a figure with no
   * orientation to choose — a sequence.
   */
  orientation?: Orientation;
};

export const FIGURE_FONT = "system-ui, sans-serif";

/**
 * A box, as the shapes it is drawn from.
 *
 * The decisions here were in a React component. None of them were React's: which
 * colour a role takes, how thick its outline is, where the first baseline sits so a
 * stack of lines is centred. They are arithmetic on the label and the role, and they
 * belong where both renderers can reach them.
 */
export function boxPrimitives(box: {
  x: number;
  y: number;
  width: number;
  height: number;
  role: ChangeRole;
  label: string;
  tint?: Tint;
  changes: FieldChange[];
  anchor?: "start" | "middle";
}): Primitive[] {
  const rolePaint = ROLE_PAINT[box.role];
  /**
   * Type and role on channels that do not compete.
   *
   * The role may take the outline colour — it is the approval signal and has to be
   * unmissable — but the type keeps the fill *and* the dash pattern, so two types
   * sharing a role are still told apart. Before this, every added relationship and
   * every added element was drawn in one green regardless of what it was.
   */
  const paint = {
    fill: box.tint?.fill ?? rolePaint.fill,
    stroke: box.role === "unchanged" ? (box.tint?.stroke ?? rolePaint.stroke) : rolePaint.stroke,
    text: rolePaint.text === MUTED ? MUTED : INK,
  };
  const outline = box.role === "added" || box.role === "changed" ? 2 : 1.2;
  // Context is dimmed rather than dashed: the dash says what kind of thing it is.
  const opacity = box.role === "context" ? 0.62 : 1;
  const anchor = box.anchor ?? "start";
  const lines = wrapLabel(box.label, box.width);
  const written = changeLines(box.changes, box.width);
  const totalLines = lines.length + written.length;
  const firstBaseline = box.y + box.height / 2 - ((totalLines - 1) * LINE_HEIGHT) / 2 + 4;
  const textX = anchor === "middle" ? box.x + box.width / 2 : box.x + 8;

  const primitives: Primitive[] = [
    {
      shape: "rect",
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      rx: 5,
      fill: paint.fill,
      stroke: paint.stroke,
      strokeWidth: outline,
      ...(box.tint?.dash === undefined ? {} : { strokeDasharray: box.tint.dash }),
      opacity,
    },
  ];
  lines.forEach((line, index) => {
    primitives.push({
      shape: "text",
      x: textX,
      y: firstBaseline + index * LINE_HEIGHT,
      text: line,
      fontSize: 11,
      fill: paint.text,
      fontFamily: FIGURE_FONT,
      textAnchor: anchor,
      opacity,
    });
  });
  written.forEach((line, index) => {
    primitives.push({
      shape: "text",
      x: textX,
      y: firstBaseline + (lines.length + index) * LINE_HEIGHT,
      text: line,
      fontSize: 9,
      fontWeight: 600,
      fill: paint.text,
      fontFamily: FIGURE_FONT,
      textAnchor: anchor,
      opacity,
      testId: "field-changes",
    });
  });
  return primitives;
}

/* ── Serializing ────────────────────────────────────────────────────────────── */

/** `&`, `<` and `>` in text a producer supplied. Attribute values take quotes too. */
function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

function attributes(pairs: [string, string | number | undefined][]): string {
  return pairs
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => ` ${name}="${escapeAttribute(String(value))}"`)
    .join("");
}

function primitiveMarkup(primitive: Primitive): string {
  const data: [string, string | undefined][] = Object.entries(primitive.data ?? {}).map(
    ([name, value]) => [`data-${name}`, value],
  );
  switch (primitive.shape) {
    case "rect":
      return `<rect${attributes([
        ["x", primitive.x],
        ["y", primitive.y],
        ["width", primitive.width],
        ["height", primitive.height],
        ["rx", primitive.rx],
        ["fill", primitive.fill],
        ["stroke", primitive.stroke],
        ["stroke-width", primitive.strokeWidth],
        ["stroke-dasharray", primitive.strokeDasharray],
        ["opacity", primitive.opacity],
        ...data,
      ])} />`;
    case "text":
      return `<text${attributes([
        ["x", primitive.x],
        ["y", primitive.y],
        ["font-size", primitive.fontSize],
        ["font-family", primitive.fontFamily],
        ["font-weight", primitive.fontWeight],
        ["text-anchor", primitive.textAnchor],
        ["fill", primitive.fill],
        ["stroke", primitive.stroke],
        ["stroke-width", primitive.strokeWidth],
        ["paint-order", primitive.paintOrder],
        ["opacity", primitive.opacity],
        ["data-testid", primitive.testId],
        ...data,
      ])}>${escapeText(primitive.text)}</text>`;
    case "line":
      return `<line${attributes([
        ["x1", primitive.x1],
        ["y1", primitive.y1],
        ["x2", primitive.x2],
        ["y2", primitive.y2],
        ["stroke", primitive.stroke],
        ["stroke-width", primitive.strokeWidth],
        ["stroke-dasharray", primitive.strokeDasharray],
        ["opacity", primitive.opacity],
        ["marker-end", primitive.markerEnd === undefined ? undefined : `url(#${primitive.markerEnd})`],
        ...data,
      ])} />`;
    case "path":
      return `<path${attributes([
        ["d", primitive.d],
        ["stroke", primitive.stroke],
        ["fill", primitive.fill ?? "none"],
        ["stroke-width", primitive.strokeWidth],
        ["stroke-dasharray", primitive.strokeDasharray],
        ["stroke-linecap", primitive.strokeLinecap],
        ["opacity", primitive.opacity],
        ["marker-end", primitive.markerEnd === undefined ? undefined : `url(#${primitive.markerEnd})`],
        ...data,
      ])} />`;
  }
}

function markerMarkup(marker: FigureMarker): string {
  return (
    `<marker id="${escapeAttribute(marker.id)}" markerWidth="7" markerHeight="7" refX="9" refY="5"` +
    ` viewBox="0 0 10 10" markerUnits="userSpaceOnUse" orient="auto">` +
    `<path d="M0,0 L10,5 L0,10 z" fill="${escapeAttribute(marker.paint)}" /></marker>`
  );
}

/**
 * The figure as one SVG file, for a caller with no browser.
 *
 * Self-contained on purpose: no stylesheet, no script, no external font file, no
 * reference to anything this application serves. Colours are attributes and the font
 * is named as a family, so the file draws the same picture wherever it is opened —
 * which is the whole point of a figure that can leave.
 */
export function serializeFigure(figure: Figure): string {
  const groupMarkup = (group: FigureGroup): string => {
    const data = Object.entries(group.data ?? {}).map(([name, value]): [string, string] => [`data-${name}`, value]);
    const title = group.title === undefined ? "" : `<title>${escapeText(group.title)}</title>`;
    const rest: [string, string | number | undefined][] = [
      ["opacity", group.opacity],
      ["data-testid", group.testId],
    ];
    return (
      `<g${attributes([...data, ...rest])}>${title}` +
      group.primitives.map(primitiveMarkup).join("") +
      (group.groups ?? []).map(groupMarkup).join("") +
      `</g>`
    );
  };
  const body = figure.groups.map(groupMarkup).join("");
  const defs =
    figure.markers.length === 0 ? "" : `<defs>${figure.markers.map(markerMarkup).join("")}</defs>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" role="img"` +
    attributes([
      ["aria-label", figure.ariaLabel],
      ["viewBox", figure.viewBox],
      ["width", figure.width],
      ["height", figure.height],
    ]) +
    `>` +
    `<rect${attributes([
      ["x", figure.viewBox.split(" ")[0]],
      ["y", figure.viewBox.split(" ")[1]],
      ["width", figure.width],
      ["height", figure.height],
      ["fill", figure.background],
    ])} />` +
    defs +
    body +
    `</svg>`
  );
}

/* ── The key, inside the picture ────────────────────────────────────────────── */

const LEGEND_ROW = 17;
const LEGEND_GAP = 18;
const LEGEND_TITLE = 92;

/**
 * The width the key wraps at.
 *
 * Bounded rather than following the canvas: a wide diagram spread its key so far
 * apart that scanning for one meant scrolling. A key is read as a block, and the
 * block does not get wider because the drawing did.
 */
const LEGEND_MEASURE = 860;

function legendMeasure(width: number): number {
  return Math.min(width, LEGEND_MEASURE);
}

/** One line of the key: what the swatches mean, and the swatches. */
export type LegendEntry = {
  label: string;
  fill: string;
  stroke: string;
  /** The dash the thing is actually drawn with, so the key matches the picture. */
  dashed?: string;
  /** Dimmed the way the diagram dims it — how context is marked now. */
  faded?: boolean;
  /** Set when this entry names a type the reader can show and hide. */
  toggles?: boolean;
  /** The qualified name this entry switches — see `filterKey`. */
  key?: string;
  hidden?: boolean;
};

export type LegendGroup = {
  title: string;
  sample: "box" | "line";
  entries: LegendEntry[];
};

export function entryWidth(label: string): number {
  // Room for the " (hidden)" a switched-off entry grows, so the key does not reflow
  // under the reader as they toggle things.
  return 16 + 5 + (label.length + 9) * 5.6 + LEGEND_GAP;
}

/** Rows a group needs, so the canvas can make room before anything is drawn. */
function groupRows(group: LegendGroup, width: number): number {
  const measure = legendMeasure(width);
  let rows = 1;
  let cursor = 0;
  for (const entry of group.entries) {
    const needed = entryWidth(entry.label);
    if (cursor > 0 && LEGEND_TITLE + cursor + needed > measure - 20) {
      rows += 1;
      cursor = 0;
    }
    cursor += needed;
  }
  return rows;
}

/**
 * The narrowest canvas the key can be laid out on without anything falling off it.
 *
 * The schema allows a type name of a hundred characters, and the canvas width came
 * from the graph alone — so a narrow diagram with long type names drew a key that ran
 * past the viewBox and was simply cut. Wrapping cannot rescue an entry that is wider
 * than every line available to it, so the widest single entry sets a floor.
 */
export function legendMinimumWidth(groups: LegendGroup[]): number {
  const widest = groups
    .flatMap((group) => group.entries)
    .reduce((wide, entry) => Math.max(wide, entryWidth(entry.label)), 0);
  return widest === 0 ? 0 : Math.min(LEGEND_TITLE + widest + 32, LEGEND_MEASURE);
}

/** How tall the whole key will be. */
export function legendHeight(groups: LegendGroup[], width: number): number {
  const populated = groups.filter((group) => group.entries.length > 0);
  if (populated.length === 0) return 0;
  return populated.reduce((rows, group) => rows + groupRows(group, width), 0) * LEGEND_ROW + 12;
}

/**
 * The key as groups of shapes, laid out where it will be drawn.
 *
 * Inside the picture rather than beside it in HTML, because the diagram is meant to
 * leave this application — a key that stays behind on the page turns an exported
 * figure into a set of unexplained colours.
 *
 * Elements and relationships get a line each, and a relationship's swatch is a line
 * rather than a box: run together, a reader had to work out which of two vocabularies
 * a name belonged to, which is the one thing a key must not make them do.
 */
export function legendGroups(
  groups: LegendGroup[],
  x: number,
  y: number,
  width: number,
): FigureGroup[] {
  const populated = groups.filter((group) => group.entries.length > 0);
  if (populated.length === 0) return [];

  const measure = legendMeasure(width);
  const inner: FigureGroup[] = [];
  let row = 0;

  for (const group of populated) {
    const startedAt = row;
    let cursor = 0;
    const entries: FigureGroup[] = [];

    for (const entry of group.entries) {
      const needed = entryWidth(entry.label);
      if (cursor > 0 && LEGEND_TITLE + cursor + needed > measure - 20) {
        row += 1;
        cursor = 0;
      }
      const at = x + LEGEND_TITLE + cursor;
      const top = y + row * LEGEND_ROW;
      cursor += needed;

      const swatch: Primitive =
        group.sample === "line"
          ? {
              shape: "line",
              x1: at,
              y1: top + 5,
              x2: at + 16,
              y2: top + 5,
              stroke: entry.stroke,
              strokeWidth: 1.6,
              ...(entry.dashed === undefined ? {} : { strokeDasharray: entry.dashed }),
            }
          : {
              shape: "rect",
              x: at,
              y: top,
              width: 16,
              height: 10,
              rx: 2,
              fill: entry.fill,
              stroke: entry.stroke,
              strokeWidth: 1.2,
              ...(entry.dashed === undefined ? {} : { strokeDasharray: entry.dashed }),
            };

      entries.push({
        id: `legend-${entry.key ?? entry.label}`,
        data: {
          "legend-entry": entry.key ?? entry.label,
          // Only a type entry switches something. A role entry explains the picture
          // and has nothing to hide, so a browser must not offer to click it.
          ...(entry.toggles === true && entry.key !== undefined ? { toggles: "true" } : {}),
          ...(entry.faded === true ? { faded: "true" } : {}),
          ...(entry.hidden === true ? { hidden: "true" } : {}),
        },
        opacity: entry.hidden === true ? 0.45 : entry.faded === true ? 0.62 : 1,
        primitives: [
          swatch,
          {
            shape: "text",
            x: at + 21,
            y: top + 9,
            text: entry.hidden === true ? `${entry.label} (hidden)` : entry.label,
            fontSize: 9,
            fill: MUTED,
            fontFamily: FIGURE_FONT,
          },
        ],
      });
    }

    inner.push({
      id: `legend-title-${group.title}`,
      primitives: [
        {
          shape: "text",
          x,
          y: y + startedAt * LEGEND_ROW + 9,
          text: group.title,
          fontSize: 9,
          fontWeight: 600,
          fill: MUTED,
          fontFamily: FIGURE_FONT,
          testId: "legend-group",
        },
      ],
    });
    inner.push(...entries);
    row += 1;
  }
  // Drawn in the SVG rather than beside it in HTML, because the diagram is meant to
  // leave this application — a key that stays behind turns an exported figure into a
  // set of unexplained colours.
  return [{ id: "diagram-legend", testId: "diagram-legend", primitives: [], groups: inner }];
}

/** The statement a figure makes about itself is set smaller than a label, and lined as such. */
const NOTE_LINE_HEIGHT = 12;
const NOTE_CHAR_WIDTH = 5.2;

/**
 * A statement broken into lines that fit the canvas, at word boundaries, and never
 * shortened.
 *
 * Not `wrapLabel`: a label is capped at a few lines and ellipsised, which is right for a
 * box and wrong here — a viewpoint's concern is what the figure is required to state,
 * and a figure that cut it off would say less than it was drawn for.
 */
export function wrapNote(text: string, width: number): string[] {
  const perLine = Math.max(Math.floor((width - 24) / NOTE_CHAR_WIDTH), 20);
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter((part) => part !== "")) {
    if (current === "") current = word;
    else if (current.length + 1 + word.length <= perLine) current = `${current} ${word}`;
    else {
      lines.push(current);
      current = word;
    }
    // A single word longer than the line is broken rather than allowed to run off.
    while (current.length > perLine) {
      lines.push(current.slice(0, perLine));
      current = current.slice(perLine);
    }
  }
  if (current !== "") lines.push(current);
  return lines;
}

/**
 * A concern without the full stops and spaces it may end in, so the statement adds its
 * own stop exactly once.
 *
 * A scan from the end, not `replace(/[.\s]+$/)`: the concern is producer text, and that
 * pattern backtracks quadratically on a long run of whitespace that does not reach the
 * end — a document could make drawing its own figure slow.
 */
function withoutTrailingStop(text: string): string {
  let end = text.length;
  while (end > 0 && (text[end - 1] === "." || /\s/.test(text[end - 1]))) end -= 1;
  return text.slice(0, end);
}

/**
 * What a figure says about itself, or undefined when there is nothing to say.
 *
 * Without a viewpoint this is the sentence narrowed figures have always carried, word
 * for word: a figure that declares no viewpoint must not change because viewpoints
 * exist. With one, the figure names it and the concern it frames first, so a figure
 * lifted out of its report still says what it is a reading of — and says so when what
 * it shows has been adjusted beyond what the viewpoint alone would hide.
 */
function figureStatement(
  data: StructuredGraphData,
  shown: StructuredGraphData,
  hidden: Narrowing,
  isProposal: boolean,
  viewpoint: StructuredViewpoint | undefined,
): string | undefined {
  const counts =
    `${shown.nodes.length} of ${data.nodes.length} elements and ` +
    `${shown.edges.length} of ${data.edges.length} relationships shown.` +
    (isProposal ? " Hidden types are still part of the proposal." : "");
  if (viewpoint === undefined) return hidden.size === 0 ? undefined : `Filtered view: ${counts}`;
  const adjusted = !sameNarrowing(hidden, resolveViewpoint(data, viewpoint));
  return (
    `Viewpoint: ${viewpoint.label} — ${withoutTrailingStop(viewpoint.concern)}` +
    (adjusted ? " (adjusted)." : ".") +
    (hidden.size === 0 ? "" : ` ${counts}`)
  );
}

/* ── The graph ──────────────────────────────────────────────────────────────── */

/** A marker id for a colour, since a hex is not a valid id on its own. */
export function markerId(prefix: string, paint: string): string {
  return `${prefix}-${paint.replace("#", "")}`;
}

/** Each box is sized to its own contents, so one long label does not widen them all. */
export function graphNodeSize(node: StructuredElement): { width: number; height: number } {
  const width = boxWidthWithChanges([displayLabel(node)], fieldChanges(node), 120, 260);
  return {
    width,
    height: boxHeight(wrapLabel(displayLabel(node), width).length, changeLines(fieldChanges(node), width).length),
  };
}

/**
 * What the reader has left showing.
 *
 * A relationship goes when its own type goes, and also when either end of it goes: a
 * line to nowhere is worse than no line. Containers survive the filter — a reader
 * narrowing by type is saying which relationships and elements to show, not which
 * groups exist, and a container whose members are all filtered out still stands for
 * something the document declared.
 */
export function shownGraph(data: StructuredGraphData, hidden: Narrowing): StructuredGraphData {
  const nodes = data.nodes.filter((node) => !isHidden(hidden, "element", node.kind));
  const present = new Set(nodes.map((node) => node.id));
  const edges = data.edges.filter(
    (edge) => !isHidden(hidden, "relationship", edge.kind) && present.has(edge.from) && present.has(edge.to),
  );
  return { nodes, edges, containers: data.containers };
}

export type GraphFigureOptions = {
  isProposal: boolean;
  hidden?: Narrowing;
  /** Where the reader has moved boxes, when there is a reader. */
  nudges?: ReadonlyMap<string, Nudge>;
  /**
   * Which way to draw it. Omitted, the figure decides — and every caller that has no
   * reader to ask omits it, which is what makes the figure an agent writes to a path
   * the same one the reader was shown.
   */
  orientation?: Orientation;
  /**
   * The viewpoint this figure is drawn for, when it is drawn for one.
   *
   * Carried whole rather than as a name, because the figure has to be able to say
   * when what it shows has been adjusted beyond the viewpoint, and that is a
   * comparison with what the viewpoint alone would hide. The narrowing itself still
   * arrives in `hidden`: the caller resolves the viewpoint and adds anything further.
   */
  viewpoint?: StructuredViewpoint;
};

/**
 * The layout to draw, and which way it turned out.
 *
 * Laid out landscape first and measured, because that is the answer most of the time
 * and the second layout is then never computed. Only a diagram that already overflows
 * pays for being laid out twice, and it is the one with something to gain.
 */
function laidOutGraph(
  data: StructuredGraphData,
  asked: Orientation | undefined,
): { layout: ReturnType<typeof layoutGraph>; orientation: Orientation } {
  if (asked !== undefined) return { layout: layoutGraph(data, graphNodeSize, asked), orientation: asked };
  const landscape = layoutGraph(data, graphNodeSize, "landscape");
  if (landscape.width <= READING_WIDTH) return { layout: landscape, orientation: "landscape" };
  const portrait = layoutGraph(data, graphNodeSize, "portrait");
  return orientationFor(landscape.width, portrait.width) === "portrait"
    ? { layout: portrait, orientation: "portrait" }
    : { layout: landscape, orientation: "landscape" };
}

/**
 * Which way this graph would be drawn with nobody to ask.
 *
 * Offered separately because the control that lets a reader turn a diagram has to
 * name what is currently on screen, and it lives above the component that computes
 * the figure. Asking here and passing the answer down also means the two renderings
 * of one document — the inline one and the enlarged one — cannot decide differently.
 */
export function graphOrientationFor(data: StructuredGraphData, hidden: Narrowing = NOTHING_HIDDEN): Orientation {
  return laidOutGraph(shownGraph(data, hidden), undefined).orientation;
}

/**
 * The graph as a figure.
 *
 * Everything below was computed inside the component that drew it. None of it needed
 * to be: it is the document, the narrowing and arithmetic. Moving it here is what lets
 * a process with no browser produce the reader's picture rather than one like it.
 */
export function graphFigure(data: StructuredGraphData, options: GraphFigureOptions): Figure {
  const hidden = options.hidden ?? NOTHING_HIDDEN;
  const nudges = options.nudges ?? new Map<string, Nudge>();
  const isProposal = options.isProposal;

  const shown = shownGraph(data, hidden);
  const { layout, orientation } = laidOutGraph(shown, options.orientation);
  const at = new Map(layout.nodes.map((node) => [node.id, node]));

  const boxFor = (id: string): Box | undefined => {
    const placed = at.get(id);
    if (placed === undefined) return undefined;
    const nudge = nudges.get(id);
    const x = placed.x + (nudge?.dx ?? 0);
    const y = placed.y + (nudge?.dy ?? 0);
    return { x, y, cx: x + placed.width / 2, cy: y + placed.height / 2, w: placed.width, h: placed.height };
  };

  /**
   * The enclosures as drawn, which is not always as laid out.
   *
   * A reader may drag a member, and an enclosure taken from the layout would stay
   * where it was while its member walked out of it — leaving the picture saying the
   * element belongs somewhere it does not.
   */
  const enclosures = layout.containers.map((container) => {
    const members = shown.nodes
      .filter((node) => node.container === container.id)
      .flatMap((node) => {
        const box = boxFor(node.id);
        return box === undefined ? [] : [{ x: box.x, y: box.y, width: box.w, height: box.h }];
      });
    const measured = encloseMembers(members);
    return measured === undefined ? container : { ...container, ...measured };
  });

  /**
   * A colour table per vocabulary.
   *
   * Elements and relationships are independent vocabularies drawn on independent
   * channels — a fill and a stroke — so contending for the same palette slots only
   * exhausted it sooner.
   */
  const elementTints = assignTints(kindsPresent(data.nodes));
  const relationshipTints = assignTints(kindsPresent(data.edges));

  const swatch = (of: "element" | "relationship") => (kind: string): LegendEntry => {
    const tint = (of === "element" ? elementTints : relationshipTints).get(kind)!;
    return {
      label: kind,
      fill: tint.fill,
      stroke: tint.stroke,
      ...(tint.dash === undefined ? {} : { dashed: tint.dash }),
      toggles: true,
      key: filterKey(of, kind),
      hidden: hidden.has(filterKey(of, kind)),
    };
  };
  const legend: LegendGroup[] = [
    { title: "elements", sample: "box", entries: kindsPresent(data.nodes).map(swatch("element")) },
    { title: "relationships", sample: "line", entries: kindsPresent(data.edges).map(swatch("relationship")) },
  ];
  if (isProposal) {
    const used = new Set<ChangeRole>([
      ...shown.nodes.map((node) => elementRole(node, true)),
      ...shown.edges.map((edge) => relationshipRole(edge, true)),
    ]);
    legend.push({
      title: "changes",
      sample: "box",
      // Drawn the way the diagram draws it: context is dimmed now, not dashed — the
      // dash says what kind of thing something is.
      entries: ROLES.filter((role) => role !== "unchanged" && used.has(role)).map((role) => ({
        label: ROLE_LABEL[role],
        fill: PAPER,
        stroke: ROLE_PAINT[role].stroke,
        faded: role === "context",
      })),
    });
  }

  /**
   * Which relationships share a pair of endpoints, and in what order.
   *
   * Rank decides how far a relationship bows away from the straight run between two
   * boxes. Without it two relationships between the same pair were drawn on exactly
   * the same pixels. Direction is part of the key, so A to B and B to A each start at
   * rank zero and keep the straight run they are entitled to.
   */
  const rankOf = new Map<StructuredGraphData["edges"][number], number>();
  const seenPairs = new Map<string, number>();
  for (const edge of shown.edges) {
    const pair = JSON.stringify([edge.from, edge.to]);
    const next = seenPairs.get(pair) ?? 0;
    rankOf.set(edge, next);
    seenPairs.set(pair, next + 1);
  }

  /** Layout routes, matched back to the relationships they were computed for. */
  const byIndex = new Map(layout.edges.map((placed) => [placed.index, placed.points]));
  const routeOf = new Map<StructuredGraphData["edges"][number], { x: number; y: number }[]>();
  shown.edges.forEach((edge, index) => {
    const points = byIndex.get(index);
    if (points !== undefined) routeOf.set(edge, points);
  });

  const still: Nudge = { dx: 0, dy: 0 };
  const shapes = shown.edges.map((edge) => {
    const from = boxFor(edge.from);
    const to = boxFor(edge.to);
    if (from === undefined || to === undefined) return undefined;
    const moved = nudges.has(edge.from) || nudges.has(edge.to);
    return edgePath(
      from,
      edge.from === edge.to ? from : to,
      routeOf.get(edge),
      rankOf.get(edge) ?? 0,
      moved ? { from: nudges.get(edge.from) ?? still, to: nudges.get(edge.to) ?? still } : undefined,
    );
  });

  /**
   * A nudged box can leave the computed extent in any direction, so the canvas
   * follows it in any direction. The extent used to come from the boxes alone, and
   * relationships do not stay inside them: a long route goes around what it spans and
   * a loop is drawn above its box, and both fell outside the viewBox and were cut.
   */
  const drawn = layout.nodes.map((node) => boxFor(node.id)!);
  const routes = shapes.flatMap((shape) => {
    const extent = shape === undefined ? undefined : pathExtent(shape.d);
    return extent === undefined ? [] : [extent];
  });
  const left = Math.min(0, ...drawn.map((box) => box.x - 12), ...routes.map((route) => route.minX - 12));
  const top = Math.min(0, ...drawn.map((box) => box.y - 12), ...routes.map((route) => route.minY - 14));
  const right = Math.max(
    layout.width,
    ...drawn.map((box) => box.x + box.w + 12),
    ...routes.map((route) => route.maxX + 12),
  );
  const bottom = Math.max(
    layout.height,
    ...drawn.map((box) => box.y + box.h + 12),
    ...routes.map((route) => route.maxY + 12),
  );

  const edgeLook = (edge: StructuredGraphData["edges"][number]) => {
    const role = relationshipRole(edge, isProposal);
    const tint = edge.kind === undefined ? undefined : relationshipTints.get(edge.kind);
    return {
      role,
      stroke: tint?.stroke ?? RELATIONSHIP_PAINT["unchanged"],
      dash: tint?.dash,
      // The halo marks what would be applied. Context is included so the reader can
      // place the rest and is applied to nothing, so it is dimmed instead.
      halo: role === "added" || role === "changed" ? RELATIONSHIP_PAINT[role] : undefined,
      width: role === "context" ? 1 : role === "unchanged" ? 1.5 : 1.8,
      opacity: role === "context" ? 0.6 : 1,
    };
  };
  const arrowPaints = [...new Set(shown.edges.map((edge) => edgeLook(edge).stroke))];

  const legendTop = bottom + 4;
  const width = Math.max(right - left, legendMinimumWidth(legend));
  // A viewpoint's statement is wrapped below the key and needs its own height; a
  // figure without one keeps exactly the height it always had.
  const statement = figureStatement(data, shown, hidden, isProposal, options.viewpoint);
  const viewpointNoteHeight =
    options.viewpoint === undefined || statement === undefined ? 0 : wrapNote(statement, width).length * NOTE_LINE_HEIGHT + 4;
  const height = bottom - top + legendHeight(legend, width) + viewpointNoteHeight;

  const groups: FigureGroup[] = [];

  // Enclosures first, so they sit behind what they hold. A container groups and does
  // not mediate: it is drawn, and nothing about the elements or the relationships
  // inside it is drawn differently for being grouped.
  for (const container of enclosures) {
    groups.push({
      id: `container-${container.id}`,
      data: { container: container.id },
      primitives: [
        {
          shape: "rect",
          x: container.x,
          y: container.y,
          width: container.width,
          height: container.height,
          rx: 8,
          fill: "none",
          stroke: MUTED,
          strokeDasharray: "5 3",
          opacity: 0.55,
        },
        {
          shape: "text",
          x: container.x + 8,
          y: container.y + 12,
          text: container.label,
          fontSize: 10,
          fill: MUTED,
        },
      ],
    });
  }

  shown.edges.forEach((edge, index) => {
    const from = boxFor(edge.from);
    const to = boxFor(edge.to);
    const shape = shapes[index];
    if (from === undefined || to === undefined || shape === undefined) return;
    const look = edgeLook(edge);
    const paint = look.stroke;
    const changes = fieldChanges(edge);
    const described = edge.label ?? edge.kind;
    // A label wider than the run it sits on ends up printed under the box it points
    // at, which reads as a clipped word rather than a missing one. Past that point
    // the hover carries it.
    const roomFor = (text: string) => text.length * 5.2 + 8 <= shape.span;
    const primitives: Primitive[] = [];

    // The role, underneath: a wider soft stroke that the type's line sits on.
    if (look.halo !== undefined) {
      primitives.push({
        shape: "path",
        data: { edge: "role" },
        d: shape.d,
        fill: "none",
        stroke: look.halo,
        strokeWidth: look.width + 4,
        strokeLinecap: "round",
        opacity: 0.3,
      });
    }
    primitives.push({
      shape: "path",
      data: { edge: "line" },
      d: shape.d,
      fill: "none",
      stroke: paint,
      strokeWidth: look.width,
      ...(look.dash === undefined ? {} : { strokeDasharray: look.dash }),
      opacity: look.opacity,
      markerEnd: markerId("se-arrow", paint),
    });
    if (described !== undefined && roomFor(described)) {
      primitives.push({
        shape: "text",
        x: shape.labelAt.x,
        y: shape.labelAt.y - 5,
        text: described,
        textAnchor: "middle",
        fontSize: 9,
        fill: paint,
        fontFamily: FIGURE_FONT,
        stroke: PAPER,
        strokeWidth: 3,
        paintOrder: "stroke",
      });
    }
    const written = changes.map(changeText).join(", ");
    if (changes.length > 0 && roomFor(written)) {
      primitives.push({
        shape: "text",
        x: shape.labelAt.x,
        y: shape.labelAt.y + 10,
        text: written,
        textAnchor: "middle",
        fontSize: 9,
        fontWeight: 600,
        fill: paint,
        fontFamily: FIGURE_FONT,
        stroke: PAPER,
        strokeWidth: 3,
        paintOrder: "stroke",
        testId: "relationship-change",
      });
    }

    groups.push({
      id: `edge-${index}`,
      data: {
        "relationship-role": look.role,
        "relationship-shape": edge.from === edge.to ? "loop" : "open",
      },
      title: edgeSummary(data, edge, look.role),
      primitives,
    });
  });

  for (const node of shown.nodes) {
    const box = boxFor(node.id);
    if (box === undefined) continue;
    const role = elementRole(node, isProposal);
    groups.push({
      id: node.id,
      data: { "element-role": role, "element-id": node.id, draggable: "node" },
      title: elementSummary(node, role),
      primitives: boxPrimitives({
        x: box.x,
        y: box.y,
        width: box.w,
        height: box.h,
        role,
        label: displayLabel(node),
        ...(node.kind === undefined ? {} : { tint: elementTints.get(node.kind) }),
        changes: fieldChanges(node),
      }),
    });
  }

  const viewpoint = options.viewpoint;
  const narrowing = statement;

  if (narrowing !== undefined && viewpoint !== undefined) {
    // Wrapped to the canvas and given room of its own, because a concern runs to
    // hundreds of characters and one line of it would leave the picture.
    const lines = wrapNote(narrowing, width);
    groups.push({
      id: "filter-note",
      testId: "diagram-filter-note",
      data: { viewpoint: viewpoint.id },
      primitives: lines.map((line, index) => ({
        shape: "text" as const,
        x: left + 12,
        y: legendTop + legendHeight(legend, width) + NOTE_LINE_HEIGHT * index + NOTE_LINE_HEIGHT - 4,
        // A trailing space on every line but the last, so the group's text reads as the
        // sentence it is rather than words run together at each wrap.
        text: index < lines.length - 1 ? `${line} ` : line,
        fontSize: 9,
        fontWeight: 600,
        fill: "#92400e",
        fontFamily: FIGURE_FONT,
      })),
    });
  } else if (narrowing !== undefined) {
    groups.push({
      id: "filter-note",
      primitives: [
        {
          shape: "text",
          x: left + 12,
          y: legendTop + legendHeight(legend, width) - 4,
          text: narrowing,
          fontSize: 9,
          fontWeight: 600,
          fill: "#92400e",
          fontFamily: FIGURE_FONT,
          testId: "diagram-filter-note",
        },
      ],
    });
  }

  groups.push(...legendGroups(legend, left + 12, legendTop, width));

  return {
    width,
    height,
    viewBox: `${left} ${top} ${width} ${height}`,
    // Either count differing makes this a filtered picture. Testing only the
    // elements was wrong in the common case: hiding a relationship kind leaves
    // every box in place, so the name went on claiming a relationship count the
    // drawing no longer had — and the name is the whole picture to a reader who
    // cannot see it.
    ariaLabel:
      shown.nodes.length === data.nodes.length && shown.edges.length === data.edges.length
        ? `Graph of ${data.nodes.length} elements and ${data.edges.length} relationships`
        : `Graph of ${data.nodes.length} elements and ${data.edges.length} relationships, ` +
          `filtered to ${shown.nodes.length} elements and ${shown.edges.length} relationships`,
    background: PAPER,
    markers: arrowPaints.map((paint) => ({ id: markerId("se-arrow", paint), paint })),
    groups,
    ...(narrowing === undefined ? {} : { narrowing }),
    orientation,
  };
}

/* ── The sequence ───────────────────────────────────────────────────────────── */

/**
 * A sequence as a figure: lifelines down, time down, messages across.
 *
 * No narrowing. A sequence is not narrowable in this application — its key explains
 * the picture and switches nothing — so this takes the document and nothing else,
 * rather than accepting a narrowing it would quietly ignore.
 */
export function sequenceFigure(data: StructuredSequenceData, options: { isProposal: boolean }): Figure {
  const isProposal = options.isProposal;
  const layout = layoutSequence(data);
  const { columns, bands, bandHeight, lifelineX, boxW, headerHeight, messageGap } = layout;
  const containerBand = bandHeight;
  const x = layout.xOf;

  // Participants are elements and carry a type like any other; a message does not,
  // because its label is what it is.
  const tints = assignTints(kindsPresent(data.participants));
  const legend: LegendGroup[] = [
    {
      title: "participants",
      sample: "box",
      entries: kindsPresent(data.participants).map((kind) => {
        const tint = tints.get(kind)!;
        // The dash is half of what distinguishes a type; a key that drops it stops
        // matching the picture the moment a diagram has more than sixteen.
        return {
          label: kind,
          fill: tint.fill,
          stroke: tint.stroke,
          ...(tint.dash === undefined ? {} : { dashed: tint.dash }),
          // Named even though a sequence key switches nothing: the name is how the
          // entry is found, and it is the vocabulary it belongs to that names it.
          key: filterKey("element", kind),
        };
      }),
    },
  ];
  if (isProposal) {
    const used = new Set<ChangeRole>([
      ...data.participants.map((participant) => elementRole(participant, true)),
      ...data.messages.map((message) => relationshipRole(message, true)),
    ]);
    legend.push({
      title: "changes",
      sample: "box",
      entries: ROLES.filter((role) => role !== "unchanged" && used.has(role)).map((role) => ({
        label: ROLE_LABEL[role],
        fill: PAPER,
        stroke: ROLE_PAINT[role].stroke,
        faded: role === "context",
      })),
    });
  }

  const legendTop = layout.height + 4;
  const width = Math.max(layout.width, legendMinimumWidth(legend));
  const height = layout.height + legendHeight(legend, width);

  const groups: FigureGroup[] = [];

  // One header per container, spanning exactly its own columns. Everything below it —
  // a column and a lifeline per participant, messages in declared order — is drawn as
  // it was before containers existed.
  for (const band of bands) {
    const left = band.from * lifelineX + (lifelineX - boxW) / 2;
    const right = band.to * lifelineX + (lifelineX + boxW) / 2;
    groups.push({
      id: `band-${band.container.id}-${band.from}`,
      data: { container: band.container.id },
      primitives: [
        {
          shape: "rect",
          x: left,
          y: 2,
          width: right - left,
          height: containerBand - 6,
          rx: 5,
          fill: "none",
          stroke: MUTED,
          strokeDasharray: "5 3",
          opacity: 0.55,
        },
        {
          shape: "text",
          x: (left + right) / 2,
          y: containerBand - 9,
          text: band.container.label,
          fontSize: 10,
          textAnchor: "middle",
          fill: MUTED,
        },
      ],
    });
  }

  for (const participant of columns) {
    groups.push({
      id: `life-${participant.id}`,
      primitives: [
        {
          shape: "line",
          x1: x(participant.id),
          y1: bandHeight + headerHeight,
          x2: x(participant.id),
          y2: layout.height - 6,
          stroke: "#d4d4d8",
          strokeDasharray: "3 3",
          strokeWidth: 1,
        },
      ],
    });
  }

  for (const participant of columns) {
    const role = elementRole(participant, isProposal);
    groups.push({
      id: participant.id,
      data: { "element-role": role, "element-id": participant.id },
      title: elementSummary(participant, role),
      primitives: boxPrimitives({
        x: x(participant.id) - boxW / 2,
        y: bandHeight + 4,
        width: boxW,
        height: headerHeight - 8,
        role,
        label: displayLabel(participant),
        ...(participant.kind === undefined ? {} : { tint: tints.get(participant.kind) }),
        changes: fieldChanges(participant),
        anchor: "middle",
      }),
    });
  }

  data.messages.forEach((message, index) => {
    const role = relationshipRole(message, isProposal);
    const paint = RELATIONSHIP_PAINT[role];
    const y = bandHeight + headerHeight + (index + 1) * messageGap;
    const fromX = x(message.from);
    const toX = x(message.to);
    const isSelf = message.from === message.to;
    const changes = fieldChanges(message);
    const labelX = isSelf ? fromX + SELF_LOOP + 6 : (fromX + toX) / 2;
    const anchor = isSelf ? "start" : "middle";
    const primitives: Primitive[] = [];

    // A message from something to itself has no direction to draw along, so it is
    // drawn as a loop rather than as a line of zero length.
    if (isSelf) {
      primitives.push({
        shape: "path",
        d: `M ${fromX} ${y} h ${SELF_LOOP} v ${messageGap / 2} h -${SELF_LOOP}`,
        fill: "none",
        stroke: paint,
        strokeWidth: 1.4,
        markerEnd: markerId("se-msg", paint),
      });
    } else {
      primitives.push({
        shape: "line",
        x1: fromX,
        y1: y,
        x2: toX,
        y2: y,
        stroke: paint,
        strokeWidth: 1.4,
        markerEnd: markerId("se-msg", paint),
      });
    }
    if (message.label !== undefined) {
      primitives.push({
        shape: "text",
        x: labelX,
        y: y - 5,
        text: message.label,
        textAnchor: anchor,
        fontSize: 10,
        fill: INK,
        fontFamily: FIGURE_FONT,
        stroke: PAPER,
        strokeWidth: 3,
        paintOrder: "stroke",
      });
    }
    if (changes.length > 0) {
      primitives.push({
        shape: "text",
        x: labelX,
        y: y + 11,
        text: changes.map(changeText).join(", "),
        textAnchor: anchor,
        fontSize: 9,
        fontWeight: 600,
        fill: paint,
        fontFamily: FIGURE_FONT,
        stroke: PAPER,
        strokeWidth: 3,
        paintOrder: "stroke",
        testId: "relationship-change",
      });
    }
    // The ordinal, so a reader can refer to a message by number.
    primitives.push({
      shape: "text",
      x: 4,
      y: y + 3,
      text: String(index + 1),
      fontSize: 9,
      fill: MUTED,
      fontFamily: FIGURE_FONT,
    });

    groups.push({
      id: `message-${index}`,
      data: {
        "relationship-role": role,
        "message-index": String(index),
        "message-from": message.from,
        "message-to": message.to,
      },
      title: messageSummary(data, message, index, role),
      primitives,
    });
  });

  groups.push(...legendGroups(legend, 12, legendTop, width));

  return {
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    ariaLabel: `Sequence of ${data.participants.length} participants and ${data.messages.length} messages`,
    background: PAPER,
    markers: ROLES.map((role) => ({ id: markerId("se-msg", RELATIONSHIP_PAINT[role]), paint: RELATIONSHIP_PAINT[role] })),
    groups,
  };
}
