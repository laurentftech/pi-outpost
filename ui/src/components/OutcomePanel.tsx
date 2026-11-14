import type { OutcomeEntry, OutcomeStatus, OutcomeTarget } from "@pi-outpost/shared";
import type { OutcomeState } from "../useAgent";

const STATUS: Partial<Record<OutcomeStatus, { label: string; className: string }>> = {
  todo: { label: "To do", className: "text-zinc-500" },
  in_progress: { label: "In progress", className: "text-blue-600 dark:text-blue-400" },
  done: { label: "Done", className: "text-emerald-600 dark:text-emerald-400" },
  blocked: { label: "Blocked", className: "text-red-600 dark:text-red-400" },
  needs_review: { label: "Needs review", className: "text-amber-600 dark:text-amber-400" },
  passed: { label: "Passed", className: "text-emerald-600 dark:text-emerald-400" },
  failed: { label: "Failed", className: "text-red-600 dark:text-red-400" },
  inconclusive: { label: "Inconclusive", className: "text-amber-600 dark:text-amber-400" },
  informational: { label: "Informational", className: "text-zinc-500" },
  modified: { label: "Modified", className: "text-blue-600 dark:text-blue-400" },
  added: { label: "Added", className: "text-emerald-600 dark:text-emerald-400" },
  deleted: { label: "Deleted", className: "text-red-600 dark:text-red-400" },
  untracked: { label: "Untracked", className: "text-zinc-600 dark:text-zinc-300" },
  conflicted: { label: "Conflicted", className: "text-red-600 dark:text-red-400" },
  unavailable: { label: "Unavailable", className: "text-red-600 dark:text-red-400" },
  "not-recorded": { label: "Not recorded", className: "text-zinc-500" },
};

function statusOf(status: OutcomeStatus) {
  return STATUS[status] ?? { label: status, className: "text-zinc-500" };
}

function Entry({ entry, onTarget }: { entry: OutcomeEntry; onTarget(target: OutcomeTarget): void }) {
  const status = statusOf(entry.status);
  const content = <>
    <div className="flex items-start justify-between gap-3">
      <span className="min-w-0 break-words text-sm font-medium text-zinc-900 dark:text-zinc-100">{entry.title}</span>
      <span className={`shrink-0 text-[11px] font-semibold uppercase tracking-wide ${status.className}`}>{status.label}</span>
    </div>
    {entry.group && <div className="mt-0.5 text-[11px] text-zinc-500">{entry.group}</div>}
    {entry.detail && <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-600 dark:text-zinc-300">{entry.detail}</p>}
    {entry.reference && <div className="mt-1 truncate text-xs text-zinc-500">{entry.reference}</div>}
    <div className="mt-1 text-[10px] uppercase tracking-wide text-zinc-400">{entry.source}</div>
  </>;
  const box = "block w-full rounded-md border border-zinc-200 p-2 text-left hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900";
  if (entry.target?.kind === "external-url") return <a href={entry.target.url} target="_blank" rel="noreferrer" className={box}>{content}</a>;
  if (entry.target) return <button type="button" onClick={() => onTarget(entry.target!)} className={box}>{content}</button>;
  return <div className="rounded-md border border-zinc-200 p-2 dark:border-zinc-800">{content}</div>;
}

export function OutcomePanel({ state, onClose, onRefresh, onTarget }: {
  state: OutcomeState | null;
  onClose(): void;
  onRefresh(): void;
  onTarget(target: OutcomeTarget): void;
}) {
  return <aside aria-label="Workspace Outcome" className="absolute inset-y-0 right-0 z-10 flex w-full max-w-full flex-col border-l border-zinc-200 bg-white/95 shadow-lg backdrop-blur md:w-[min(26rem,100%)] dark:border-zinc-800 dark:bg-zinc-950/95">
    <header className="flex items-start justify-between gap-2 border-b border-zinc-200 px-3 py-3 dark:border-zinc-800">
      <div><div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Workspace review</div><h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Outcome</h2></div>
      <div className="flex gap-1">
        <button type="button" onClick={onRefresh} className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">Refresh</button>
        <button type="button" onClick={onClose} className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Close Outcome">×</button>
      </div>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      {state === null || state.status === "loading" ? <div role="status" className="text-sm text-zinc-500">Loading Outcome…</div> : state.status === "error" ? <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{state.message}</div> : <div className="space-y-4">
        {state.outcome.sections.map((section) => <section key={section.id} aria-labelledby={`outcome-${section.id}`} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <div className="flex items-center justify-between gap-2">
            <h3 id={`outcome-${section.id}`} className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{section.title}</h3>
            {section.availability === "partial" || section.availability === "unavailable" ? <span className="text-[11px] font-semibold uppercase text-red-600 dark:text-red-400">{section.availability}</span> : null}
          </div>
          {section.summary && <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">{section.summary}</p>}
          {section.entries.length > 0 && <div className="mt-3 space-y-2">{section.entries.map((entry) => <Entry key={entry.id} entry={entry} onTarget={onTarget} />)}</div>}
        </section>)}
      </div>}
    </div>
  </aside>;
}
