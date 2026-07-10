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
        <select
          value={thinkingLevel}
          onChange={(e) => props.onSetThinking(e.target.value as ThinkingLevel)}
          disabled={isStreaming}
          className="rounded-md border border-zinc-300 bg-white px-2 py-1 font-mono text-xs text-zinc-700 outline-none hover:border-zinc-400 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-600"
          title="thinking level"
        >
          {THINKING_LEVELS.map((level) => (
            <option key={level} value={level}>
              think: {level}
            </option>
          ))}
        </select>
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
