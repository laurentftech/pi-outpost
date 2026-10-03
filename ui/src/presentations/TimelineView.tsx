/**
 * A structured-exchange timeline, drawn.
 *
 * Every position comes from `layoutTimeline`; this component only paints it and
 * holds what the reader selected. Three regions: the task labels, which stay put,
 * and beside them one horizontally scrolling area holding the axis header and the
 * rows. Header, rows and the Today line live in that one scrolled area, so they
 * cannot drift apart while the reader scrolls — alignment is structural, not
 * synchronised.
 *
 * Today is read here, from the reader's own calendar, every time this renders. It
 * is never in the document: a plan reopened next month shows next month's today.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { StructuredTimelineData, StructuredTimelineItem, StructuredTimelineScale } from "@pi-outpost/shared/structured-exchange";
import { sharedDeclaredColours, type Tint } from "@pi-outpost/shared/structured-exchange/palette";
import type { ProjectAppearance } from "@pi-outpost/shared/structured-exchange/profile";
import type { FigureGroup } from "@pi-outpost/shared/structured-exchange/figure";
import {
  dayNumber,
  endpointName,
  localToday,
  timelineLabelColumnWidth,
  timelineOpeningScroll,
  TIMELINE_HEADER_HEIGHT,
  TIMELINE_SCALE_PX_PER_DAY,
  type TimelineDependencyLayout,
} from "@pi-outpost/shared/structured-exchange/timeline";
import { serializeFigure } from "@pi-outpost/shared/structured-exchange/figure";
import { withoutComparison } from "@pi-outpost/shared/structured-exchange/timeline-comparison";
import {
  hatch,
  starPath,
  timelineFigure,
  timelineFigureParts,
  TIMELINE_BAR_FILL_OPACITY,
  TIMELINE_MIN_PX_PER_DAY,
} from "@pi-outpost/shared/structured-exchange/timeline-figure";
import { Drawn, FigureMarkers, type Interaction } from "./figureDrawing";

const EMPHASIS = "#2563eb";
const NEUTRAL: Tint = { fill: "#e4e4e7", stroke: "#52525b" };

/**
 * A title as a file name: runs of anything but letters, digits, `.`, `_` and `-` become
 * one `-`, and dashes are trimmed from both ends by walking them rather than by an
 * anchored `-+$`, which backtracks quadratically on a title made of dashes.
 */
export function fileStem(title: string): string {
  const joined = title.replace(/[^\p{L}\p{N}._-]+/gu, "-");
  let start = 0;
  let end = joined.length;
  while (start < end && joined[start] === "-") start += 1;
  while (end > start && joined[end - 1] === "-") end -= 1;
  return joined.slice(start, end);
}

type Selection = { type: "item"; row: number; item: number } | { type: "task"; row: number };

/** A declared scale, or the whole range fitted to the visible width. */
export type TimelineScaleChoice = StructuredTimelineScale | "fit";
const SCALE_CHOICES: TimelineScaleChoice[] = ["week", "month", "quarter", "fit"];

/**
 * How the reader asked for a timeline to be drawn. Presentation only: none of it is in
 * the document, the text equivalent or the details. Held by whoever shows the timeline,
 * so the copy in the conversation and the enlarged one are drawn the same way.
 */
export interface TimelineDisplay {
  scale: TimelineScaleChoice;
  /** One row per section instead of one per task. */
  compact: boolean;
  showDependencies: boolean;
  /** A compared timeline: the comparison, or the new version as a plain plan. */
  comparison: "compare" | "new";
  /** A compared timeline: only the tasks holding a change. */
  onlyChanged: boolean;
}

export function initialTimelineDisplay(plan: StructuredTimelineData): TimelineDisplay {
  return { scale: plan.time.scale, compact: false, showDependencies: true, comparison: "compare", onlyChanged: false };
}

export type TimelineDisplayUpdate = (update: (current: TimelineDisplay) => TimelineDisplay) => void;

function datesOf(item: StructuredTimelineItem): string {
  return item.type === "activity" ? `${item.start} to ${item.end}` : item.date;
}

export function TimelineView({
  data: plan,
  today,
  appearance,
  display: sharedDisplay,
  onDisplayChange,
}: {
  data: StructuredTimelineData;
  today?: number;
  /** The project's kind colours; items share the element vocabulary. */
  appearance?: ProjectAppearance | null;
  /** The display options, when the caller holds them; otherwise this view keeps its own. */
  display?: TimelineDisplay;
  onDisplayChange?: TimelineDisplayUpdate;
}) {
  const day = today ?? localToday();
  const [ownDisplay, setOwnDisplay] = useState(() => initialTimelineDisplay(plan));
  const display = sharedDisplay ?? ownDisplay;
  const updateDisplay: TimelineDisplayUpdate = onDisplayChange ?? setOwnDisplay;
  /** A setter for one option, taking a value or an update of the current one, as `useState`'s does. */
  const option =
    <K extends keyof TimelineDisplay>(key: K) =>
    (next: TimelineDisplay[K] | ((current: TimelineDisplay[K]) => TimelineDisplay[K])) =>
      updateDisplay((current) => ({
        ...current,
        [key]: typeof next === "function" ? (next as (value: TimelineDisplay[K]) => TimelineDisplay[K])(current[key]) : next,
      }));
  /**
   * A compared timeline is drawn as the comparison, or as the new version alone —
   * which is the plan with its comparison taken out, so it draws exactly as the pure
   * plan would. Everything below works on what is shown, so a selection, the details
   * and a download always describe the same rows.
   */
  const isComparison = plan.comparedTo !== undefined;
  const { comparison, onlyChanged, compact, showDependencies, scale } = display;
  const setComparison = option("comparison");
  const setOnlyChanged = option("onlyChanged");
  const data = useMemo(
    () => (isComparison && comparison === "new" ? withoutComparison(plan) : plan),
    [plan, isComparison, comparison],
  );
  const filtering = isComparison && comparison === "compare" && onlyChanged;
  /** Presentation only: one row per section instead of one per task. The document is untouched. */
  const setCompact = option("compact");
  /** Presentation only: hiding arrows changes nothing in the document, the details or the text. */
  const setShowDependencies = option("showDependencies");
  const [selected, setSelected] = useState<Selection | undefined>(undefined);
  /**
   * Presentation only: the scale the reader draws at. It opens at the one the plan
   * declares; fit draws the whole range in the visible width and follows it.
   */
  const setScale = option("scale");
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [viewWidth, setViewWidth] = useState(0);
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    setViewWidth(scroller.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    // The scroller's width is set by the page, never by the drawing inside it, so
    // redrawing to its width cannot feed back into it. The frame keeps the update
    // out of the observer's own callback.
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setViewWidth(scroller.clientWidth));
    });
    observer.observe(scroller);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);
  const span = (dayNumber(data.time.end) ?? 0) - (dayNumber(data.time.start) ?? 0) + 1;
  /**
   * Fit fills the view with the whole range, its header in whatever unit that leaves
   * room for. A chosen scale is a least density: a plan shorter than the view at that
   * scale is stretched to fill it rather than leave it empty, and keeps the chosen unit.
   */
  const fitted = viewWidth > 0 ? viewWidth / span : 0;
  const density =
    scale === "fit"
      ? { pxPerDay: Math.max(TIMELINE_MIN_PX_PER_DAY, fitted) }
      : { pxPerDay: Math.max(TIMELINE_SCALE_PX_PER_DAY[scale], fitted), unit: scale };
  /** The item holding keyboard focus, so it can be ringed: an SVG group draws no outline of its own. */
  const [focused, setFocused] = useState<string | undefined>(undefined);
  const parts = useMemo(
    () =>
      timelineFigureParts(data, {
        today: day,
        compact,
        showDependencies,
        appearance: appearance ?? null,
        referenceLine: "today",
        onlyChanged: filtering,
        ...density,
        ...(selected === undefined ? {} : { selection: selected.type === "item" ? { row: selected.row, item: selected.item } : { row: selected.row } }),
      }),
    // `density` is rebuilt each render; what it holds is the scale and the width.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, day, compact, showDependencies, appearance, selected, filtering, scale, viewWidth],
  );
  const laid = parts.layout;
  const tints = parts.tints;
  /** Worth offering only where a separator has a task under it to fold. */
  const compactable = useMemo(() => {
    let inSection = false;
    for (const row of data.rows) {
      if (row.type === "separator") inSection = true;
      else if (inSection) return true;
    }
    return false;
  }, [data]);
  const sharedColours = useMemo(() => sharedDeclaredColours(laid.kinds, tints), [laid.kinds, tints]);
  const labelWidth = useMemo(() => timelineLabelColumnWidth(data), [data]);
  /** Which shapes carry each kind, so the legend draws a bar, a star, or both. */
  const kindShapes = useMemo(() => {
    const shapes = new Map<string, { activity: boolean; milestone: boolean }>();
    for (const row of data.rows) {
      if (row.type !== "task") continue;
      for (const item of row.items) {
        if (item.kind === undefined) continue;
        const shape = shapes.get(item.kind) ?? { activity: false, milestone: false };
        shape[item.type] = true;
        shapes.set(item.kind, shape);
      }
    }
    return shapes;
  }, [data]);

  const tintOf = (kind: string | undefined) => (kind === undefined ? NEUTRAL : (tints.get(kind) ?? NEUTRAL));

  const toggle = (next: Selection) =>
    setSelected((current) =>
      current !== undefined &&
      current.type === next.type &&
      current.row === next.row &&
      (current.type === "task" || (next.type === "item" && current.item === next.item))
        ? undefined
        : next,
    );

  const activate = (event: KeyboardEvent, next: Selection) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle(next);
    }
  };

  /**
   * What the browser adds to a drawn item: a button a pointer and a keyboard can
   * press, and a focus ring, since an SVG group draws no outline of its own.
   */
  const interaction = (group: FigureGroup): Interaction => {
    const row = group.data?.row;
    const item = group.data?.item;
    if ((group.testId !== "timeline-activity" && group.testId !== "timeline-milestone") || row === undefined || item === undefined) {
      return {};
    }
    const target: Selection = { type: "item", row: Number(row), item: Number(item) };
    const key = `${row}:${item}`;
    const placed = laid.items.find((candidate) => candidate.row === target.row && candidate.item === target.item);
    return {
      extra: {
        role: "button",
        tabIndex: 0,
        "aria-label": group.title,
        "aria-pressed": group.data?.selected === "true",
        style: { cursor: "pointer", outline: "none" },
        onClick: () => toggle(target),
        onKeyDown: (event) => activate(event, target),
        onFocus: () => setFocused(key),
        onBlur: () => setFocused((current) => (current === key ? undefined : current)),
      },
      before:
        placed === undefined ? undefined : (
          <>
            {/* The glyph's square, there to be pressed: a star is a path, and drawn paths
                take no pointer, so without it only a milestone's label answered a click. */}
            <rect
              data-testid="timeline-hit"
              x={placed.glyph.x}
              y={placed.glyph.y}
              width={placed.glyph.width}
              height={placed.glyph.height}
              fill="transparent"
            />
            {focused === key && (
              <rect
                data-testid="timeline-focus-ring"
                x={placed.glyph.x - 3}
                y={placed.glyph.y - 3}
                width={placed.glyph.width + 6}
                height={placed.glyph.height + 6}
                rx={4}
                fill="none"
                stroke={EMPHASIS}
                strokeWidth={1.5}
                strokeDasharray="3 2"
              />
            )}
          </>
        ),
    };
  };


  const [copied, setCopied] = useState<string | null>(null);
  /** The figure as a file would hold it: these display options, a dated line, nothing selected. */
  const figureMarkup = () =>
    serializeFigure(
      timelineFigure(data, {
        today: day,
        compact,
        showDependencies,
        onlyChanged: filtering,
        appearance: appearance ?? null,
        referenceLine: "dated",
        // At the scale on screen; a fitted view at the density it is drawn at.
        ...density,
      }),
    );
  const figureName = `timeline-${fileStem(data.title ?? "plan") || "plan"}.svg`;
  const downloadFigure = () => {
    const url = URL.createObjectURL(new Blob([figureMarkup()], { type: "image/svg+xml" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = figureName;
    link.click();
    URL.revokeObjectURL(url);
    setCopied("SVG downloaded");
    window.setTimeout(() => setCopied(null), 2500);
  };
  const copyFigure = async () => {
    try {
      await navigator.clipboard.writeText(figureMarkup());
      setCopied("SVG markup copied");
    } catch {
      setCopied("could not copy");
    }
    window.setTimeout(() => setCopied(null), 2500);
  };

  /**
   * Open on what the plan is about: a comparison on its first change, anything else
   * on today. A plan wider than its viewport otherwise opens on its first month, and
   * the question it exists to answer is a scroll away. Once, when the view mounts:
   * after that the scroll position is the reader's, and moving it back under them
   * would be the view fighting its user.
   */
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    const opening = timelineOpeningScroll(laid, scroller.clientWidth);
    if (opening !== undefined) scroller.scrollLeft = opening;
    // Mount only, on purpose; see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Changing scale keeps the date at the middle of the view where it was. Read
   * before the change, applied once the new drawing is laid out — the only scroll
   * the view makes after it opens.
   */
  const middleDay = useRef<number | undefined>(undefined);
  const chooseScale = (next: TimelineScaleChoice) => {
    const scroller = scrollerRef.current;
    if (scroller !== null) middleDay.current = laid.start + (scroller.scrollLeft + scroller.clientWidth / 2) / parts.pxPerDay;
    setScale(next);
  };
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const middle = middleDay.current;
    middleDay.current = undefined;
    if (scroller === null || middle === undefined) return;
    scroller.scrollLeft = Math.max(0, (middle - laid.start) * parts.pxPerDay - scroller.clientWidth / 2);
  }, [parts.pxPerDay, laid.start]);

  return (
    <div
      data-testid="timeline"
      className="w-full min-w-0 rounded border border-zinc-200 bg-white text-zinc-800 dark:border-zinc-700"
      onKeyDown={(event) => {
        if (event.key === "Escape") setSelected(undefined);
      }}
    >
      {data.title !== undefined && data.title !== "" && (
        <p className="border-b border-zinc-200 px-2 py-1 text-sm font-medium" data-testid="timeline-title">
          {data.title}
        </p>
      )}
      {isComparison && comparison === "compare" && (
        <p className="border-b border-zinc-200 px-2 py-0.5 text-xs text-zinc-500" data-testid="timeline-compared-to">
          Compared with <span className="font-medium text-zinc-700">{plan.comparedTo!.label}</span>
          {plan.comparedTo!.date === undefined ? "" : ` (${plan.comparedTo!.date})`}
        </p>
      )}
      <div className="flex">
        {/* The labels, outside the scrolled area: they stay in view however far the
            reader scrolls the time axis. */}
        <div className="shrink-0 border-r border-zinc-200 text-xs" style={{ width: labelWidth }} data-testid="timeline-labels">
          <div style={{ height: TIMELINE_HEADER_HEIGHT }} />
          {laid.rows.map((row) =>
            row.type === "section" ? (
              <div
                key={row.row}
                data-testid="timeline-section-label"
                className="flex items-center border-t border-zinc-400 px-2 font-semibold text-zinc-600"
                style={{ height: row.height }}
                title={`${row.label ?? "Untitled section"}: ${row.tasks.length} ${row.tasks.length === 1 ? "task" : "tasks"}`}
              >
                <span className="truncate">{row.label ?? ""}</span>
                <span className="ml-1 shrink-0 font-normal text-zinc-400">({row.tasks.length})</span>
              </div>
            ) : row.type === "separator" ? (
              <div
                key={row.row}
                data-testid="timeline-separator-label"
                className="flex items-end border-t border-zinc-400 px-2 font-semibold text-zinc-600"
                style={{ height: row.height }}
              >
                {row.label ?? ""}
              </div>
            ) : (
              <button
                key={row.row}
                type="button"
                data-testid="timeline-task-label"
                aria-pressed={selected?.type === "task" && selected.row === row.row}
                className={
                  "block w-full truncate border-t border-zinc-100 px-2 text-left hover:bg-zinc-50 " +
                  (selected?.type === "task" && selected.row === row.row ? "bg-blue-50 font-medium" : "")
                }
                style={{ height: row.height }}
                title={`${row.label} (${row.id})`}
                onClick={() => toggle({ type: "task", row: row.row })}
              >
                {row.label}
              </button>
            ),
          )}
        </div>

        <div ref={scrollerRef} className="min-w-0 flex-1 overflow-x-auto" data-testid="timeline-scroller">
          {/* Both drawn from the figure parts the writer saves: the picture on screen and
              the picture in a file are one decision. Only pointing and selection are added. */}
          <svg
            width={laid.width}
            height={TIMELINE_HEADER_HEIGHT}
            role="img"
            aria-label={`Calendar from ${data.time.start} to ${data.time.end}`}
            data-testid="timeline-header"
            xmlns="http://www.w3.org/2000/svg"
            style={{ display: "block" }}
          >
            {parts.header.map((group) => (
              <Drawn key={group.id} group={group} />
            ))}
          </svg>
          <svg
            width={laid.width}
            height={laid.height}
            // A group, not the image an SVG is exposed as by default: an image's
            // children are presentational, which hid every selectable item from
            // assistive technology while the keyboard could still reach them.
            role="group"
            aria-label={`Tasks and items${data.title ? ` of ${data.title}` : ""}`}
            data-testid="timeline-body"
            xmlns="http://www.w3.org/2000/svg"
            style={{ display: "block" }}
          >
            <FigureMarkers markers={parts.markers} />
            {parts.rows.map((group) => (
              <Drawn key={group.id} group={group} interaction={interaction} />
            ))}
          </svg>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 px-2 py-1 text-xs">
          <span className="flex items-center gap-1 text-zinc-500" role="group" aria-label="Scale" data-testid="timeline-scale">
            {SCALE_CHOICES.map((choice, index) => (
              <span key={choice} className="flex items-center gap-1">
                {index > 0 && <span aria-hidden="true">·</span>}
                <button
                  type="button"
                  data-scale={choice}
                  aria-pressed={scale === choice}
                  className={scale === choice ? "font-semibold text-zinc-800" : "text-zinc-600 underline"}
                  onClick={() => chooseScale(choice)}
                >
                  {choice}
                </button>
              </span>
            ))}
          </span>
          {isComparison && (
            <button
              type="button"
              data-testid="timeline-comparison-toggle"
              aria-pressed={comparison === "new"}
              className="text-zinc-600 underline"
              onClick={() => {
                // Rows differ between the two views; a selection names a row.
                setSelected(undefined);
                setComparison((view) => (view === "compare" ? "new" : "compare"));
              }}
            >
              {comparison === "compare" ? "new version only" : "show the comparison"}
            </button>
          )}
          {isComparison && comparison === "compare" && (
            <button
              type="button"
              data-testid="timeline-only-changed-toggle"
              aria-pressed={onlyChanged}
              className="text-zinc-600 underline"
              onClick={() => {
                setSelected(undefined);
                setOnlyChanged((on) => !on);
              }}
            >
              {onlyChanged ? "show every task" : "only what moved"}
            </button>
          )}
          {filtering && laid.hiddenTasks > 0 && (
            <span className="text-amber-700" data-testid="timeline-unchanged-hidden">
              {laid.hiddenTasks} unchanged {laid.hiddenTasks === 1 ? "task" : "tasks"} hidden
            </span>
          )}
          {compactable && (
            <button
              type="button"
              data-testid="timeline-compact-toggle"
              aria-pressed={compact}
              className="text-zinc-600 underline"
              onClick={() => {
                // A selected task label stops existing in the compact view; keep an item
                // selection, which survives, and drop a task one rather than strand it.
                setSelected((current) => (current?.type === "task" ? undefined : current));
                setCompact((on) => !on);
              }}
            >
              {compact ? "one row per task" : "one row per section"}
            </button>
          )}
          {(data.dependencies ?? []).length > 0 && (
          <button
            type="button"
            data-testid="timeline-dependencies-toggle"
            aria-pressed={!showDependencies}
            className="text-zinc-600 underline"
            onClick={() => setShowDependencies((shown) => !shown)}
          >
            {showDependencies ? "hide dependencies" : "show dependencies"}
          </button>
          )}
          {!showDependencies && (
            // Said while the reader looks: a plan drawn without its arrows reads as one
            // whose tasks are independent.
            <span className="text-amber-700" data-testid="timeline-dependencies-hidden">
              {laid.dependencies.length} {laid.dependencies.length === 1 ? "dependency" : "dependencies"} hidden
              {laid.dependencies.some((arrow) => !arrow.satisfied) ? ", some not satisfied by the dates" : ""}
            </span>
          )}
          {/* Built from the figure, not the live drawing: what leaves is what the writer
              would produce for these options, with a dated line and no selection. */}
          <button type="button" data-testid="timeline-download-svg" className="text-zinc-600 underline" onClick={downloadFigure}>
            ⤓ download SVG
          </button>
          <button type="button" data-testid="timeline-copy-svg" className="text-zinc-600 underline" onClick={() => void copyFigure()}>
            copy markup
          </button>
          {copied !== null && (
            <span role="status" className="text-emerald-700">
              {copied}
            </span>
          )}
        </div>

      {isComparison && comparison === "compare" && (
        <p className="flex flex-wrap items-center gap-3 border-t border-zinc-200 px-2 py-1 text-xs text-zinc-500" data-testid="timeline-comparison-key">
          <span className="flex items-center gap-1">
            <svg width={18} height={12} aria-hidden="true">
              <rect x={1} y={2} width={16} height={8} rx={2} fill="none" stroke="#71717a" strokeDasharray="4 3" />
            </svg>
            previous dates
          </span>
          <span>
            <i>(new)</i>: added since
          </span>
          <span>
            <span className="line-through">removed</span>: dropped since
          </span>
        </p>
      )}

      {(laid.periods.length > 0 || laid.references.length > 0) && (
        // Every period and reference by name and dates: the header names only those it has room for.
        <ul className="flex flex-wrap gap-3 border-t border-zinc-200 px-2 py-1 text-xs text-zinc-600" data-testid="timeline-calendar-legend">
          {laid.periods.map((period) => {
            const declared = data.periods![period.index];
            return (
              <li
                key={`p${period.index}`}
                className="flex items-center gap-1"
                data-period={period.index}
                title={`${declared.label ?? "Period"}: ${declared.start} – ${declared.end}`}
              >
                <span
                  aria-hidden="true"
                  className="inline-block h-2.5 w-4 rounded-sm"
                  style={{ background: period.kind === undefined ? "#a1a1aa" : tintOf(period.kind).stroke, opacity: 0.35 }}
                />
                {declared.label ?? "Period"}
              </li>
            );
          })}
          {laid.references.map((marked) => (
            <li
              key={`r${marked.index}`}
              className="flex items-center gap-1"
              data-reference={marked.index}
              title={`${marked.label}: ${data.references![marked.index].date}`}
            >
              <span
                aria-hidden="true"
                className="inline-block h-3 border-l-2 border-dashed"
                style={{ borderColor: marked.kind === undefined ? "#3f3f46" : tintOf(marked.kind).stroke }}
              />
              {marked.label}
            </li>
          ))}
        </ul>
      )}

      {laid.kinds.some((kind) => kindShapes.has(kind)) && (
        <ul className="flex flex-wrap gap-3 border-t border-zinc-200 px-2 py-1 text-xs" data-testid="timeline-legend">
          {laid.kinds.filter((kind) => kindShapes.has(kind)).map((kind) => {
            const tint = tintOf(kind);
            return (
              <li
                key={kind}
                className="flex items-center gap-1"
                data-kind={kind}
                {...(tint.declared === true
                  ? { "data-colour-source": "project", title: `${kind} — project colour` }
                  : {})}
              >
                {/* Drawn as what carries the kind: a bar, a star, or both. A star beside a
                    kind only activities carry sent the reader looking for milestones. */}
                {kindShapes.get(kind)?.activity && (
                  <svg width={18} height={12} aria-hidden="true" data-testid="timeline-legend-bar">
                    <rect
                      x={1}
                      y={2}
                      width={16}
                      height={8}
                      rx={2}
                      fill={tint.stroke}
                      fillOpacity={TIMELINE_BAR_FILL_OPACITY}
                      stroke={tint.stroke}
                    />
                    {tint.hatch !== undefined &&
                      hatch(1, 2, 16, 8, tint.hatch, tint.stroke, 4, 0.8).map((line, index) =>
                        line.shape === "line" ? (
                          <line key={index} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke={line.stroke} strokeWidth={line.strokeWidth} opacity={line.opacity} />
                        ) : null,
                      )}
                  </svg>
                )}
                {kindShapes.get(kind)?.milestone && (
                  <svg width={14} height={14} aria-hidden="true" data-testid="timeline-legend-star">
                    <path d={starPath(7, 7, 6)} fill={tint.stroke} />
                  </svg>
                )}
                <span className="font-mono">{kind}</span>
                {tint.declared === true && <span className="sr-only"> (project colour)</span>}
                {sharedColours.has(kind) && (
                  <span className="text-zinc-500" data-testid="timeline-legend-shared">
                    (same colour as {sharedColours.get(kind)!.join(", ")})
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {selected !== undefined && <TimelineDetails data={data} selection={selected} dependencies={laid.dependencies} />}
    </div>
  );
}

/** What the reader selected, said in full: task, type, dates, label, kind, and its dependencies. */
function TimelineDetails({
  data,
  selection,
  dependencies,
}: {
  data: StructuredTimelineData;
  selection: Selection;
  dependencies: TimelineDependencyLayout[];
}) {
  const task = data.rows[selection.row];
  if (task?.type !== "task") return null;
  const item = selection.type === "item" ? task.items[selection.item] : undefined;
  const id = selection.type === "task" ? task.id : item?.id;
  const predecessors = id === undefined ? [] : dependencies.filter((arrow) => arrow.to === id);
  const successors = id === undefined ? [] : dependencies.filter((arrow) => arrow.from === id);
  const line = (arrow: TimelineDependencyLayout, other: string) => (
    <li key={arrow.index} data-satisfied={String(arrow.satisfied)} className={arrow.satisfied ? "" : "text-red-700"}>
      {endpointName(data, other)} — {arrow.type}
      {arrow.satisfied ? "" : " — not satisfied by the dates"}
    </li>
  );
  return (
    <div className="border-t border-zinc-200 px-2 py-1 text-xs" data-testid="timeline-details" role="status">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        <dt className="text-zinc-500">Task</dt>
        <dd>
          {task.label} <span className="font-mono text-zinc-500">({task.id})</span>
        </dd>
        {item !== undefined && (
          <>
            <dt className="text-zinc-500">Type</dt>
            <dd>{item.type}</dd>
            <dt className="text-zinc-500">{item.type === "activity" ? "Dates" : "Date"}</dt>
            <dd className="font-mono">{datesOf(item)}</dd>
            {item.label !== undefined && (
              <>
                <dt className="text-zinc-500">Label</dt>
                <dd>{item.label}</dd>
              </>
            )}
            {item.kind !== undefined && (
              <>
                <dt className="text-zinc-500">Kind</dt>
                <dd className="font-mono">{item.kind}</dd>
              </>
            )}
            {item.id !== undefined && (
              <>
                <dt className="text-zinc-500">Identifier</dt>
                <dd className="font-mono">{item.id}</dd>
              </>
            )}
          </>
        )}
        {predecessors.length > 0 && (
          <>
            <dt className="text-zinc-500">Waits on</dt>
            <dd>
              <ul data-testid="timeline-predecessors">{predecessors.map((arrow) => line(arrow, arrow.from))}</ul>
            </dd>
          </>
        )}
        {successors.length > 0 && (
          <>
            <dt className="text-zinc-500">Needed by</dt>
            <dd>
              <ul data-testid="timeline-successors">{successors.map((arrow) => line(arrow, arrow.to))}</ul>
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}
