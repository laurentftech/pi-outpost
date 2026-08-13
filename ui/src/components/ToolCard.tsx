import { useEffect, useRef, useState } from "react";
import { RenderedHtml } from "./RenderedHtml";
import { noopDispatch } from "../presentations/actions";
import { RawBody } from "../presentations/builtin";
import { selectPresentation } from "../presentations/registry";
import type { ActionDispatch, ToolItem } from "../presentations/types";

/** One-line summary of tool args (command for bash, path for file tools…). */
function argsSummary(args: unknown): string {
  if (args === null || typeof args !== "object") return "";
  const record = args as Record<string, unknown>;
  const key = ["command", "path", "file_path", "pattern", "query"].find(
    (k) => typeof record[k] === "string",
  );
  if (key) return record[key] as string;
  const json = JSON.stringify(record);
  return json === "{}" ? "" : json;
}

export function ToolCard({ item, dispatch = noopDispatch }: { item: ToolItem; dispatch?: ActionDispatch }) {
  // The presentation already on screen, so a specialized choice made while the
  // call was running survives its output landing (see presentations/registry.ts).
  const shown = useRef<string | undefined>(undefined);
  const presentation = selectPresentation(item, shown.current);
  shown.current = presentation.id;

  const startsExpanded = presentation.startsExpanded === true;
  const [open, setOpen] = useState(startsExpanded);
  // A call that turns into a diff mid-stream opens itself; the reader did not
  // choose the folded state, so replacing it is not overriding them.
  useEffect(() => { setOpen(startsExpanded); }, [startsExpanded]);
  const [showRaw, setShowRaw] = useState(false);

  const summary = argsSummary(item.args);
  const Collapsed = presentation.Collapsed;
  const showCollapsed =
    !open && Collapsed !== undefined && (presentation.hasCollapsed?.(item) ?? true);

  return (
    <div
      className={`rounded-lg border text-sm ${
        item.isError
          ? "border-red-300 bg-red-50 dark:border-red-900/60 dark:bg-red-950/20"
          : "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${
          item.running ? "animate-pulse motion-reduce:animate-none bg-amber-400" : item.isError ? "bg-red-500" : "bg-emerald-500"
        }`} />
        {item.callHtml ? (
          <RenderedHtml as="span" html={item.callHtml} className="min-w-0 flex-1 text-zinc-700 dark:text-zinc-300" />
        ) : (
          <>
            <span className="font-mono font-medium text-zinc-700 dark:text-zinc-300">{item.toolName}</span>
            {summary && (
              <span className="truncate font-mono text-xs text-zinc-500">{summary}</span>
            )}
          </>
        )}
        <span className="ml-auto text-xs text-zinc-400 dark:text-zinc-600">{open ? "▾" : "▸"}</span>
      </button>
      {showCollapsed && Collapsed !== undefined && (
        <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <Collapsed item={item} dispatch={dispatch} />
        </div>
      )}
      {open && (
        <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <presentation.Expanded item={item} dispatch={dispatch} />
          {presentation.showsRawReveal === true && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowRaw(!showRaw)}
                className="text-xs text-zinc-400 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-400"
              >
                {showRaw ? "hide raw output" : "raw output"}
              </button>
              {showRaw && (
                <div className="mt-1">
                  <RawBody item={item} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
