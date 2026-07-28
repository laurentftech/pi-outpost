import { useEffect, useRef, useState } from "react";
import type { ContextUsage, ModelChoice, ThinkingLevel } from "@pi-outpost/shared";
import { THINKING_LEVELS } from "@pi-outpost/shared";

interface ModelBarProps {
  model: string;
  models: ModelChoice[];
  thinkingLevel: string;
  modelSupportsReasoning: boolean;
  isStreaming: boolean;
  contextUsage: ContextUsage | null;
  isCompacting: boolean;
  onSetModel: (provider: string, id: string) => void;
  onSetThinking: (level: ThinkingLevel) => void;
  onCompact: () => void;
}

function ringColor(usage: ContextUsage | null): string {
  if (!usage || usage.percent === null) return "text-zinc-400 dark:text-zinc-600";
  if (usage.percent >= 85) return "text-red-500";
  if (usage.percent >= 60) return "text-amber-500 dark:text-amber-400";
  return "text-emerald-500";
}

/** Radial progress ring: fills clockwise as context usage grows. */
function ContextRing({ usage }: { usage: ContextUsage | null }) {
  const radius = 15.9155;
  const circumference = 2 * Math.PI * radius;
  const percent = usage?.percent ?? 0;
  const filled = (Math.min(100, Math.max(0, percent)) / 100) * circumference;

  return (
    <svg width={18} height={18} viewBox="0 0 36 36" className="-rotate-90 shrink-0">
      <circle
        cx="18"
        cy="18"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        className="text-zinc-200 dark:text-zinc-800"
      />
      {usage && usage.percent !== null && (
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference - filled}`}
          className={ringColor(usage)}
        />
      )}
    </svg>
  );
}

/**
 * 🧠 button showing the current level; clicking opens a popover with a slider
 * scale (off → xhigh). Replaces the old "think: level" dropdown.
 */
function ThinkingControl({
  thinkingLevel,
  isStreaming,
  onSetThinking,
}: Pick<ModelBarProps, "thinkingLevel" | "isStreaming" | "onSetThinking">) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = thinkingLevel !== "off";
  const index = Math.max(0, THINKING_LEVELS.indexOf(thinkingLevel as ThinkingLevel));

  useEffect(() => {
    if (!open) return;
    function onMouseDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={isStreaming}
        title="thinking level"
        aria-haspopup="true"
        aria-expanded={open}
        className={`flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs disabled:opacity-50 ${
          active
            ? "border-amber-300 text-amber-700 hover:border-amber-400 dark:border-amber-900 dark:text-amber-400 dark:hover:border-amber-700"
            : "border-zinc-300 text-zinc-500 hover:border-zinc-400 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600"
        }`}
      >
        <span aria-hidden className={`text-sm leading-none ${active ? "" : "opacity-40 grayscale"}`}>🧠</span>
        {thinkingLevel}
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-1 w-48 rounded-lg border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          <div className="mb-1 flex items-baseline justify-between text-xs">
            <span className="text-zinc-500 dark:text-zinc-400">thinking</span>
            <span className="font-mono text-zinc-700 dark:text-zinc-200">{thinkingLevel}</span>
          </div>
          <input
            type="range"
            min={0}
            max={THINKING_LEVELS.length - 1}
            step={1}
            value={index}
            onChange={(e) => onSetThinking(THINKING_LEVELS[Number(e.target.value)])}
            aria-label="Thinking level"
            aria-valuetext={thinkingLevel}
            className="w-full accent-amber-500"
          />
          <div className="mt-0.5 flex justify-between font-mono text-[9px] text-zinc-400 dark:text-zinc-600">
            <span>{THINKING_LEVELS[0]}</span>
            <span>{THINKING_LEVELS[THINKING_LEVELS.length - 1]}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function ModelBar(props: ModelBarProps) {
  const { model, models, thinkingLevel, modelSupportsReasoning, isStreaming, contextUsage, isCompacting } = props;

  return (
    <div className="mt-2 flex items-center gap-2">
      <select
        value={model}
        onChange={(e) => {
          const choice = models.find((m) => `${m.provider}/${m.id}` === e.target.value);
          if (choice) props.onSetModel(choice.provider, choice.id);
        }}
        disabled={isStreaming}
        className="max-w-64 rounded-md border border-zinc-300 bg-white px-2 py-1 font-mono text-xs text-zinc-700 outline-none hover:border-zinc-400 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-600"
      >
        {!models.some((m) => `${m.provider}/${m.id}` === model) && <option value={model}>{model}</option>}
        {models.map((m) => (
          <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
            {m.provider}/{m.id}
          </option>
        ))}
      </select>

      {modelSupportsReasoning && (
        <ThinkingControl
          thinkingLevel={thinkingLevel}
          isStreaming={isStreaming}
          onSetThinking={props.onSetThinking}
        />
      )}

      <button
        type="button"
        onClick={props.onCompact}
        disabled={isStreaming || isCompacting}
        title={
          contextUsage?.tokens != null
            ? `${contextUsage.tokens.toLocaleString()} / ${contextUsage.contextWindow.toLocaleString()} tokens — click to compact`
            : "Click to compact the conversation context"
        }
        className="ml-auto flex items-center gap-1.5 rounded-md border border-zinc-300 px-2 py-1 font-mono text-xs text-zinc-500 hover:border-zinc-400 disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600"
      >
        <ContextRing usage={contextUsage} />
        {isCompacting ? "compacting…" : contextUsage?.percent != null ? `${Math.round(contextUsage.percent)}%` : "context"}
      </button>
    </div>
  );
}
