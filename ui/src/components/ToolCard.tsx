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
  const pressedAt = useRef<{ x: number; y: number } | null>(null);

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
      {/*
        The header toggles as a whole, but only the dot and name are the <button>. Chrome
        drops the click when it lands on a scrollable element inside a <button>, and the
        call line has to scroll: a long command cut with "…" left no way to read the rest
        of it. Outside the button it scrolls, can be selected and copied, and its clicks
        still reach the header. The button is what the keyboard reaches; its own click
        bubbles here, so there is one handler.
      */}
      <div
        onMouseDown={(event) => { pressedAt.current = { x: event.clientX, y: event.clientY }; }}
        onClick={(event) => {
          // A press that moved is a selection being made, to copy the command, not a
          // request to fold. Distance rather than the selection itself: inside the
          // widget's shadow root, window.getSelection() reports the host. A keyboard
          // activation (detail 0) has no press to measure.
          const pressed = pressedAt.current;
          pressedAt.current = null;
          if (event.detail > 0 && pressed && Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 4) return;
          setOpen(!open);
        }}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left"
      >
        <button
          type="button"
          aria-expanded={open}
          aria-label={item.callHtml ? item.toolName : undefined}
          className="flex shrink-0 items-center gap-2"
        >
          <span className={`h-2 w-2 shrink-0 rounded-full ${
            item.running ? "animate-pulse motion-reduce:animate-none bg-amber-400" : item.isError ? "bg-red-500" : "bg-emerald-500"
          }`} />
          {!item.callHtml && (
            <span className="font-mono font-medium text-zinc-700 dark:text-zinc-300">{item.toolName}</span>
          )}
        </button>
        {item.callHtml ? (
          <RenderedHtml as="span" html={item.callHtml} className="min-w-0 flex-1 text-zinc-700 dark:text-zinc-300" />
        ) : (
          summary && (
            // No visible scrollbar: on a one-line header an overlay scrollbar covers the
            // text itself — it greys it out on macOS and swallows the click that should
            // fold the card. Trackpad, Shift+wheel and a selection drag still scroll it.
            <span className="min-w-0 overflow-x-auto whitespace-nowrap font-mono text-xs text-zinc-500 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{summary}</span>
          )
        )}
        <span className="ml-auto text-xs text-zinc-400 dark:text-zinc-600">{open ? "▾" : "▸"}</span>
      </div>
      {item.running && item.progress != null && (
        <div className="border-t border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
          <progress
            value={item.progress}
            max={1}
            aria-label={`${item.toolName} progress`}
            className="h-1.5 w-full appearance-none overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800 [&::-moz-progress-bar]:bg-emerald-500 [&::-webkit-progress-bar]:bg-transparent [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-emerald-500"
          />
        </div>
      )}
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
