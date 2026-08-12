import { useState } from "react";
import {
  formatSize,
  rankRequests,
  rankToolCalls,
  type AnalyzedTurn,
  type SessionAnalysis,
  type ToolRanking,
} from "../util/sessionAnalysis";
import { formatCost, formatTokens } from "../util/sessionUsage";

interface SessionAnalysisPanelProps {
  analysis: SessionAnalysis;
  /** Scrolls the conversation to an item by its index. */
  onJump: (index: number) => void;
  onClose: () => void;
}

/** Below this width the drawer covers the conversation, so a jump has to close it. */
const NARROW_PX = 768;

/** Pixels per turn: a long session scrolls rather than collapsing into a band. */
const STEP = 26;
const CHART_HEIGHT = 132;
const PLOT_TOP = 12;
const PLOT_HEIGHT = 96;
const LABEL_Y = CHART_HEIGHT - 8;

type Series = { key: string; label: string; className: string; value: (turn: AnalyzedTurn) => number };

const TOKEN_SERIES: Series[] = [
  { key: "input", label: "input", className: "text-emerald-500", value: (t) => t.usage.input },
  { key: "output", label: "output", className: "text-blue-500", value: (t) => t.usage.output },
  { key: "cacheRead", label: "cache read", className: "text-violet-500", value: (t) => t.usage.cacheRead },
  { key: "cacheWrite", label: "cache write", className: "text-amber-500", value: (t) => t.usage.cacheWrite },
];

// Only priced turns are plotted (see below): the value is always defined here.
const COST_SERIES: Series[] = [
  { key: "cost", label: "cost", className: "text-rose-500", value: (t) => t.usage.cost ?? 0 },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <h3 className="mb-2 font-mono text-[11px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{title}</h3>
      {children}
    </section>
  );
}

/** Absent data says what is missing; a zero would read as a measurement. */
function Missing({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-zinc-400 dark:text-zinc-500">{children}</p>;
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-zinc-200 px-2 py-1.5 dark:border-zinc-800">
      {/* Labelled so the figure is announced with what it measures, not alone. */}
      <div aria-label={`${label}: ${value}`} className="font-mono text-sm text-zinc-700 dark:text-zinc-200">
        {value}
      </div>
      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{label}</div>
      {hint && <div className="text-[10px] text-zinc-400 dark:text-zinc-500">{hint}</div>}
    </div>
  );
}

/**
 * One line per series over the session's turns, plus a per-turn hit area that
 * jumps to the message. The y-axis sits outside the scrolled area so it stays
 * readable on a long session.
 */
function TurnChart({
  turns,
  series,
  format,
  onJump,
  describe,
}: {
  turns: AnalyzedTurn[];
  series: Series[];
  format: (value: number) => string;
  onJump: (index: number) => void;
  describe: (turn: AnalyzedTurn) => string;
}) {
  const max = Math.max(1, ...turns.flatMap((turn) => series.map((s) => s.value(turn))));
  const width = Math.max(turns.length * STEP, STEP);
  const x = (i: number) => STEP / 2 + i * STEP;
  const y = (value: number) => PLOT_TOP + PLOT_HEIGHT * (1 - value / max);

  return (
    <div>
      <div className="mb-1 flex flex-wrap gap-x-3 gap-y-1">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400">
            <span className={`inline-block h-0.5 w-3 bg-current ${s.className}`} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="flex">
        <div
          aria-hidden
          className="flex w-12 shrink-0 flex-col justify-between py-2 pr-1 text-right font-mono text-[9px] text-zinc-400 dark:text-zinc-600"
          style={{ height: CHART_HEIGHT }}
        >
          <span>{format(max)}</span>
          <span>0</span>
        </div>
        <div className="min-w-0 flex-1 overflow-x-auto">
          {/* `group`, not `img`: an image node would swallow the per-turn jump
              controls below, which are the only way to reach a turn by keyboard. */}
          <svg width={width} height={CHART_HEIGHT} role="group" aria-label="Per-turn chart">
            <line
              x1={0}
              x2={width}
              y1={PLOT_TOP + PLOT_HEIGHT}
              y2={PLOT_TOP + PLOT_HEIGHT}
              stroke="currentColor"
              className="text-zinc-200 dark:text-zinc-800"
            />
            {series.map((s) => (
              <polyline
                key={s.key}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                className={s.className}
                points={turns.map((turn, i) => `${x(i)},${y(s.value(turn))}`).join(" ")}
              />
            ))}
            {turns.map((turn, i) => (
              <g key={turn.index}>
                {series.map((s) => (
                  <circle key={s.key} cx={x(i)} cy={y(s.value(turn))} r={2} fill="currentColor" className={s.className} />
                ))}
                <rect
                  x={x(i) - STEP / 2}
                  y={0}
                  width={STEP}
                  height={CHART_HEIGHT}
                  fill="transparent"
                  role="button"
                  tabIndex={0}
                  aria-label={`Turn ${turn.number}: ${describe(turn)} — jump to it`}
                  className="cursor-pointer outline-none focus-visible:fill-zinc-500/10"
                  onClick={() => onJump(turn.index)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onJump(turn.index);
                    }
                  }}
                >
                  <title>{`turn ${turn.number} · ${describe(turn)}`}</title>
                </rect>
                {(turns.length <= 12 || turn.number % 5 === 0) && (
                  <text x={x(i)} y={LABEL_Y} textAnchor="middle" className="fill-zinc-400 text-[9px] dark:fill-zinc-600">
                    {turn.number}
                  </text>
                )}
              </g>
            ))}
          </svg>
        </div>
      </div>
    </div>
  );
}

function Row({ onJump, label, children }: { onJump: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onJump}
      aria-label={label}
      className="flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-900"
    >
      {children}
    </button>
  );
}

export function SessionAnalysisPanel({ analysis, onJump, onClose }: SessionAnalysisPanelProps) {
  const [ranking, setRanking] = useState<ToolRanking>("output");
  const { totals } = analysis;

  // On a narrow screen the drawer covers the conversation: landing behind it
  // would show nothing, so the jump closes it.
  function jump(index: number) {
    onJump(index);
    if (window.innerWidth < NARROW_PX) onClose();
  }

  const nothingYet = analysis.turns.length === 0 && analysis.toolCalls.length === 0;
  const rankedTools = rankToolCalls(analysis.toolCalls, ranking);
  const rankedRequests = rankRequests(analysis.requests);

  return (
    <aside
      aria-label="Session analysis"
      className="absolute inset-y-0 right-0 z-10 w-full overflow-y-auto border-l border-zinc-200 bg-white shadow-xl md:w-[26rem] dark:border-zinc-800 dark:bg-zinc-950"
    >
      <header className="sticky top-0 flex items-center gap-2 border-b border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="font-mono text-xs text-zinc-600 dark:text-zinc-300">session analysis</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close session analysis"
          className="ml-auto rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
        >
          ×
        </button>
      </header>

      {nothingYet ? (
        <div className="px-4 py-6">
          <Missing>Nothing to analyse yet — no turn has reported figures and no tool has been called.</Missing>
        </div>
      ) : (
        <>
          <Section title="tokens">
            <div className="grid grid-cols-3 gap-2">
              <Tile label="total" value={formatTokens(totals.totalTokens)} />
              <Tile label="fresh input" value={formatTokens(totals.input)} />
              <Tile label="output" value={formatTokens(totals.output)} />
              <Tile label="cache read" value={formatTokens(totals.cacheRead)} />
              <Tile label="cache write" value={formatTokens(totals.cacheWrite)} />
              <Tile label="turns" value={String(analysis.turns.length)} />
            </div>
          </Section>

          <Section title="cost">
            {analysis.pricedTurns === 0 ? (
              <Missing>No turn was priced — this provider reports tokens only.</Missing>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <Tile label="total" value={formatCost(totals.cost)} />
                  <Tile label="average turn" value={formatCost(analysis.averageTurnCost)} />
                  <Tile label="median turn" value={formatCost(analysis.medianTurnCost)} />
                </div>
                <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
                  over {analysis.pricedTurns} priced turn{analysis.pricedTurns === 1 ? "" : "s"}
                  {totals.unpriced > 0 && `, ${totals.unpriced} unpriced`}
                </p>
              </>
            )}
          </Section>

          <Section title="tool calls">
            {analysis.totalToolCalls === 0 ? (
              <Missing>No tool call recorded in this session.</Missing>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <Tile label="calls" value={String(analysis.totalToolCalls)} />
                <Tile label="per turn" value={analysis.toolCallsPerTurn.toFixed(1)} />
                <Tile label="failed" value={String(analysis.failedToolCalls)} />
              </div>
            )}
          </Section>

          <Section title="tokens per turn">
            {analysis.turns.length === 0 ? (
              <Missing>No turn has reported figures yet.</Missing>
            ) : (
              <TurnChart
                turns={analysis.turns}
                series={TOKEN_SERIES}
                format={formatTokens}
                onJump={jump}
                describe={(turn) =>
                  `${formatTokens(turn.usage.totalTokens)} tokens (input ${turn.usage.input}, output ${turn.usage.output}, cache read ${turn.usage.cacheRead}, cache write ${turn.usage.cacheWrite})`
                }
              />
            )}
          </Section>

          <Section title="cost per turn">
            {analysis.pricedTurns === 0 ? (
              <Missing>No turn was priced, so there is no cost to plot.</Missing>
            ) : (
              <>
                {/* Unpriced turns are left out rather than plotted at zero: a drop to
                    $0 would read as a free turn, which is the failure this whole
                    change exists to avoid. */}
                <TurnChart
                  turns={analysis.turns.filter((turn) => turn.usage.cost !== undefined)}
                  series={COST_SERIES}
                  format={formatCost}
                  onJump={jump}
                  describe={(turn) => formatCost(turn.usage.cost ?? 0)}
                />
                {totals.unpriced > 0 && (
                  <p className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-500">
                    {totals.unpriced} unpriced turn{totals.unpriced === 1 ? "" : "s"} left out — they carry no price to plot
                  </p>
                )}
              </>
            )}
          </Section>

          <Section title="costliest tool calls">
            {rankedTools.length === 0 ? (
              <Missing>No tool call recorded in this session.</Missing>
            ) : (
              <>
                <div className="mb-1 flex items-center gap-2">
                  <label htmlFor="tool-ranking" className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    rank by
                  </label>
                  <select
                    id="tool-ranking"
                    value={ranking}
                    onChange={(event) => setRanking(event.target.value as ToolRanking)}
                    className="rounded-md border border-zinc-300 bg-white px-1.5 py-0.5 font-mono text-[11px] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
                  >
                    <option value="output">output size</option>
                    <option value="input">input size</option>
                    <option value="failure">failure</option>
                  </select>
                </div>
                <p className="mb-1 text-[10px] text-zinc-400 dark:text-zinc-500">
                  measured content size, not tokens — a tool call carries no price
                </p>
                {rankedTools.slice(0, 10).map((call) => (
                  <Row
                    key={call.toolCallId || `${call.index}`}
                    onJump={() => jump(call.index)}
                    label={`Jump to the ${call.name} call, output ${formatSize(call.outputSize)}`}
                  >
                    <span className="font-mono text-zinc-600 dark:text-zinc-300">{call.name}</span>
                    {call.isError && <span className="text-red-500">failed</span>}
                    {call.running && <span className="text-zinc-400">running</span>}
                    <span className="ml-auto font-mono text-zinc-500 dark:text-zinc-400">
                      in {formatSize(call.inputSize)} · out {formatSize(call.outputSize)}
                    </span>
                  </Row>
                ))}
              </>
            )}
          </Section>

          <Section title="tools">
            {analysis.tools.length === 0 ? (
              <Missing>No tool has been called yet.</Missing>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase text-zinc-400 dark:text-zinc-500">
                    <th className="font-normal">tool</th>
                    <th className="font-normal">calls</th>
                    <th className="font-normal">failed</th>
                    <th className="text-right font-normal">in / out</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-zinc-600 dark:text-zinc-300">
                  {[...analysis.tools]
                    .sort((a, b) => b.outputSize - a.outputSize)
                    .map((tool) => (
                      <tr key={tool.name}>
                        <td>{tool.name}</td>
                        <td>{tool.calls}</td>
                        <td className={tool.failures > 0 ? "text-red-500" : ""}>{tool.failures}</td>
                        <td className="text-right">
                          {formatSize(tool.inputSize)} / {formatSize(tool.outputSize)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title="costliest requests">
            {rankedRequests.length === 0 ? (
              <Missing>No request has consumed anything yet.</Missing>
            ) : (
              rankedRequests.slice(0, 10).map((request) => (
                <Row
                  key={request.index}
                  onJump={() => jump(request.index)}
                  label={`Jump to the request "${request.title}"`}
                >
                  <span className="min-w-0 flex-1 truncate text-zinc-600 dark:text-zinc-300">{request.title}</span>
                  <span className="shrink-0 font-mono text-zinc-500 dark:text-zinc-400">
                    {formatTokens(request.totalTokens)} tok
                    {request.cost !== undefined && ` · ${formatCost(request.cost)}`}
                  </span>
                  <span className="shrink-0 text-[10px] text-zinc-400 dark:text-zinc-500">
                    {request.turns}t / {request.toolCalls}c
                    {request.failedToolCalls > 0 && ` · ${request.failedToolCalls}✗`}
                  </span>
                </Row>
              ))
            )}
          </Section>
        </>
      )}
    </aside>
  );
}
