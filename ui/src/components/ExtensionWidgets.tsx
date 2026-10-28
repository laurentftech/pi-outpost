import { useLayoutEffect, useRef } from "react";
import type { ExtensionWidget } from "../useAgent";
import { AnsiText } from "./AnsiText";

/** What the client adds to one widget it knows. Every field is optional. */
export interface WidgetControl {
  /** Close control: its accessible label, and what it does. */
  close?: { label: string; run: () => void };
  /** The scrolling region's accessible name. */
  region?: string;
  /** Leading lines kept in place while the rest scrolls — a title. */
  pinnedLines?: number;
  /** The line to bring to the top of the region whenever the lines change; -1 for none. */
  anchor?: (lines: readonly string[]) => number;
}

/**
 * Renders extension setWidget() content — see extensions.md#custom-ui. String-array widgets only (no factories).
 *
 * A widget named in `controls` may get a close control. A widget is the extension's to show and to
 * clear, so closing asks the extension (`/btw` alone, for pi-outpost's side answer) rather than
 * hiding it here: every client loses it, and a question still waiting is cancelled.
 */
export function ExtensionWidgets({
  widgets,
  placement,
  controls = {},
}: {
  widgets: Record<string, ExtensionWidget>;
  placement: "aboveEditor" | "belowEditor";
  controls?: Record<string, WidgetControl>;
}) {
  const entries = Object.entries(widgets).filter(([, w]) => w.placement === placement);
  if (entries.length === 0) return null;
  return (
    <div className="mb-2 flex flex-col gap-1">
      {entries.map(([key, widget]) => (
        <Widget key={key} name={key} lines={widget.lines} control={controls[key] ?? {}} />
      ))}
    </div>
  );
}

function Line({ text }: { text: string }) {
  // An empty line is a blank line, not nothing: it is how a widget separates its parts.
  return (
    <div className="min-h-4">
      <AnsiText text={text} />
    </div>
  );
}

function Widget({ name, lines, control }: { name: string; lines: string[]; control: WidgetControl }) {
  const region = useRef<HTMLDivElement>(null);
  const pinned = lines.slice(0, control.pinnedLines ?? 0);
  const scrolled = lines.slice(pinned.length);
  const anchor = control.anchor ? control.anchor(lines) - pinned.length : -1;

  // Each new content brings its anchor line to the top: the latest answer is read from its start,
  // and what came before stays one scroll up.
  useLayoutEffect(() => {
    const element = region.current;
    const target = anchor >= 0 ? (element?.children[anchor] as HTMLElement | undefined) : undefined;
    // The region is positioned, so a line's offsetTop is measured from the region itself.
    if (element && target) element.scrollTop = target.offsetTop;
  }, [lines, anchor]);

  return (
    <div
      data-widget={name}
      className="flex items-start gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 font-mono text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
    >
      <div className="min-w-0 flex-1 whitespace-pre-wrap">
        {pinned.map((line, index) => (
          <Line key={index} text={line} />
        ))}
        {/* Bounded, or a long answer pushes the composer off the screen. Focusable, so that once
            clicked or tabbed to, the arrow and page keys scroll it — the composer keeps its own. */}
        <div
          ref={region}
          tabIndex={0}
          aria-label={control.region ?? `Extension widget ${name}`}
          className="relative max-h-[20vh] overflow-y-auto rounded-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400"
        >
          {scrolled.map((line, index) => (
            <Line key={index} text={line} />
          ))}
        </div>
      </div>
      {control.close && (
        <button
          type="button"
          aria-label={control.close.label}
          title={control.close.label}
          onClick={control.close.run}
          className="-mr-1 shrink-0 rounded px-1 font-sans text-sm leading-5 opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100"
        >
          ×
        </button>
      )}
    </div>
  );
}
