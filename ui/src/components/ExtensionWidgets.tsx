import type { ExtensionWidget } from "../useAgent";

/** Renders extension setWidget() content — see extensions.md#custom-ui. String-array widgets only (no factories). */
export function ExtensionWidgets({
  widgets,
  placement,
}: {
  widgets: Record<string, ExtensionWidget>;
  placement: "aboveEditor" | "belowEditor";
}) {
  const entries = Object.entries(widgets).filter(([, w]) => w.placement === placement);
  if (entries.length === 0) return null;
  return (
    <div className="mb-2 flex flex-col gap-1">
      {entries.map(([key, widget]) => (
        <div
          key={key}
          className="whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 font-mono text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
        >
          {widget.lines.join("\n")}
        </div>
      ))}
    </div>
  );
}
