import { useEffect, useId, useMemo, useState } from "react";
import type { WorkPlan, WorkPlanResource, WorkPlanStatus, WorkPlanTask } from "@pi-outpost/shared";

const STATUS: Record<WorkPlanStatus, { icon: string; label: string; className: string }> = {
  todo: { icon: "○", label: "To do", className: "text-zinc-500" },
  in_progress: { icon: "●", label: "In progress", className: "text-blue-600 dark:text-blue-400" },
  done: { icon: "✓", label: "Done", className: "text-emerald-600 dark:text-emerald-400" },
  blocked: { icon: "!", label: "Blocked", className: "text-red-600 dark:text-red-400" },
  needs_review: { icon: "?", label: "Needs review", className: "text-amber-600 dark:text-amber-400" },
};

const PREVIEW_TASK_LIMIT = 8;

interface WorkPlanPanelProps {
  plan: WorkPlan;
  open: boolean;
  onToggle(): void;
  onOpenWorkspace(path: string): void;
  requestedTaskId?: string | null;
  /** Called once the request above has been applied, so it is not replayed. */
  onTaskRequestHandled?(): void;
}

function workspacePath(resource: WorkPlanResource): string | null {
  const candidate = resource.uri.startsWith("workspace:")
    ? resource.uri.slice("workspace:".length)
    : !/^[a-z][a-z0-9+.-]*:/i.test(resource.uri)
      ? resource.uri
      : null;
  if (candidate === null || candidate === "" || /^(?:[\\/]|[a-z]:[\\/])/i.test(candidate)) return null;
  if (candidate.replaceAll("\\", "/").split("/").includes("..")) return null;
  return candidate;
}

export function WorkPlanPanel({ plan, open, onToggle, onOpenWorkspace, requestedTaskId, onTaskRequestHandled }: WorkPlanPanelProps) {
  const previewId = useId();
  const [previewVisible, setPreviewVisible] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [missingTaskId, setMissingTaskId] = useState<string | null>(null);
  // A navigation is an event, not a mode: applied once and then given back. Left
  // standing it would re-select its task on every plan update — the agent edits
  // the plan constantly — and quietly undo whatever the reader had selected since.
  useEffect(() => {
    if (!requestedTaskId) return;
    if (plan.tasks.some((task) => task.id === requestedTaskId)) {
      setSelectedId(requestedTaskId);
      setMissingTaskId(null);
    } else {
      setSelectedId(null);
      setMissingTaskId(requestedTaskId);
    }
    onTaskRequestHandled?.();
  }, [plan.tasks, requestedTaskId, onTaskRequestHandled]);
  useEffect(() => {
    if (selectedId !== null && !plan.tasks.some((task) => task.id === selectedId)) setSelectedId(null);
  }, [plan, selectedId]);
  useEffect(() => {
    if (!previewVisible) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewVisible(false);
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [previewVisible]);

  const children = useMemo(() => {
    const result = new Map<string | undefined, WorkPlanTask[]>();
    for (const task of plan.tasks) result.set(task.parentId, [...(result.get(task.parentId) ?? []), task]);
    return result;
  }, [plan.tasks]);
  const byId = useMemo(() => new Map(plan.tasks.map((task) => [task.id, task])), [plan.tasks]);
  const previewTasks = useMemo(() => {
    const result: Array<{ task: WorkPlanTask; depth: number }> = [];
    const visit = (parentId: string | undefined, depth: number) => {
      for (const task of children.get(parentId) ?? []) {
        result.push({ task, depth });
        visit(task.id, depth + 1);
      }
    };
    visit(undefined, 0);
    return result.slice(0, PREVIEW_TASK_LIMIT);
  }, [children]);
  const selected = selectedId ? byId.get(selectedId) : undefined;
  const done = plan.tasks.filter((task) => task.status === "done").length;

  const rows = (parentId: string | undefined, depth = 0): React.ReactNode[] =>
    (children.get(parentId) ?? []).flatMap((task) => {
      const status = STATUS[task.status];
      return [
        <button key={task.id} type="button" role="treeitem" aria-level={depth + 1} aria-selected={selectedId === task.id} onClick={() => setSelectedId(task.id)} aria-current={task.status === "in_progress" ? "step" : undefined}
          className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 ${selectedId === task.id ? "bg-zinc-100 dark:bg-zinc-800" : ""}`}
          style={{ paddingLeft: `${0.5 + depth * 0.85}rem` }}>
          <span className={`mt-px w-4 shrink-0 text-center font-semibold ${status.className}`} aria-label={status.label}>{status.icon}</span>
          <span className={task.status === "done" ? "text-zinc-500 line-through" : "text-zinc-800 dark:text-zinc-200"}>{task.title}</span>
        </button>,
        ...rows(task.id, depth + 1),
      ];
    });

  if (!open) return (
    <div className="absolute right-3 top-3 z-20" onMouseEnter={() => setPreviewVisible(true)} onMouseLeave={() => setPreviewVisible(false)} onFocusCapture={() => setPreviewVisible(true)} onBlurCapture={() => setPreviewVisible(false)}>
      <button type="button" onClick={() => { setPreviewVisible(false); onToggle(); }} className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-900" aria-label="Open Work Plan" aria-describedby={previewId}>Plan {done}/{plan.tasks.length}</button>
      <div id={previewId} role="tooltip" className={`absolute right-0 top-full w-72 pt-2 ${previewVisible ? "block" : "hidden"}`}>
        <div className="rounded-md border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"><ul className="space-y-1">
          {previewTasks.map(({ task, depth }) => <li key={task.id} className="flex min-w-0 items-start gap-1.5 text-xs" style={{ paddingLeft: `${depth * 0.75}rem` }}>
            <span aria-label={STATUS[task.status].label} className={`shrink-0 font-semibold ${STATUS[task.status].className}`}>{task.status === "done" ? "☑" : "☐"}</span>
            <span className={`truncate ${task.status === "done" ? "text-zinc-500 line-through" : "text-zinc-800 dark:text-zinc-200"}`}>{task.title}</span>
          </li>)}
        </ul>
        {plan.tasks.length > previewTasks.length && <div className="mt-1 text-[11px] text-zinc-500">+{plan.tasks.length - previewTasks.length} more</div>}
        </div>
      </div>
    </div>
  );

  return (
    <aside aria-label="Work Plan" className="absolute inset-y-0 right-0 z-10 flex w-full max-w-full flex-col border-l border-zinc-200 bg-white/95 shadow-lg backdrop-blur md:w-[min(23rem,100%)] dark:border-zinc-800 dark:bg-zinc-950/95">
      <header className="border-b border-zinc-200 px-3 py-3 dark:border-zinc-800">
        <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Work Plan</div><h2 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{plan.title}</h2></div><button type="button" onClick={onToggle} className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Close Work Plan">×</button></div>
        <div className="mt-2 text-xs text-zinc-500">Progress: {done} / {plan.tasks.length}</div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" aria-hidden><div className="h-full bg-emerald-500" style={{ width: `${plan.tasks.length === 0 ? 0 : (done / plan.tasks.length) * 100}%` }} /></div>
      </header>
      <div role="tree" aria-label="Work Plan tasks" className="min-h-0 flex-1 overflow-y-auto p-2">{rows(undefined)}</div>
      {missingTaskId && <div role="status" className="border-t border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">That Outcome task no longer exists in the current Work Plan.</div>}
      {selected && <section aria-label="Task details" className="max-h-[45%] overflow-y-auto border-t border-zinc-200 p-3 text-xs dark:border-zinc-800">
        <div className={`font-semibold ${STATUS[selected.status].className}`}>{STATUS[selected.status].label}</div><h3 className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{selected.title}</h3>
        {selected.description && <p className="mt-2 whitespace-pre-wrap text-zinc-600 dark:text-zinc-300">{selected.description}</p>}
        {selected.statusReason && <p className="mt-2 rounded bg-zinc-100 p-2 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">{selected.statusReason}</p>}
        {selected.dependsOn.length > 0 && <div className="mt-3"><span className="font-semibold">Depends on:</span> {selected.dependsOn.map((id) => byId.get(id)?.title ?? id).join(", ")}</div>}
        {selected.resources.length > 0 && <div className="mt-3 space-y-1"><div className="font-semibold">Resources</div>{selected.resources.map((resource) => { const target = workspacePath(resource); const label = resource.label ?? resource.uri; if (target !== null) return <button key={resource.uri} type="button" className="block max-w-full truncate text-left text-blue-600 hover:underline dark:text-blue-400" onClick={() => onOpenWorkspace(target)}>{label}</button>; if (/^https?:/i.test(resource.uri)) return <a key={resource.uri} href={resource.uri} target="_blank" rel="noreferrer" className="block truncate text-blue-600 hover:underline dark:text-blue-400">{label}</a>; return <span key={resource.uri} className="block truncate text-zinc-500" title="No navigator is available for this resource">{label}</span>; })}</div>}
      </section>}
    </aside>
  );
}
