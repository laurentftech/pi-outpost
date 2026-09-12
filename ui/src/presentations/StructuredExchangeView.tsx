import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EnlargedView } from "../components/EnlargedView";
import {
  readTableRow,
  type StructuredRemoval,
  type StructuredGraphData,
  type StructuredSequenceData,
  type StructuredTableData,
  type StructuredTableRowRole,
  type ValidatedStructuredExchange,
} from "@pi-outpost/shared/structured-exchange";
import {
  describeStructure,
  type DescribedEnrichment,
  type DescribedRow,
  type DescribedTrace,
  filterKey,
  displayLabel,
  type Nudge,
  ROLE_LABEL,
  TABLE_ROLE_LABEL,
  TABLE_ROLES,
  tableDeclaresRoles,
  tableRowRole,
  toMermaid,
  validStructuredExchange,
  NOTHING_HIDDEN,
  type Narrowing,
} from "./structuredExchange";
export { filterKey, type FilterScope } from "./structuredExchange";
import {
  entryWidth,
  graphFigure,
  graphOrientationFor,
  sequenceFigure,
  type FigureGroup,
  type FigureMarker,
  type Primitive,
} from "@pi-outpost/shared/structured-exchange/figure";
import { otherOrientation, type Orientation } from "@pi-outpost/shared/diagram-orientation";
import { downloadCsv, downloadXlsx, tableExport } from "./tableExport";
import type { ActionDispatch, PresentationProps, ToolItem } from "./types";
import { resourceTargetFor } from "@pi-outpost/shared/resource-target";
import {
  artifactText,
  attributeText,
  attributeValueText,
  changeText,
  locationText,
} from "@pi-outpost/shared/structured-exchange/text";
// Re-exported because the rendering suite and the legend both reach for them here.
export { KIND_PRESENTATIONS, KIND_TINT_COUNT, assignTints, kindsPresent } from "@pi-outpost/shared/structured-exchange/palette";
export { wrapLabel } from "@pi-outpost/shared/structured-exchange/text";

/**
 * Structured exchange: data a tool declared about itself, rendered from that data
 * rather than from anything it wrote for display.
 *
 * When the envelope names a target it is a proposal, and this rendering is the
 * approval gate before it is applied somewhere. Two consequences run through
 * everything below. Nothing is summarised or sampled — what the reader sees is
 * what would be applied. And every value is rendered as text, never as markup:
 * this content comes from outside and is data, not instructions.
 *
 * The diagrams are **native SVG** — `rect` and `text`, with colours as attributes
 * rather than classes. An earlier version put HTML inside `foreignObject`, which
 * reads the same on screen and is useless the moment the picture has to go
 * anywhere else: serialize it and the styling is left behind, rasterize it and the
 * foreign content comes out blank. A diagram nobody can paste into a document is a
 * diagram that stops at the edge of this application.
 */

/* ── Drawing a figure ───────────────────────────────────────────────────────── */

/**
 * One shape, as an element.
 *
 * Decides nothing. Every colour, coordinate and piece of text arrived computed, from
 * the same function that feeds the serializer — which is what stops the picture on
 * screen and the picture in a file from being two different pictures.
 */
function Shape({ primitive }: { primitive: Primitive }) {
  const data = Object.fromEntries(
    Object.entries(primitive.data ?? {}).map(([name, value]) => [`data-${name}`, value]),
  );
  switch (primitive.shape) {
    case "rect":
      return (
        <rect
          {...data}
          x={primitive.x}
          y={primitive.y}
          width={primitive.width}
          height={primitive.height}
          rx={primitive.rx}
          fill={primitive.fill}
          stroke={primitive.stroke}
          strokeWidth={primitive.strokeWidth}
          strokeDasharray={primitive.strokeDasharray}
          opacity={primitive.opacity}
        />
      );
    case "text":
      return (
        <text
          {...data}
          data-testid={primitive.testId}
          x={primitive.x}
          y={primitive.y}
          fontSize={primitive.fontSize}
          fontFamily={primitive.fontFamily}
          fontWeight={primitive.fontWeight}
          textAnchor={primitive.textAnchor}
          fill={primitive.fill}
          stroke={primitive.stroke}
          strokeWidth={primitive.strokeWidth}
          paintOrder={primitive.paintOrder}
          opacity={primitive.opacity}
        >
          {primitive.text}
        </text>
      );
    case "line":
      return (
        <line
          {...data}
          x1={primitive.x1}
          y1={primitive.y1}
          x2={primitive.x2}
          y2={primitive.y2}
          stroke={primitive.stroke}
          strokeWidth={primitive.strokeWidth}
          strokeDasharray={primitive.strokeDasharray}
          opacity={primitive.opacity}
          markerEnd={primitive.markerEnd === undefined ? undefined : `url(#${primitive.markerEnd})`}
        />
      );
    case "path":
      return (
        <path
          {...data}
          d={primitive.d}
          fill={primitive.fill ?? "none"}
          stroke={primitive.stroke}
          strokeWidth={primitive.strokeWidth}
          strokeDasharray={primitive.strokeDasharray}
          strokeLinecap={primitive.strokeLinecap}
          opacity={primitive.opacity}
          markerEnd={primitive.markerEnd === undefined ? undefined : `url(#${primitive.markerEnd})`}
          pointerEvents="none"
        />
      );
  }
}

/** What a browser adds to a drawn group: handlers, cursors, and a hit area. */
export type Interaction = { extra?: React.SVGProps<SVGGElement>; before?: React.ReactNode };

/**
 * The shapes of one declared thing, with whatever this browser adds to them.
 *
 * Recurses one level, because the key is a group of switchable groups. The
 * interaction function is passed down rather than applied here, so a nested entry is
 * offered a pointer on the same terms as anything else drawn.
 */
function Drawn({
  group,
  interaction,
}: {
  group: FigureGroup;
  interaction?: (group: FigureGroup) => Interaction;
}) {
  const data = Object.fromEntries(
    Object.entries(group.data ?? {}).map(([name, value]) => [`data-${name}`, value]),
  );
  const { extra, before } = interaction?.(group) ?? {};
  return (
    <g {...data} data-testid={group.testId} opacity={group.opacity} {...extra}>
      {group.title === undefined ? null : <title>{group.title}</title>}
      {before}
      {group.primitives.map((primitive, index) => (
        <Shape key={index} primitive={primitive} />
      ))}
      {(group.groups ?? []).map((inner) => (
        <Drawn key={inner.id} group={inner} interaction={interaction} />
      ))}
    </g>
  );
}

/**
 * One hover tooltip, for everything a diagram draws.
 *
 * It started on graph relationships only, because that was where a label had to be
 * dropped for want of room. But a box's name is truncated for the same reason, a
 * sequence has both, and a reader should not have to learn which parts of which
 * diagram answer to a pointer. The native `<title>` stays underneath for anything
 * driven by the keyboard or a screen reader; this is the one that appears where the
 * pointer is and is never clipped by the box the diagram scrolls in.
 */
function useDiagramTooltip() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | undefined>(undefined);

  const hover = (text: string) => ({
    onPointerEnter: (event: React.PointerEvent) => setTip({ text, x: event.clientX, y: event.clientY }),
    onPointerMove: (event: React.PointerEvent) => setTip({ text, x: event.clientX, y: event.clientY }),
    onPointerLeave: () => setTip(undefined),
  });

  const Tooltip = () =>
    tip === undefined ? null : (
      <div
        data-testid="diagram-tooltip"
        role="tooltip"
        // Fixed to the viewport: a diagram scrolling inside a narrow column must not
        // clip the one thing explaining what is off its edge.
        style={{ position: "fixed", left: tip.x + 14, top: tip.y + 14, zIndex: 120 }}
        className="pointer-events-none max-w-sm rounded bg-zinc-900 px-2 py-1 text-xs text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900"
      >
        {tip.text}
      </div>
    );

  return { hover, Tooltip };
}

/** The arrowheads a figure declares, since a marker cannot inherit a stroke colour. */
function FigureMarkers({ markers }: { markers: FigureMarker[] }) {
  return (
    <defs>
      {markers.map((marker) => (
        <marker
          key={marker.id}
          id={marker.id}
          markerWidth="7"
          markerHeight="7"
          refX="9"
          refY="5"
          viewBox="0 0 10 10"
          markerUnits="userSpaceOnUse"
          orient="auto"
        >
          <path d="M0,0 L10,5 L0,10 z" fill={marker.paint} />
        </marker>
      ))}
    </defs>
  );
}

/* ── Graph ─────────────────────────────────────────────────────────────── */

function GraphView({
  data,
  isProposal,
  nudges,
  setNudges,
  hidden,
  setHidden,
  orientation,
}: {
  data: StructuredGraphData;
  isProposal: boolean;
  /**
   * Positions the reader has adjusted, as offsets from the computed layout. Held as
   * offsets rather than absolute points so a nudged box still follows if the document
   * changes underneath it, and held by the parent rather than here because the small
   * view and the enlarged one are two instances of this component: adjusting a
   * diagram at full size and finding the change gone on closing the modal is the kind
   * of loss that makes the feature not worth using.
   */
  nudges: ReadonlyMap<string, Nudge>;
  setNudges: (nudges: ReadonlyMap<string, Nudge>) => void;
  /**
   * Types the reader has switched off, qualified by what they are a type *of*.
   *
   * Elements and relationships have separate vocabularies that may well share a
   * word — "power" is a plausible kind of block and a plausible kind of connection.
   * Held in one namespace, hiding one hid the other.
   */
  hidden: Narrowing;
  setHidden: (hidden: Narrowing) => void;
  /**
   * Which way to draw it — always a decided one, never "work it out".
   *
   * Resolved by the parent so the inline rendering and the enlarged one cannot reach
   * different answers, and so the control that names the current orientation is
   * naming the same thing both of them drew.
   */
  orientation: Orientation;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragging, setDragging] = useState<string | undefined>(undefined);
  const [panning, setPanning] = useState(false);
  const { hover, Tooltip } = useDiagramTooltip();
  /**
   * Teardown for a gesture still in flight.
   *
   * A drag that outlives its component keeps listeners on a detached node and leaves
   * the pointer captured. It also made the test suite exit non-zero while every
   * assertion passed — the failure was an unhandled rejection, which a summary line
   * saying "63 passed" does not mention.
   */
  const endGesture = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => endGesture.current?.(), []);

  /**
   * The picture, computed where both renderers can reach it.
   *
   * Everything that decides what is drawn — the narrowing, the layout, the colours,
   * the extent, the key — happens in `graphFigure`. What is left here is the half a
   * file cannot carry: pointing, dragging and panning.
   */
  const figure = useMemo(
    () => graphFigure(data, { isProposal, hidden, nudges, orientation }),
    [data, isProposal, hidden, nudges, orientation],
  );

  /**
   * Drag to adjust.
   *
   * No automatic layout satisfies every real model, so the reader can move a box
   * before approving what it shows. Deltas are measured in client space and divided
   * by the on-screen scale, so dragging tracks the pointer whether the diagram is
   * shown at natural size or enlarged.
   *
   * These positions are presentation only: they are not part of the document and
   * are not sent back. Re-opening the result shows the computed layout again.
   */
  /**
   * Drag the ground to pan.
   *
   * A wide diagram lives in a scrolling box, and reaching for a scrollbar to look at
   * the right-hand half of a picture you are in the middle of rearranging breaks the
   * gesture you were already making. Panning moves the box rather than the drawing,
   * so it composes with a node drag instead of competing with it, and it leaves the
   * exported figure untouched.
   */
  const startPan = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    // A press that landed on something interactive is that thing's to handle. Panning
    // calls preventDefault and captures the pointer, which suppresses the `click`
    // that would otherwise follow — so without this the key was unclickable and
    // filtering did nothing at all in the browser, while tests that dispatched a
    // synthetic click straight at the entry went on passing.
    const landedOn = event.target as Element;
    if (landedOn.closest('[data-draggable="node"]') !== null) return;
    if (landedOn.closest("[data-legend-entry]") !== null) return;

    let scroller: HTMLElement | null = svgRef.current?.parentElement ?? null;
    while (
      scroller !== null &&
      scroller.scrollWidth <= scroller.clientWidth &&
      scroller.scrollHeight <= scroller.clientHeight
    ) {
      scroller = scroller.parentElement;
    }
    if (scroller === null) return;

    event.preventDefault();
    const originX = event.clientX;
    const originY = event.clientY;
    const fromLeft = scroller.scrollLeft;
    const fromTop = scroller.scrollTop;
    const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);
    setPanning(true);

    const move = (moved: PointerEvent) => {
      scroller.scrollLeft = fromLeft - (moved.clientX - originX);
      scroller.scrollTop = fromTop - (moved.clientY - originY);
    };
    const done = () => {
      endGesture.current = undefined;
      target.releasePointerCapture?.(event.pointerId);
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", done);
      target.removeEventListener("pointercancel", done);
      setPanning(false);
    };
    endGesture.current?.();
    endGesture.current = done;
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", done);
    target.addEventListener("pointercancel", done);
  };

  const startDrag = (id: string) => (event: React.PointerEvent<SVGGElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const svg = svgRef.current;
    const scale = svg === null ? 1 : (svg.getBoundingClientRect().width || figure.width) / figure.width;
    const originX = event.clientX;
    const originY = event.clientY;
    const from = nudges.get(id) ?? { dx: 0, dy: 0 };
    const target = event.currentTarget;
    // Guarded: jsdom has no pointer capture at all, and a real browser can refuse it
    target.setPointerCapture?.(event.pointerId);
    setDragging(id);

    const move = (moved: PointerEvent) => {
      const next = new Map(nudges);
      next.set(id, {
        dx: from.dx + (moved.clientX - originX) / scale,
        dy: from.dy + (moved.clientY - originY) / scale,
      });
      setNudges(next);
    };
    const done = () => {
      endGesture.current = undefined;
      target.releasePointerCapture?.(event.pointerId);
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", done);
      target.removeEventListener("pointercancel", done);
      setDragging(undefined);
    };
    endGesture.current?.();
    endGesture.current = done;
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", done);
    target.addEventListener("pointercancel", done);
  };

  const toggle = (key: string) => {
    const next = new Set(hidden);
    if (!next.delete(key)) next.add(key);
    setHidden(next);
  };

  /**
   * What a browser adds to a drawn group, and a file does not.
   *
   * Derived from the group's own shapes rather than recomputed beside them: the hit
   * area for a relationship is its own line, widened. Nothing here changes what is
   * drawn — it only makes what is drawn reachable with a pointer.
   */
  const interaction = (group: FigureGroup): { extra?: React.SVGProps<SVGGElement>; before?: React.ReactNode } => {
    const elementId = group.data?.["element-id"];
    if (group.data?.draggable === "node" && elementId !== undefined) {
      return {
        extra: {
          onPointerDown: startDrag(elementId),
          style: { cursor: dragging === elementId ? "grabbing" : "grab" },
          ...(group.title === undefined ? {} : hover(group.title)),
        },
      };
    }
    if (group.data?.["relationship-role"] !== undefined) {
      const line = group.primitives.find(
        (primitive) => primitive.shape === "path" && primitive.data?.edge === "line",
      );
      return {
        extra: group.title === undefined ? {} : hover(group.title),
        // A line is one or two pixels wide and nobody can reliably hover one.
        before:
          line === undefined || line.shape !== "path" ? null : (
            <path
              data-edge="hit"
              data-hit="edge"
              d={line.d}
              fill="none"
              stroke="transparent"
              strokeWidth={14}
              pointerEvents="stroke"
            />
          ),
      };
    }
    const entry = group.data?.["legend-entry"];
    if (entry !== undefined && group.data?.toggles === "true") {
      const swatch = group.primitives[0];
      const at = swatch.shape === "rect" ? swatch.x : swatch.shape === "line" ? swatch.x1 : 0;
      const top = swatch.shape === "rect" ? swatch.y : swatch.shape === "line" ? swatch.y1 - 5 : 0;
      const label = group.primitives.find((primitive) => primitive.shape === "text");
      const width = label?.shape === "text" ? entryWidth(label.text.replace(" (hidden)", "")) - 8 : 0;
      return {
        extra: { onClick: () => toggle(entry), style: { cursor: "pointer" } },
        // A generous hit area, since the swatch itself is ten pixels tall. Named
        // the way the edge's hit path is, so what exists only for a pointer can be
        // told from what the picture is made of — which is what the seam test
        // between this rendering and the serialized figure rests on.
        before: <rect data-hit="legend" x={at - 3} y={top - 3} width={width} height={16} fill="transparent" />,
      };
    }
    return {};
  };

  return (
    <>
      {nudges.size > 0 && (
        <button
          type="button"
          className="mb-1 text-xs underline text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
          onClick={() => setNudges(new Map())}
        >
          reset layout
        </button>
      )}
      <Tooltip />
      <svg
        ref={svgRef}
        role="img"
        aria-label={figure.ariaLabel}
        viewBox={figure.viewBox}
        width={figure.width}
        height={figure.height}
        xmlns="http://www.w3.org/2000/svg"
        onPointerDown={startPan}
        style={{ cursor: panning ? "grabbing" : "grab", touchAction: "none" }}
      >
        <rect
          x={Number(figure.viewBox.split(" ")[0])}
          y={Number(figure.viewBox.split(" ")[1])}
          width={figure.width}
          height={figure.height}
          fill={figure.background}
        />
        <FigureMarkers markers={figure.markers} />
        {figure.groups.map((group) => (
          <Drawn key={group.id} group={group} interaction={interaction} />
        ))}
      </svg>
    </>
  );
}

/* ── Sequence ───────────────────────────────────────────────────────────────── */

/**
 * A sequence as a sequence: lifelines down, time down, messages across.
 *
 * An earlier version was a numbered list. It carried the same data and was
 * markedly harder to read than the diagram exported from it — which is an argument
 * against the whole design, since the point of holding the data is that the native
 * view should be the good one and the export the convenience.
 */
function SequenceView({ data, isProposal }: { data: StructuredSequenceData; isProposal: boolean }) {
  const { hover, Tooltip } = useDiagramTooltip();
  const figure = useMemo(() => sequenceFigure(data, { isProposal }), [data, isProposal]);

  return (
    <>
      <svg
        role="img"
        aria-label={figure.ariaLabel}
        viewBox={figure.viewBox}
        width={figure.width}
        height={figure.height}
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect x={0} y={0} width={figure.width} height={figure.height} fill={figure.background} />
        <FigureMarkers markers={figure.markers} />
        {figure.groups.map((group) => (
          <Drawn
            key={group.id}
            group={group}
            // A sequence is not narrowed and its boxes are not dragged, so the only
            // thing a browser adds here is the pointer that explains what was cut.
            interaction={(drawn) => (drawn.title === undefined ? {} : { extra: hover(drawn.title) })}
          />
        ))}
      </svg>
      <Tooltip />
    </>
  );
}

/* ── Table ──────────────────────────────────────────────────────────────────── */

/**
 * A row's role, in HTML rather than in SVG.
 *
 * The same three colours the diagram paints an element with — green, amber, the
 * dimmed grey of context — so a reader who has learnt what an addition looks like
 * in a graph does not learn it again here. `removed` takes the red the removals
 * list already uses, and is struck through as well: colour alone would leave the
 * one destructive role indistinguishable to a reader who cannot separate it.
 */
const ROW_ROLE_STYLE: Record<StructuredTableRowRole, string> = {
  added: "bg-emerald-50 dark:bg-emerald-950/40",
  changed: "bg-amber-50 dark:bg-amber-950/40",
  context: "bg-zinc-50 text-zinc-500 dark:bg-zinc-900/60 dark:text-zinc-400",
  removed: "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200",
};

/** Narrow enough to be a column still, wide enough to grab again. */
const MIN_COLUMN_WIDTH = 48;

/** One nudge of a divider held by the keyboard rather than the mouse. */
const COLUMN_STEP = 16;

/**
 * A table, with rules on both axes and columns the reader can size.
 *
 * A requirements table is the case that made this necessary: an identifier
 * column squeezed until `REQ-001` broke across two lines, beside a column of
 * prose given a third of the width. Nothing about the document says how wide
 * anything should be, and no heuristic here would know either — the reader can
 * see what they are reading, so the reader gets the handles.
 *
 * Sizing is presentation only (see `ReaderMayAdjustAndNarrowTheView`): it is
 * held in this component, never written back into the envelope, and a fresh
 * rendering starts from the browser's own layout again.
 *
 * Which is also why widths start unset. `auto` layout reads content better than
 * any measurement taken before the content is there, so the first drag freezes
 * what the browser worked out and only then switches to `fixed` — from that
 * point the columns hold their size and the wrapper scrolls.
 */

/**
 * How each kind of claim is shown, and why they cannot share a style.
 *
 * Four things arrive on one row and a reader has to tell them apart at a glance:
 * what is true now, what the producer expected to find, what it asks to become
 * true, and what it asks to unset. Rendered alike they read as one list of facts —
 * which would present an unchecked assumption as something established, and a
 * request as a description.
 *
 * Never colour alone: each carries its own word, because the distinction has to
 * survive a reader who cannot see the tint.
 */
const CLAIM_STYLE: Record<string, { label: string; className: string }> = {
  attribute: { label: "is", className: "text-zinc-600 dark:text-zinc-300" },
  expects: { label: "expects", className: "text-amber-700 dark:text-amber-400" },
  assigns: { label: "asks to set", className: "text-blue-700 dark:text-blue-400" },
  removes: { label: "asks to unset", className: "text-rose-700 line-through dark:text-rose-400" },
};

/**
 * Everything an item carries beyond its own text, as a panel under it.
 *
 * Collapsed by default and never omitted: a requirements table where every row
 * expands its attributes is a wall, and a reader looking for one thing cannot find
 * it. What is folded is still in the accessible text, whole — see
 * `textualEquivalent`, which is what makes folding a display choice rather than a
 * quiet removal.
 *
 * Everything here is rendered as text. A URI, a profile, a digest and an attribute
 * value are all producer-controlled, and none of them becomes a control by
 * resembling one.
 */
/**
 * A location or an artifact, as text — and a way to follow it only where the
 * application's own safety policy already says a reader may be taken.
 *
 * Nothing is opened, fetched or resolved to draw this. The reader's click is the
 * first thing that touches the other end, which is what keeps a producer's URI from
 * being a request this application makes on their behalf the moment a document
 * arrives.
 *
 * A URI with nowhere safe to go is still shown in full and still selectable. It is
 * information the reader may need; a scheme simply does not become trusted by
 * appearing in a document that validated.
 */
function FollowableUri({
  uri,
  text,
  dispatch,
  sha256,
}: {
  uri: string;
  text: string;
  dispatch?: ActionDispatch;
  /** An artifact's digest. A location has none: it points at a place, not at bytes. */
  sha256?: string;
}) {
  const target = resourceTargetFor(uri);
  if (target === undefined || dispatch === undefined) {
    return <span data-followable="no">{text}</span>;
  }
  if (target.kind === "workspace-file") {
    return (
      <button
        type="button"
        data-followable="workspace-file"
        className="text-left underline decoration-dotted underline-offset-2 hover:decoration-solid"
        onClick={() => dispatch({ kind: "openFile", path: target.path, ...(sha256 === undefined ? {} : { sha256 }) })}
      >
        {text}
      </button>
    );
  }
  return (
    <a
      data-followable="external-url"
      className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
      href={target.url}
      target="_blank"
      rel="noreferrer"
    >
      {text}
    </a>
  );
}

function EnrichmentDetail({
  item,
  traces,
  dispatch,
}: {
  item: DescribedEnrichment;
  traces?: DescribedTrace[];
  dispatch?: ActionDispatch;
}) {
  const claims: [keyof typeof CLAIM_STYLE, string, string][] = [
    ...item.attributes.map(([name, value]) => ["attribute", name, attributeValueText(value)] as [string, string, string]),
    ...item.expectations.map(([name, value]) => ["expects", name, attributeValueText(value)] as [string, string, string]),
    ...item.assignments.map(([name, value]) => ["assigns", name, attributeValueText(value)] as [string, string, string]),
    ...item.removedAttributes.map((name) => ["removes", name, ""] as [string, string, string]),
  ];
  const related = traces ?? [];
  if (claims.length === 0 && item.locations.length === 0 && item.artifacts.length === 0 && related.length === 0) {
    return null;
  }

  const counted = [
    claims.length > 0 ? `${claims.length} attribute${claims.length === 1 ? "" : "s"}` : "",
    related.length > 0 ? `${related.length} relation${related.length === 1 ? "" : "s"}` : "",
    item.locations.length > 0 ? `${item.locations.length} location${item.locations.length === 1 ? "" : "s"}` : "",
    item.artifacts.length > 0 ? `${item.artifacts.length} artifact${item.artifacts.length === 1 ? "" : "s"}` : "",
  ].filter(Boolean);

  return (
    <details className="mt-1 text-[11px]" data-testid="structured-enrichment">
      <summary className="cursor-pointer text-zinc-500 dark:text-zinc-400">{counted.join(", ")}</summary>
      <dl className="mt-1 grid grid-cols-[auto_auto_1fr] gap-x-2 gap-y-0.5">
        {claims.map(([claim, name, value], index) => (
          <Fragment key={`${claim}-${name}-${index}`}>
            <dt className={`font-medium ${CLAIM_STYLE[claim].className}`} data-claim={claim}>
              {CLAIM_STYLE[claim].label}
            </dt>
            <dd className="font-mono text-zinc-700 dark:text-zinc-200">{name}</dd>
            <dd className="break-words text-zinc-600 dark:text-zinc-300">{value}</dd>
          </Fragment>
        ))}
        {related.map((trace, index) => (
          <Fragment key={`trace-${index}`}>
            <dt className="font-medium text-violet-700 dark:text-violet-400" data-claim="relates">
              {trace.kind}
            </dt>
            <dd className="col-span-2 break-words text-zinc-600 dark:text-zinc-300">
              {trace.fromLabel} → {trace.toLabel}
              {trace.toRow === undefined && trace.toRef !== undefined ? " (outside this document)" : ""}
            </dd>
          </Fragment>
        ))}
        {item.locations.map((location, index) => (
          <Fragment key={`location-${index}`}>
            <dt className="font-medium text-zinc-500 dark:text-zinc-400" data-claim="location">
              at
            </dt>
            <dd className="col-span-2 break-all font-mono text-zinc-600 dark:text-zinc-300">
              <FollowableUri uri={location.uri} text={locationText(location)} dispatch={dispatch} />
            </dd>
          </Fragment>
        ))}
        {item.artifacts.map((artifact, index) => (
          <Fragment key={`artifact-${index}`}>
            <dt className="font-medium text-zinc-500 dark:text-zinc-400" data-claim="artifact">
              {artifact.rel}
            </dt>
            <dd className="col-span-2 break-all font-mono text-zinc-600 dark:text-zinc-300">
              <FollowableUri uri={artifact.uri} text={artifactText(artifact)} dispatch={dispatch} sha256={artifact.sha256} />
            </dd>
          </Fragment>
        ))}
      </dl>
    </details>
  );
}

function TableView({
  data,
  hidden,
  setHidden,
  rows,
  traces = [],
  dispatch,
}: {
  data: StructuredTableData;
  hidden: Narrowing;
  setHidden: (hidden: Narrowing) => void;
  dispatch?: ActionDispatch;
  /** The same rows, described: identity, kind, headings and enrichment. */
  rows?: DescribedRow[];
  traces?: DescribedTrace[];
}) {
  const [widths, setWidths] = useState<number[] | null>(null);
  const headRef = useRef<HTMLTableRowElement>(null);

  /** What the browser is currently giving each column, before we take over. */
  const measured = useCallback((): number[] => {
    const cells = [...(headRef.current?.querySelectorAll("th") ?? [])];
    return cells.map((cell) => Math.max(MIN_COLUMN_WIDTH, Math.round(cell.getBoundingClientRect().width)));
  }, []);

  const resize = useCallback(
    (index: number, to: (current: number) => number) =>
      setWidths((previous) => {
        const base = previous ?? measured();
        const next = [...base];
        next[index] = Math.max(MIN_COLUMN_WIDTH, Math.round(to(base[index] ?? MIN_COLUMN_WIDTH)));
        return next;
      }),
    [measured],
  );

  function startDrag(event: React.PointerEvent<HTMLDivElement>, index: number) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidths = widths ?? measured();
    setWidths(startWidths);

    /**
     * The gesture is followed on the window, not on the divider.
     *
     * Pointer capture is the obvious answer and it does not survive this: the
     * first movement sets state, the header re-renders, and a capture whose
     * element React has replaced is simply gone — a 150-pixel drag arrived as
     * thirty. The window is still there whatever the header does, and it is also
     * what lets the pointer leave the table mid-drag without dropping it.
     */
    const onMove = (move: PointerEvent) => {
      const from = startWidths[index] ?? MIN_COLUMN_WIDTH;
      resize(index, () => from + (move.clientX - startX));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  const total = widths?.reduce((sum, width) => sum + width, 0);

  /**
   * The grabbable edge of a column, repeated down every row of it.
   *
   * A column boundary is a line the whole height of the table, and that is where
   * a reader reaches for it — at the row they are reading, not by travelling
   * back up to the header. Only the header's is focusable: one keyboard target
   * per column is a control, ninety-eight of them is a tab trap.
   */
  const divider = (index: number, column: string, keyboard: boolean) => (
    <div
      role={keyboard ? "separator" : "presentation"}
      aria-orientation={keyboard ? "vertical" : undefined}
      aria-label={keyboard ? `Resize column ${column}` : undefined}
      aria-hidden={keyboard ? undefined : true}
      tabIndex={keyboard ? 0 : undefined}
      onPointerDown={(event) => startDrag(event, index)}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const step = event.key === "ArrowRight" ? COLUMN_STEP : -COLUMN_STEP;
        resize(index, (current) => current + step);
      }}
      className="absolute -right-px top-0 h-full w-1.5 cursor-col-resize touch-none hover:bg-zinc-400 focus:bg-zinc-400 focus:outline-none dark:hover:bg-zinc-500 dark:focus:bg-zinc-500"
    />
  );

  const declaresRoles = tableDeclaresRoles(data);
  // What the reader is actually looking at, which in a proposal is derived rather
  // than declared. Asking the declaration instead left a proposed table tinted with
  // no key beside it and no way to filter it — colour carrying a meaning with no
  // word attached, which is the one thing this rendering promises never to do.
  const roleOf = (row: StructuredTableData["rows"][number], index: number): StructuredTableRowRole | undefined =>
    rows?.[index]?.role ?? tableRowRole(row, declaresRoles);
  const rolesPresent = [...new Set(data.rows.map(roleOf).filter((role): role is StructuredTableRowRole => role !== undefined))]
    .sort((a, b) => TABLE_ROLES.indexOf(a) - TABLE_ROLES.indexOf(b));
  // Carried, not recovered. `data.rows.indexOf(row)` inside the render below was a
  // scan per row — at the five-thousand-row ceiling, some twelve million identity
  // comparisons on every column drag and every filter toggle, for an index the
  // filter already had in its hand.
  const shown = data.rows
    .map((row, index) => ({ row, index }))
    .filter(({ row, index }) => {
      const role = roleOf(row, index);
      return role === undefined || !hidden.has(filterKey("role", role));
    });

  // Relations by the row they touch, built once. Filtering every relation per row is
  // the same shape of cost: two thousand relations across five thousand rows is ten
  // million comparisons to draw one table.
  const tracesByRow = new Map<string, DescribedTrace[]>();
  for (const trace of traces) {
    for (const end of [trace.fromRow, trace.toRow]) {
      if (end === undefined) continue;
      const held = tracesByRow.get(end);
      if (held === undefined) tracesByRow.set(end, [trace]);
      else if (!held.includes(trace)) held.push(trace);
    }
  }

  const toggle = (role: StructuredTableRowRole) => {
    const next = new Set(hidden);
    const key = filterKey("role", role);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setHidden(next);
  };

  return (
    <div className="overflow-x-auto">
      {/* The key beside the table rather than inside it: a table is text, and it
          leaves this application as its textual equivalent rather than as a
          figure, so there is no picture for the key to travel inside. It is also
          the filter, as the diagram's key is — what a reader reads a colour from
          is what they switch. */}
      {rolesPresent.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]" data-testid="table-role-key">
          {rolesPresent.map((role) => {
            const off = hidden.has(filterKey("role", role));
            return (
              <button
                key={role}
                type="button"
                onClick={() => toggle(role)}
                aria-pressed={!off}
                className={`flex items-center gap-1 rounded border border-zinc-300 px-1.5 py-0.5 dark:border-zinc-700 ${
                  off ? "opacity-50" : ""
                }`}
              >
                <span className={`inline-block h-2.5 w-2.5 rounded-sm ${ROW_ROLE_STYLE[role].split(" ")[0]}`} />
                <span>
                  {TABLE_ROLE_LABEL[role]}
                  {off ? " (hidden)" : ""}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <table
        className={`border-collapse text-xs ${widths ? "" : "w-full"}`}
        style={total === undefined ? undefined : { tableLayout: "fixed", width: total }}
      >
        <colgroup>
          {data.columns.map((_, index) => (
            <col key={index} style={widths ? { width: widths[index] } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr ref={headRef}>
            {data.columns.map((column, index) => (
              <th
                key={index}
                className="relative border border-zinc-300 px-2 py-1 text-left font-medium dark:border-zinc-700"
              >
                <span className="block truncate">{column}</span>
                {divider(index, column, true)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map(({ row, index }, rowIndex) => {
            const { cells, heading } = readTableRow(row);
            const described = rows?.[index];
            // The described role, not the declared one. A proposal marks its own
            // rows — a reference with a change is a change, one without a reference
            // is an addition — and reading the declaration alone drew every row of a
            // proposed table identically, which is the one thing this view exists to
            // prevent. The declaration still wins where a producer made one, because
            // `describeStructure` prefers it.
            const role = described?.role ?? tableRowRole(row, declaresRoles);
            const related = described?.id === undefined ? [] : (tracesByRow.get(described.id) ?? []);

            if (heading !== undefined) {
              // A chapter spans the table rather than filling its columns: it is not
              // data, and aligning it to the grid would make it look like a row whose
              // other cells went missing.
              const depth = Math.min(Math.max(described?.depth ?? 1, 1), 6);
              return (
                <tr key={rowIndex} data-row-heading={depth} className={role === undefined ? undefined : ROW_ROLE_STYLE[role]}>
                  <th
                    scope="colgroup"
                    colSpan={data.columns.length}
                    style={{ paddingLeft: `${0.5 + (depth - 1) * 0.75}rem` }}
                    className={`border border-zinc-200 bg-zinc-50 py-1 text-left font-semibold dark:border-zinc-800 dark:bg-zinc-900 ${
                      depth === 1 ? "text-xs" : "text-[11px] font-medium"
                    } ${role === "removed" ? "line-through" : ""}`}
                  >
                    {heading}
                  </th>
                </tr>
              );
            }

            return (
              <tr
                key={rowIndex}
                className={role === undefined ? undefined : ROW_ROLE_STYLE[role]}
                data-row-role={role}
                data-row-kind={described?.kind}
                data-row-ref={described?.ref}
              >
                {cells.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    // The strike goes on the cell, not on the row: a decoration set on
                    // a `tr` does not reach the cells inside it — the browser computes
                    // `none` on every one of them, and the one destructive role was
                    // left resting on colour alone.
                    className={`relative border border-zinc-200 px-2 py-1 align-top break-words dark:border-zinc-800 ${
                      role === "removed" ? "line-through" : ""
                    }`}
                  >
                    {cell === null ? <span className="opacity-40">—</span> : String(cell)}
                    {/* Under the first cell, where a reader's eye already is, rather
                        than in a column of its own that would be empty on most rows. */}
                    {cellIndex === 0 && described !== undefined ? (
                      <EnrichmentDetail item={described} traces={related} dispatch={dispatch} />
                    ) : null}
                    {divider(cellIndex, data.columns[cellIndex] ?? "", false)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The envelope as text, indented so it can be read.
 *
 * Taken from the string that arrived rather than from the validated object: what
 * a reader is checking here is what the producer actually sent. Indentation is
 * the only thing changed — `JSON.stringify` keeps key order, so nothing moves.
 */
function envelopeSource(structured: string | undefined, envelope: ValidatedStructuredExchange): string {
  if (structured === undefined) return JSON.stringify(envelope, null, 2);
  try {
    return JSON.stringify(JSON.parse(structured), null, 2);
  } catch {
    // Unreachable by way of the validator, which parsed it first. Shown as it
    // came rather than swallowed, on the chance the two ever disagree.
    return structured;
  }
}

/* ── Textual equivalent ─────────────────────────────────────────────────────── */


/**
 * What the view says, in words.
 *
 * Not a convenience: a diagram states relationships through geometry, and geometry
 * is not data. This is the same information in a form that does not depend on
 * seeing it.
 */

/**
 * Everything the enriched contract lets an item carry, as lines under it.
 *
 * Indented and labelled rather than run together: a reader on the words is reading
 * them because they cannot see the panel, and four kinds of claim — what is true,
 * what the producer expects to find, what it asks to become true, and what it asks
 * to unset — collapse into noise if they arrive as one list. The labels are the
 * same ones the visual presentation uses, so the two can be compared.
 */
function enrichmentLines(item: DescribedEnrichment, indent = "  "): string[] {
  const lines: string[] = [];
  const group = (label: string, entries: string[]) => {
    for (const entry of entries) lines.push(`${indent}${label}: ${entry}`);
  };
  group("attribute", item.attributes.map(([name, value]) => attributeText(name, value)));
  group("expects", item.expectations.map(([name, value]) => attributeText(name, value)));
  group("asks to set", item.assignments.map(([name, value]) => attributeText(name, value)));
  group("asks to unset", item.removedAttributes);
  group("at", item.locations.map((location) => locationText(location)));
  group("artifact", item.artifacts.map((artifact) => artifactText(artifact)));
  return lines;
}

function textualEquivalent(
  envelope: ValidatedStructuredExchange,
  isProposal: boolean,
  hidden: Narrowing = NOTHING_HIDDEN,
): string {
  const described = describeStructure(envelope, isProposal);
  const lines: string[] = [];

  // What the document is, before what it holds. The profile names the vocabulary
  // its kinds and attribute names belong to, and a reader who does not recognise it
  // still needs to be told there is one — it is the difference between "status" as
  // a word and "status" as somebody's defined term.
  if (described.profile !== undefined) lines.push(`Profile: ${described.profile}`);
  if (described.target !== undefined) {
    const revision = described.target.revision === undefined ? "" : `, prepared against ${described.target.revision}`;
    lines.push(`Proposes changes to ${described.target.ref}${revision}`);
    // Said once, here, rather than after every expectation: the conditions below are
    // the producer's, and this application has checked none of them.
    lines.push("Expectations below are the producer's; the receiving authority checks them before applying.");
  }
  for (const artifact of described.artifacts) lines.push(`Artifact — ${artifactText(artifact)}`);
  if (lines.length > 0) lines.push("");

  if (described.columns !== undefined && described.rows !== undefined) {
    // A table leaves this application as these words — there is no figure to
    // export — so a narrowed reading has to say so here or it says so nowhere.
    const roleHidden = (role: string | undefined) => role !== undefined && hidden.has(filterKey("role", role));
    const withheld = described.rows.filter((row) => roleHidden(row.role));
    if (withheld.length > 0) {
      lines.push(
        `Filtered view — ${withheld.length} of ${described.rows.length} rows hidden ` +
          `(${[...new Set(withheld.map((row) => TABLE_ROLE_LABEL[row.role!]))].join(", ")}).`,
      );
      lines.push("");
    }
    lines.push(described.columns.join(" | "));
    for (const row of described.rows) {
      if (roleHidden(row.role)) continue;
      if (row.heading !== undefined) {
        // A chapter, kept in its place among the rows it introduces. Depth is stated
        // rather than drawn, since indentation alone does not survive being read out.
        lines.push("");
        lines.push(`${"#".repeat(row.depth ?? 1)} ${row.heading}${row.role === undefined ? "" : `  (${TABLE_ROLE_LABEL[row.role]})`}`);
        continue;
      }
      const cells = row.cells.map((cell) => (cell === null ? "" : String(cell))).join(" | ");
      const named = row.kind === undefined ? "" : ` [${row.kind}]`;
      lines.push(`${cells}${named}${row.role === undefined ? "" : `  (${TABLE_ROLE_LABEL[row.role]})`}`);
      for (const change of row.changes) lines.push(`  ${changeText(change)}`);
      lines.push(...enrichmentLines(row));
    }

    // Traceability, after the rows it connects: a relation read before either end
    // exists is two identifiers and no meaning.
    if (described.traces.length > 0) {
      lines.push("");
      for (const trace of described.traces) {
        const label = trace.label === undefined ? "" : `: ${trace.label}`;
        lines.push(`${trace.fromLabel} —${trace.kind}${label}→ ${trace.toLabel}`);
      }
    }
  } else {
    // Named and counted, so a reader who cannot see the picture knows how much of it
    // there is — and so a thing nothing connects to is still in the account.
    lines.push(
      [
        `${described.things.length} ${described.thingNoun}s`,
        `${described.links.length} ${described.linkNoun}s`,
        ...(described.containers.length > 0 ? [`${described.containers.length} containers`] : []),
      ].join(", "),
    );
    lines.push("");

    // Named before the things that belong to them, and named even when empty: a
    // reader on the words is reading them *because* they cannot see the boxes, so
    // a container the picture draws and the words omit is, for them, not there.
    if (described.containers.length > 0) {
      for (const container of described.containers) {
        const members = described.things.filter((thing) => thing.container === container.id);
        lines.push(`${container.label}: ${members.length === 0 ? "no members" : members.map((m) => m.label).join(", ")}`);
      }
      lines.push("");
    }

    const containerLabel = new Map(described.containers.map((container) => [container.id, container.label]));
    for (const thing of described.things) {
      const within = thing.container === undefined ? undefined : containerLabel.get(thing.container);
      lines.push(
        [
          thing.label,
          thing.kind === undefined ? "" : ` [${thing.kind}]`,
          within === undefined ? "" : ` in ${within}`,
          thing.role === "unchanged" ? "" : ` (${ROLE_LABEL[thing.role]})`,
          thing.changes.length === 0 ? "" : ` — ${thing.changes.map(changeText).join(", ")}`,
        ].join(""),
      );
      lines.push(...enrichmentLines(thing));
    }

    if (described.links.length > 0) lines.push("");
    described.links.forEach((link, index) => {
      // Both, when both are declared: the type says what kind of connection it is and
      // the label says what this one is, and neither stands in for the other.
      const said = [link.kind, link.label].filter((part) => part !== undefined && part !== "");
      const via = said.length === 0 ? "→" : `—${said.join(": ")}→`;
      lines.push(
        [
          described.linkNoun === "message" ? `${index + 1}. ` : "",
          `${link.fromLabel} ${via} ${link.toLabel}`,
          link.isLoop ? " (to itself)" : "",
          link.role === "unchanged" ? "" : ` (${ROLE_LABEL[link.role]})`,
          link.changes.length === 0 ? "" : ` — ${link.changes.map(changeText).join(", ")}`,
        ].join(""),
      );
      lines.push(...enrichmentLines(link));
    });
  }

  if (described.removals.length > 0) {
    lines.push("");
    for (const removal of described.removals) lines.push(`removed ${removal.type}: ${removal.ref}`);
  }
  return lines.join("\n");
}

/**
 * What a removal is, in words a reader can check.
 *
 * A removal names a reference the authority knows and this application does not: it
 * holds one document, not the authority's model, so it cannot look the reference up.
 * Two things can rescue it. The producer may describe what is going — that is what
 * the optional fields on a removal are for. Failing that, the same reference may
 * appear on something included in the document for context, in which case the
 * document describes it after all.
 *
 * When neither applies, this returns the bare reference, and the caller says so
 * rather than presenting an opaque identifier as though it meant something.
 */
export function describeRemoval(
  removal: StructuredRemoval,
  envelope: ValidatedStructuredExchange,
): string {
  const named = (id: string | undefined): string | undefined => {
    if (id === undefined) return undefined;
    const data = envelope.data as Partial<StructuredGraphData & StructuredSequenceData>;
    const among = [...(data.nodes ?? []), ...(data.participants ?? [])];
    const found = among.find((thing) => thing.id === id || thing.ref === id);
    return found === undefined ? id : displayLabel(found);
  };

  // The document may already carry the thing being removed, included for context
  const data = envelope.data as Partial<StructuredGraphData & StructuredSequenceData>;
  const alsoHere = [...(data.nodes ?? []), ...(data.participants ?? []), ...(data.edges ?? []), ...(data.messages ?? [])].find(
    (thing) => "ref" in thing && thing.ref === removal.ref,
  );

  const endpoints =
    removal.from !== undefined || removal.to !== undefined
      ? `${named(removal.from) ?? "?"} → ${named(removal.to) ?? "?"}`
      : alsoHere !== undefined && "from" in alsoHere
        ? `${named(alsoHere.from)} → ${named(alsoHere.to)}`
        : undefined;

  const label =
    removal.label ??
    (alsoHere === undefined ? undefined : (alsoHere as { label?: string }).label);
  const kind =
    removal.kind ?? (alsoHere === undefined ? undefined : (alsoHere as { kind?: string }).kind);

  const described = [label, kind === undefined ? undefined : `[${kind}]`, endpoints].filter(
    (part) => part !== undefined && part !== "",
  );
  return described.length === 0 ? removal.ref : `${described.join(" ")} (${removal.ref})`;
}

/* ── The presentation ───────────────────────────────────────────────────────── */

/** The control row's link styling, shared with the same controls inside the modal. */
const LINK_BUTTON = "text-xs text-zinc-500 underline hover:text-zinc-800 dark:hover:text-zinc-200";

export interface StructuredExchangeDocumentProps {
  /** Already validated — this component renders documents, it does not judge them. */
  envelope: ValidatedStructuredExchange;
  /** The document as written, for the envelope pane. */
  source: string;
  /**
   * What the tool wrote for the model, when the document came from a tool call.
   *
   * Absent for a document opened as a file: there is no second text there, the
   * file *is* the document, and offering "show original output" would promise a
   * reveal with nothing behind it.
   */
  rawOutput?: string;
  /**
   * How a reader asks to be taken somewhere — the closed set of actions a
   * presentation may request, and nothing wider.
   *
   * Optional, because the file viewer renders a document with no conversation
   * behind it to act on. Without it a location is shown and not followable, which
   * is the same answer this gives for a scheme the safety policy does not allow.
   */
  dispatch?: ActionDispatch;
}

/**
 * One structured-exchange document, rendered.
 *
 * Separated from the presentation entry so that a document opened as a file gets
 * this rendering rather than a second one — same narrowing, same export, same
 * text equivalent. A reader who narrowed a diagram in a conversation finds the
 * same controls over a file, because they are the same controls.
 */
/**
 * What a proposal targets, whichever version stated it.
 *
 * Version 1 wrote a bare string; version 2 writes an object so it can also name the
 * revision. Three places here read the field directly and assumed the older shape —
 * one rendered it, which under version 2 is an object handed to React as a child
 * and takes the whole panel down, and two built filenames that would have read
 * `[object Object]`.
 */
/** The revision a version 2 proposal was prepared against, when it names one. */
function revisionOf(envelope: ValidatedStructuredExchange): string | undefined {
  const target = (envelope as { target?: unknown }).target;
  if (target === null || typeof target !== "object") return undefined;
  const revision = (target as { revision?: unknown }).revision;
  return typeof revision === "string" ? revision : undefined;
}

function targetRef(envelope: ValidatedStructuredExchange): string | undefined {
  const target = (envelope as { target?: unknown }).target;
  if (typeof target === "string") return target;
  if (target !== null && typeof target === "object" && typeof (target as { ref?: unknown }).ref === "string") {
    return (target as { ref: string }).ref;
  }
  return undefined;
}

export function StructuredExchangeDocument({ envelope, source, rawOutput, dispatch }: StructuredExchangeDocumentProps) {
  const [enlarged, setEnlarged] = useState(false);
  const [showText, setShowText] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [showEnvelope, setShowEnvelope] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const diagramRef = useRef<HTMLDivElement>(null);
  const enlargedRef = useRef<HTMLDivElement>(null);
  const [nudges, setNudges] = useState<ReadonlyMap<string, Nudge>>(new Map());
  const [hidden, setHidden] = useState<Narrowing>(NOTHING_HIDDEN);
  /** What the reader chose, when they chose. Undefined means "however it comes out". */
  const [chosenOrientation, setChosenOrientation] = useState<Orientation | undefined>(undefined);
  const mermaid = useMemo(() => toMermaid(envelope), [envelope]);

  const isProposal = envelope.target !== undefined;
  const removals = envelope.removals ?? [];
  const described = useMemo(() => describeStructure(envelope, isProposal), [envelope, isProposal]);
  /**
   * Which way the diagram is drawn: what the reader asked for, or what the figure
   * would choose for itself. Computed here rather than inside the rendering because
   * the control below names it, and because both renderings have to be told the same
   * answer rather than each deciding.
   */
  const chooses = useMemo(
    () =>
      envelope.kind === "graph"
        ? graphOrientationFor(envelope.data as StructuredGraphData, hidden)
        : ("landscape" as Orientation),
    [envelope, hidden],
  );
  const orientation = chosenOrientation ?? chooses;
  /**
   * Turning starts the arrangement again.
   *
   * A nudge is an offset against a layout that stops existing the moment the graph is
   * turned. Carried across, it moves a box away from where the reader put it, in a
   * picture they never arranged — so the honest thing is to drop them with the layout
   * they were measured against.
   */
  const turn = () => {
    // Updated from the previous value rather than from this render's, so two clicks
    // landing in one batch turn twice rather than computing the same answer twice and
    // leaving the second one inert.
    setChosenOrientation((current) => otherOrientation(current ?? chooses));
    setNudges(new Map());
  };
  const view =
    envelope.kind === "graph" ? (
      <GraphView
        data={envelope.data as StructuredGraphData}
        isProposal={isProposal}
        nudges={nudges}
        setNudges={setNudges}
        hidden={hidden}
        setHidden={setHidden}
        orientation={orientation}
      />
    ) : envelope.kind === "sequence" ? (
      <SequenceView data={envelope.data as StructuredSequenceData} isProposal={isProposal} />
    ) : (
      <TableView
        data={envelope.data as StructuredTableData}
        hidden={hidden}
        setHidden={setHidden}
        rows={described.rows}
        traces={described.traces}
        dispatch={dispatch}
      />
    );

  const fileName = `${envelope.kind}-${targetRef(envelope) ?? "diagram"}.svg`.replace(/[^\w.-]+/g, "-");
  const exportBaseName = `${envelope.kind}-${targetRef(envelope) ?? "data"}`.replace(/[^\w.-]+/g, "-");
  // Taken at the moment of export rather than held in state: what leaves is what
  // the reader is looking at, and what they are looking at is what `hidden` says.
  const exportedTable = () => tableExport(envelope.data as StructuredTableData, hidden, described.rows);
  const narrowedExport = envelope.kind === "table" ? exportedTable().withheld : 0;

  /**
   * The diagram's markup, standing on its own — colours and ground included.
   *
   * Taken from whichever copy the reader is actually looking at. The enlarged view
   * is a second instance of the same component with its own adjusted positions, so
   * reading the small one while the modal is open would export a picture the reader
   * had just finished rearranging away from.
   */
  /**
   * Strip what only means something while someone is pointing at it.
   *
   * Two kinds of thing. The canvas carries a cursor and a touch-action so the
   * gestures work; and every edge and key entry carries a transparent shape a
   * pointer can actually hit, because a one-pixel line and a ten-pixel swatch are
   * not targets. Both ride along into a serialized figure where there is no
   * pointer and nothing to drag — harmless to look at, and still wrong to put in a
   * file someone inserts into a document.
   *
   * Taken from the live tree rather than recomputed, because what leaves has to be
   * what the reader arranged: the boxes they dragged are in these positions and in
   * no recomputation of them.
   */
  function withoutInteractionHints(svg: SVGElement): SVGElement {
    const clean = svg.cloneNode(true) as SVGElement;
    for (const hit of clean.querySelectorAll("[data-hit]")) hit.remove();
    for (const element of [clean, ...clean.querySelectorAll<SVGElement>("[style]")]) {
      element.style.removeProperty("cursor");
      element.style.removeProperty("touch-action");
      if (element.getAttribute("style") === "") element.removeAttribute("style");
    }
    return clean;
  }

  function serializeDiagram(): string | undefined {
    const container = enlargedRef.current ?? diagramRef.current;
    const svg = container?.querySelector("svg");
    return svg ? new XMLSerializer().serializeToString(withoutInteractionHints(svg)) : undefined;
  }

  /**
   * Save the diagram as a file.
   *
   * The path that actually works for a document: Word does not accept an SVG
   * pasted from the clipboard — it wants a file, inserted as a picture. Offering
   * only "copy" would look like a feature and fail at the one place it was for.
   */
  function downloadDiagram() {
    const markup = serializeDiagram();
    if (markup === undefined) return;
    const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
    setCopied("SVG downloaded");
    window.setTimeout(() => setCopied(null), 2500);
  }

  /** For anywhere that does take SVG markup directly — an editor, a wiki, a repo. */
  async function copyDiagram() {
    const markup = serializeDiagram();
    if (markup === undefined) return;
    try {
      await navigator.clipboard.writeText(markup);
      setCopied("SVG markup copied");
    } catch {
      setCopied("could not copy");
    }
    window.setTimeout(() => setCopied(null), 2500);
  }

  return (
    // Named so a test can say *which* document it means. The transcript a browser
    // suite drives holds several, and picking "the last one" is an assumption that
    // holds only until somebody adds another — which is exactly how three specs
    // came to be reading a table they were never written about.
    <div className="space-y-3 text-sm" data-testid="structured-document">
      {isProposal && (
        // Not "only what changes is shown" — that stopped being true the moment a
        // producer could include an element for context. The reader is looking at a
        // mixture, and the sentence has to say which half is which, or a box drawn
        // plainly reads as a change nobody marked.
        <p className="text-xs text-zinc-500" data-testid="structured-proposal-note">
          Proposed changes to <span className="font-mono">{targetRef(envelope)}</span>
          {revisionOf(envelope) === undefined ? null : (
            <>
              , prepared against <span className="font-mono">{revisionOf(envelope)}</span>
            </>
          )}
          . Anything not mentioned is left as it is; anything shown without a change is here for context.
        </p>
      )}

      {described.profile === undefined ? null : (
        // Named, never interpreted. A reader who does not recognise the vocabulary
        // still has to be told there is one — it is the difference between "status"
        // as a word and "status" as somebody's defined term. Shown as text: a
        // profile that looks like a URL is not thereby a link.
        <p className="text-xs text-zinc-500" data-testid="structured-profile">
          Vocabulary: <span className="font-mono">{described.profile}</span>
          <span className="ml-1 text-zinc-400">— names what the kinds and attributes mean; not resolved here</span>
        </p>
      )}

      {described.artifacts.length > 0 && (
        <ul className="text-xs text-zinc-500" data-testid="structured-document-artifacts">
          {described.artifacts.map((artifact, index) => (
            <li key={index} className="break-all font-mono">
              {artifactText(artifact)}
            </li>
          ))}
        </ul>
      )}

      {described.traces.length > 0 && (
        // A key, for the same reason roles have one: a reader meeting `verifiedBy`
        // for the first time needs to see the vocabulary in use, and the colour of a
        // relation says nothing on its own.
        <p className="text-xs text-zinc-500" data-testid="structured-relation-key">
          Relations:{" "}
          {[...new Set(described.traces.map((trace) => trace.kind))].map((kind, index) => (
            <span key={kind} className="font-mono">
              {index > 0 ? ", " : ""}
              {kind}
            </span>
          ))}
          <span className="ml-1 text-zinc-400">— declared by the producer; nothing is inferred about what is missing</span>
        </p>
      )}

      {/* Filtering is for reading, and this view is an approval gate: the reader has
          to be told, plainly and while they are looking, that the picture in front of
          them is no longer the whole document. The key inside the SVG carries the same
          news to anywhere the figure is exported to. */}
      {hidden.size > 0 && (
        <p
          data-testid="structured-filtered"
          className="flex flex-wrap items-center gap-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <span>
            Filtered view — {[...hidden].map((key) => key.replace(/^(element|relationship|role):/, "")).join(", ")} hidden.{" "}
            {isProposal ? "The full proposal still applies." : ""}
          </span>
          <button type="button" className="underline" onClick={() => setHidden(new Set())}>
            show everything
          </button>
        </p>
      )}

      {/* Scrolls rather than scaling: a wide diagram squeezed into the chat column
          arrives as a sliver, which is how a seventeen-node architecture rendered as
          an empty line. Enlarge gives the whole thing without the horizontal scrub. */}
      <div ref={diagramRef} className="overflow-x-auto">
        {view}
      </div>
      <EnlargedView
        label={`${envelope.kind} view`}
        open={enlarged}
        onClose={() => setEnlarged(false)}
        containerRef={enlargedRef}
        // The inline diagram stays mounted while the overlay is open, so it is
        // what tells the overlay which tree it has to be rendered into.
        anchorRef={diagramRef}
        actions={
          envelope.kind !== "table" && (
            <>
              <button type="button" onClick={downloadDiagram} className={LINK_BUTTON}>
                ⤓ download SVG
              </button>
              <button type="button" onClick={copyDiagram} className={LINK_BUTTON}>
                copy markup
              </button>
              {copied !== null && <span className="text-xs text-zinc-500">{copied}</span>}
            </>
          )
        }
      >
        {view}
      </EnlargedView>

      {removals.length > 0 && (
        <ul className="space-y-1" data-testid="structured-removals">
          {removals.map((removal, index) => (
            <li
              key={index}
              data-relationship-role="removed"
              className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
            >
              <span className="line-through">{describeRemoval(removal, envelope)}</span>
              {describeRemoval(removal, envelope) === removal.ref && (
                // Said plainly rather than left to be noticed: approving the deletion
                // of a bare identifier is approving something you cannot see, and the
                // reader should know that is what they are being asked to do.
                <span className="ml-2 not-italic opacity-70" data-testid="removal-undescribed">
                  — the proposal does not say what this is
                </span>
              )}
              <span className="ml-2 font-mono opacity-60">{removal.type}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <button
          type="button"
          className="text-zinc-500 underline"
          aria-label={`Show ${envelope.kind} view at full size`}
          onClick={() => setEnlarged(true)}
        >
          ⤢ enlarge
        </button>
        {/* A graph is the only rendering here with an orientation to choose: a
            sequence's lifelines run down and its messages across, and a table has
            neither. Offering the control on those would be a switch that does
            nothing. */}
        {envelope.kind === "graph" && (
          <button
            type="button"
            className="text-zinc-500 underline"
            data-testid="diagram-orientation"
            // Named for what the click does, the way every other control here is. The
            // state it would otherwise have announced is in the title, and in the
            // picture itself.
            title={
              orientation === "portrait"
                ? "Turn it across the page — it is drawn down"
                : "Turn it down the page — it is drawn across"
            }
            aria-label={`Turn the diagram ${otherOrientation(orientation)}`}
            onClick={turn}
          >
            {orientation === "portrait" ? "↔ landscape" : "↕ portrait"}
          </button>
        )}
        {envelope.kind === "table" ? (
          <>
            <button
              type="button"
              className="text-zinc-500 underline"
              title={
                narrowedExport === 0
                  ? "Save as .csv — opens in any spreadsheet"
                  : `Save as .csv — ${narrowedExport} hidden rows are left out`
              }
              onClick={() => downloadCsv(exportedTable(), `${exportBaseName}.csv`)}
            >
              ⤓ download CSV
            </button>
            <button
              type="button"
              className="text-zinc-500 underline"
              title={
                narrowedExport === 0
                  ? "Save as .xlsx — one sheet, values typed as they are declared"
                  : `Save as .xlsx — ${narrowedExport} hidden rows are left out`
              }
              onClick={() => void downloadXlsx(exportedTable(), `${exportBaseName}.xlsx`)}
            >
              ⤓ download XLSX
            </button>
            {narrowedExport > 0 && (
              // Said on the controls, not after the fact: a reader who has hidden a
              // role and exports is otherwise told nothing, and a spreadsheet cannot
              // carry the banner the rendering shows.
              <span className="text-xs text-amber-700 dark:text-amber-300" data-testid="table-export-narrowed">
                exports {narrowedExport} rows fewer than the table declares
              </span>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              className="text-zinc-500 underline"
              title="Save as .svg — insert it as a picture in a document"
              onClick={downloadDiagram}
            >
              ⤓ download SVG
            </button>
            <button
              type="button"
              className="text-zinc-500 underline"
              title="Copy the SVG markup, for somewhere that takes it directly"
              onClick={() => void copyDiagram()}
            >
              copy markup
            </button>
          </>
        )}
        <button type="button" className="text-zinc-500 underline" onClick={() => setShowText((open) => !open)}>
          {showText ? "hide" : "show"} text equivalent
        </button>
        {mermaid !== undefined && (
          <button type="button" className="text-zinc-500 underline" onClick={() => setShowExport((open) => !open)}>
            {showExport ? "hide" : "show"} derived diagram syntax
          </button>
        )}
        <button type="button" className="text-zinc-500 underline" onClick={() => setShowEnvelope((open) => !open)}>
          {showEnvelope ? "hide" : "show"} envelope
        </button>
        {rawOutput !== undefined && (
          <button type="button" className="text-zinc-500 underline" onClick={() => setShowRaw((open) => !open)}>
            {showRaw ? "hide" : "show"} original output
          </button>
        )}
        {copied !== null && (
          <span role="status" className="text-emerald-600 dark:text-emerald-400">
            {copied}
          </span>
        )}
      </div>

      {showText && (
        <pre data-testid="structured-text-equivalent" className="overflow-x-auto rounded bg-zinc-100 p-2 text-xs dark:bg-zinc-800">
          {textualEquivalent(envelope, isProposal, hidden)}
        </pre>
      )}
      {showExport && mermaid !== undefined && (
        <div>
          <p className="mb-1 text-[11px] text-zinc-500">
            Derived from the structured data above. It is an export, not the source.
          </p>
          <pre data-testid="structured-derived-export" className="overflow-x-auto rounded bg-zinc-100 p-2 text-xs dark:bg-zinc-800">
            {mermaid}
          </pre>
        </div>
      )}
      {showEnvelope && (
        <div>
          {/* Everything else on this card is downstream of this document: the
              rendering, the derived syntax, the text equivalent. When a producer
              is wrong — a node marked added that should read as context — the
              envelope is the only artifact that says why, and it was the one
              thing the card did not show. Not the raw output either: that is
              what the tool wrote for the model, and the envelope never reaches
              the model at all. */}
          <p className="mb-1 text-[11px] text-zinc-500">
            The validated document this view is drawn from. It is not sent to the model.
          </p>
          <pre data-testid="structured-envelope" className="max-h-80 overflow-auto rounded bg-zinc-100 p-2 text-xs dark:bg-zinc-800">
            {source}
          </pre>
        </div>
      )}
      {showRaw && rawOutput !== undefined && (
        <pre data-testid="structured-raw-output" className="overflow-x-auto rounded bg-zinc-100 p-2 text-xs dark:bg-zinc-800">
          {rawOutput}
        </pre>
      )}
    </div>
  );
}

/** The presentation entry’s body: validate the tool result, then render it. */
function StructuredExchangeBody({ item, dispatch }: PresentationProps) {
  const envelope = validStructuredExchange(item.structured);
  // Defensive: the registry only selects this entry for a validated envelope, so
  // reaching here without one would be a bug in selection rather than in data.
  if (envelope === undefined) return null;
  return (
    <StructuredExchangeDocument
      envelope={envelope}
      source={envelopeSource(item.structured, envelope)}
      rawOutput={item.output}
      dispatch={dispatch}
    />
  );
}

export const structuredExchangePresentation = {
  id: "structured-exchange",
  /**
   * Only a validated envelope. `match` runs on every candidate, so it must not
   * throw on a malformed one — the registry treats a throwing matcher as a
   * decline, but a matcher that relies on that is a matcher that hides bugs.
   */
  match: (item: ToolItem) => validStructuredExchange(item.structured) !== undefined,
  stable: false,
  showsRawReveal: true,
  startsExpanded: true,
  Expanded: StructuredExchangeBody,
} as const;
