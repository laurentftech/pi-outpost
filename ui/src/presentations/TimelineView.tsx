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
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { StructuredTimelineData, StructuredTimelineItem } from "@pi-outpost/shared/structured-exchange";
import { assignTints, sharedDeclaredColours, type Tint } from "@pi-outpost/shared/structured-exchange/palette";
import type { ProjectAppearance } from "@pi-outpost/shared/structured-exchange/profile";
import {
  calendarDate,
  dependencyText,
  endpointName,
  layoutTimeline,
  localToday,
  timelineLabelColumnWidth,
  TIMELINE_HEADER_HEIGHT,
  TIMELINE_STAR_RADIUS,
  TIMELINE_TODAY_BAND,
  TIMELINE_YEAR_BAND,
  type TimelineDependencyLayout,
  type TimelineItemLayout,
} from "@pi-outpost/shared/structured-exchange/timeline";

const INK = "#27272a";
const MUTED = "#71717a";
const RULE = "#e4e4e7";
const TODAY = "#ea580c";
const UNSATISFIED = "#dc2626";
const EMPHASIS = "#2563eb";
const NEUTRAL: Tint = { fill: "#e4e4e7", stroke: "#52525b" };
/**
 * A kinded bar is filled with its kind's own colour, lightened. The palette's pale
 * fill was made for boxes that carry text and read as near-white on a thin bar, so
 * kinded activities looked as grey as untyped ones. Light enough for a label inside.
 */
const BAR_FILL_OPACITY = 0.35;

type Selection = { type: "item"; row: number; item: number } | { type: "task"; row: number };

/** The five points of a star, round a centre. */
function starPath(cx: number, cy: number, radius: number): string {
  const points: string[] = [];
  for (let index = 0; index < 10; index++) {
    const r = index % 2 === 0 ? radius : radius * 0.45;
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    points.push(`${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`);
  }
  return `M${points.join("L")}Z`;
}

function datesOf(item: StructuredTimelineItem): string {
  return item.type === "activity" ? `${item.start} to ${item.end}` : item.date;
}

export function TimelineView({
  data,
  today,
  appearance,
}: {
  data: StructuredTimelineData;
  today?: number;
  /** The project's kind colours; items share the element vocabulary. */
  appearance?: ProjectAppearance | null;
}) {
  const markerId = useId().replace(/:/g, "");
  const day = today ?? localToday();
  /** Presentation only: one row per section instead of one per task. The document is untouched. */
  const [compact, setCompact] = useState(false);
  const laid = useMemo(() => layoutTimeline(data, day, { compact }), [data, day, compact]);
  /** Worth offering only where a separator has a task under it to fold. */
  const compactable = useMemo(() => {
    let inSection = false;
    for (const row of data.rows) {
      if (row.type === "separator") inSection = true;
      else if (inSection) return true;
    }
    return false;
  }, [data]);
  const tints = useMemo(() => assignTints(laid.kinds, appearance?.kinds), [laid.kinds, appearance]);
  const sharedColours = useMemo(() => sharedDeclaredColours(laid.kinds, tints), [laid.kinds, tints]);
  const labelWidth = useMemo(() => timelineLabelColumnWidth(data), [data]);
  const [selected, setSelected] = useState<Selection | undefined>(undefined);
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
  /** Presentation only: hiding arrows changes nothing in the document, the details or the text. */
  const [showDependencies, setShowDependencies] = useState(true);
  /** The item holding keyboard focus, so it can be ringed: an SVG group draws no outline of its own. */
  const [focused, setFocused] = useState<string | undefined>(undefined);

  const tintOf = (kind: string | undefined) => (kind === undefined ? NEUTRAL : (tints.get(kind) ?? NEUTRAL));
  const itemOf = (row: number, item: number) => {
    const holder = data.rows[row];
    return holder?.type === "task" ? holder.items[item] : undefined;
  };

  /** The identifier the selection answers to, for finding its dependencies. */
  const selectedId = (() => {
    if (selected === undefined) return undefined;
    const row = data.rows[selected.row];
    if (row?.type !== "task") return undefined;
    return selected.type === "task" ? row.id : row.items[selected.item]?.id;
  })();
  const involves = (arrow: TimelineDependencyLayout) =>
    selectedId !== undefined && (arrow.from === selectedId || arrow.to === selectedId);

  const dependenciesOf = (id: string | undefined) => ({
    predecessors: id === undefined ? [] : laid.dependencies.filter((arrow) => arrow.to === id),
    successors: id === undefined ? [] : laid.dependencies.filter((arrow) => arrow.from === id),
  });

  const itemName = (layout: TimelineItemLayout) => {
    const item = itemOf(layout.row, layout.item)!;
    const task = data.rows[layout.row];
    const taskName = task.type === "task" ? `task "${task.label}" (${task.id})` : "";
    const { predecessors, successors } = dependenciesOf(item.id);
    const linked = predecessors.length + successors.length;
    const unsatisfied = [...predecessors, ...successors].filter((arrow) => !arrow.satisfied).length;
    return [
      `${item.type} ${datesOf(item)}`,
      item.label === undefined ? undefined : item.label,
      item.kind === undefined ? undefined : `kind ${item.kind}`,
      taskName,
      linked === 0 ? undefined : `${linked} ${linked === 1 ? "dependency" : "dependencies"}${unsatisfied > 0 ? `, ${unsatisfied} not satisfied` : ""}`,
    ]
      .filter((part) => part !== undefined)
      .join(", ");
  };

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

  const isSelected = (layout: TimelineItemLayout) =>
    selected?.type === "item" && selected.row === layout.row && selected.item === layout.item;

  const inRange = "x" in laid.today ? laid.today : undefined;
  const outside = "outside" in laid.today ? laid.today : undefined;

  /**
   * Open on today. A plan wider than its viewport otherwise opens on its first
   * month, and the question it exists to answer — where are we now? — is a scroll
   * away. Once, when the view mounts: after that the scroll position is the
   * reader's, and moving it back under them would be the view fighting its user.
   */
  const scrollerRef = useRef<HTMLDivElement>(null);
  const todayX = inRange?.x;
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null || todayX === undefined) return;
    if (todayX > scroller.clientWidth * 0.8) scroller.scrollLeft = Math.max(0, todayX - scroller.clientWidth / 3);
    // Mount only, on purpose; see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          <svg
            width={laid.width}
            height={TIMELINE_HEADER_HEIGHT}
            role="img"
            aria-label={`Calendar from ${data.time.start} to ${data.time.end}`}
            data-testid="timeline-header"
            xmlns="http://www.w3.org/2000/svg"
            style={{ display: "block" }}
          >
            <rect x={0} y={0} width={laid.width} height={TIMELINE_HEADER_HEIGHT} fill="#ffffff" />
            {laid.years.map((year) => (
              <g key={`${year.label}-${year.x}`} data-testid="timeline-year">
                <line x1={year.x} x2={year.x} y1={TIMELINE_TODAY_BAND} y2={TIMELINE_HEADER_HEIGHT} stroke={MUTED} />
                <text x={year.x + 4} y={TIMELINE_TODAY_BAND + 14} fontSize={11} fontWeight={600} fill={INK}>
                  {year.label}
                </text>
              </g>
            ))}
            {/* The year again at each quarter that does not open a year band: scrolled
                past January, a reader would otherwise see months with no year at all. */}
            {laid.months
              .filter((month, index) => index > 0 && month.month % 3 === 0 && month.month !== 0)
              .map((month) => (
                <text
                  key={`year-${month.x}`}
                  data-testid="timeline-year-repeat"
                  x={month.x + 4}
                  y={TIMELINE_TODAY_BAND + 14}
                  fontSize={11}
                  fill={MUTED}
                >
                  {month.year}
                </text>
              ))}
            {laid.months.map((month) => (
              <text
                key={`${month.label}-${month.x}`}
                data-testid="timeline-month"
                x={month.x + month.width / 2}
                y={TIMELINE_TODAY_BAND + TIMELINE_YEAR_BAND + 14}
                fontSize={10}
                textAnchor="middle"
                fill={MUTED}
              >
                {month.width >= 24 ? month.label : ""}
              </text>
            ))}
            {laid.monthLines.map((x) => (
              <line
                key={x}
                x1={x}
                x2={x}
                y1={TIMELINE_TODAY_BAND + TIMELINE_YEAR_BAND}
                y2={TIMELINE_HEADER_HEIGHT}
                stroke={RULE}
              />
            ))}
            <line x1={0} x2={laid.width} y1={TIMELINE_HEADER_HEIGHT - 0.5} y2={TIMELINE_HEADER_HEIGHT - 0.5} stroke={MUTED} />
            {inRange !== undefined && (
              <g data-testid="timeline-today-tag">
                <rect x={inRange.x - 22} y={1} width={44} height={TIMELINE_TODAY_BAND - 3} rx={3} fill={TODAY} />
                <text x={inRange.x} y={12} fontSize={10} fontWeight={600} textAnchor="middle" fill="#ffffff">
                  Today
                </text>
                <line x1={inRange.x} x2={inRange.x} y1={TIMELINE_TODAY_BAND - 2} y2={TIMELINE_HEADER_HEIGHT} stroke={TODAY} strokeWidth={2} />
              </g>
            )}
            {outside !== undefined && (
              <text
                data-testid="timeline-today-outside"
                data-side={outside.outside}
                x={outside.outside === "before" ? 4 : laid.width - 4}
                y={12}
                fontSize={10}
                fontWeight={600}
                textAnchor={outside.outside === "before" ? "start" : "end"}
                fill={TODAY}
              >
                {outside.outside === "before"
                  ? `◂ Today (${calendarDate(outside.day)}) is before this range`
                  : `Today (${calendarDate(outside.day)}) is after this range ▸`}
              </text>
            )}
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
            <defs>
              {(["plain", "unsatisfied", "emphasis"] as const).map((variant) => (
                <marker
                  key={variant}
                  id={`${markerId}-${variant}`}
                  viewBox="0 0 8 8"
                  refX={8}
                  refY={4}
                  markerWidth={7}
                  markerHeight={7}
                  orient="auto-start-reverse"
                >
                  <path
                    d="M0,0 L8,4 L0,8 Z"
                    fill={variant === "plain" ? MUTED : variant === "unsatisfied" ? UNSATISFIED : EMPHASIS}
                  />
                </marker>
              ))}
            </defs>
            <rect x={0} y={0} width={laid.width} height={laid.height} fill="#ffffff" />
            {laid.monthLines.map((x) => (
              <line key={x} x1={x} x2={x} y1={0} y2={laid.height} stroke={RULE} />
            ))}
            {laid.rows.map((row) =>
              row.type === "section" ? (
                <line
                  key={row.row}
                  data-testid="timeline-section"
                  x1={0}
                  x2={laid.width}
                  y1={row.y + 0.5}
                  y2={row.y + 0.5}
                  stroke="#a1a1aa"
                  strokeWidth={1.5}
                />
              ) : row.type === "separator" ? (
                <g key={row.row} data-testid="timeline-separator">
                  <rect x={0} y={row.y} width={laid.width} height={row.height} fill="#f4f4f5" />
                  <line x1={0} x2={laid.width} y1={row.y + 0.5} y2={row.y + 0.5} stroke="#a1a1aa" strokeWidth={1.5} />
                </g>
              ) : (
                <line key={row.row} x1={0} x2={laid.width} y1={row.y + 0.5} y2={row.y + 0.5} stroke="#f4f4f5" />
              ),
            )}

            {/* Arrows before glyphs and labels, so no annotation is ever under one. */}
            {(showDependencies ? laid.dependencies : []).map((arrow) => {
              const emphasised = involves(arrow);
              const variant = emphasised ? "emphasis" : arrow.satisfied ? "plain" : "unsatisfied";
              return (
                <polyline
                  key={arrow.index}
                  data-testid="timeline-dependency"
                  data-from={arrow.from}
                  data-to={arrow.to}
                  data-type={arrow.type}
                  data-satisfied={String(arrow.satisfied)}
                  data-emphasised={String(emphasised)}
                  points={arrow.points.map((point) => `${point.x},${point.y}`).join(" ")}
                  fill="none"
                  stroke={emphasised ? EMPHASIS : arrow.satisfied ? MUTED : UNSATISFIED}
                  strokeWidth={emphasised ? 2.25 : 1.25}
                  strokeDasharray={arrow.satisfied ? undefined : "4 3"}
                  markerEnd={`url(#${markerId}-${variant})`}
                >
                  <title>{dependencyText(data, data.dependencies![arrow.index], arrow.satisfied)}</title>
                </polyline>
              );
            })}

            {laid.items.map((layout) => {
              const tint = tintOf(layout.kind);
              const chosen = isSelected(layout);
              const name = itemName(layout);
              const target: Selection = { type: "item", row: layout.row, item: layout.item };
              return (
                <g
                  key={`${layout.row}:${layout.item}`}
                  data-testid={`timeline-${layout.type}`}
                  data-row={layout.row}
                  data-item={layout.item}
                  data-kind={layout.kind}
                  data-selected={String(chosen)}
                  role="button"
                  tabIndex={0}
                  aria-label={name}
                  aria-pressed={chosen}
                  style={{ cursor: "pointer", outline: "none" }}
                  onClick={() => toggle(target)}
                  onKeyDown={(event) => activate(event, target)}
                  onFocus={() => setFocused(`${layout.row}:${layout.item}`)}
                  onBlur={() => setFocused((current) => (current === `${layout.row}:${layout.item}` ? undefined : current))}
                >
                  <title>{name}</title>
                  {focused === `${layout.row}:${layout.item}` && (
                    <rect
                      data-testid="timeline-focus-ring"
                      x={layout.glyph.x - 3}
                      y={layout.glyph.y - 3}
                      width={layout.glyph.width + 6}
                      height={layout.glyph.height + 6}
                      rx={4}
                      fill="none"
                      stroke={EMPHASIS}
                      strokeWidth={1.5}
                      strokeDasharray="3 2"
                    />
                  )}
                  {layout.type === "activity" ? (
                    <rect
                      x={layout.glyph.x}
                      y={layout.glyph.y}
                      width={layout.glyph.width}
                      height={layout.glyph.height}
                      rx={3}
                      fill={layout.kind === undefined ? tint.fill : tint.stroke}
                      fillOpacity={layout.kind === undefined ? 1 : BAR_FILL_OPACITY}
                      stroke={chosen ? EMPHASIS : tint.stroke}
                      strokeWidth={chosen ? 2.5 : 1.25}
                      strokeDasharray={tint.dash}
                    />
                  ) : (
                    <path
                      d={starPath(layout.center!.x, layout.center!.y, TIMELINE_STAR_RADIUS)}
                      fill={tint.stroke}
                      stroke={chosen ? EMPHASIS : "#ffffff"}
                      strokeWidth={chosen ? 2 : 0.75}
                    />
                  )}
                  {layout.label !== undefined && (
                    <text
                      data-testid="timeline-annotation"
                      x={layout.label.x}
                      y={layout.label.y + 12}
                      fontSize={11}
                      fill={INK}
                      // A halo, so a label stays legible where a reference line or an
                      // arrow passes behind it.
                      stroke={layout.label.inside ? undefined : "#ffffff"}
                      strokeWidth={layout.label.inside ? undefined : 3}
                      paintOrder="stroke"
                    >
                      {layout.label.text}
                    </text>
                  )}
                </g>
              );
            })}

            {inRange !== undefined && (
              <line
                data-testid="timeline-today"
                x1={inRange.x}
                x2={inRange.x}
                y1={0}
                y2={laid.height}
                stroke={TODAY}
                strokeWidth={2}
                pointerEvents="none"
                opacity={0.85}
              />
            )}
          </svg>
        </div>
      </div>

      {((data.dependencies ?? []).length > 0 || compactable) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 px-2 py-1 text-xs">
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
        </div>
      )}

      {laid.kinds.length > 0 && (
        <ul className="flex flex-wrap gap-3 border-t border-zinc-200 px-2 py-1 text-xs" data-testid="timeline-legend">
          {laid.kinds.map((kind) => {
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
                      fillOpacity={BAR_FILL_OPACITY}
                      stroke={tint.stroke}
                      strokeDasharray={tint.dash}
                    />
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
