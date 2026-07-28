import { type DiffLine, rowsWithContext, toSideBySide, withContext } from "../util/diff";

/** Side-by-side before/after view (edit-tool cards, viewer git diff). */
export function SplitDiffBlock({ lines, fill = false }: { lines: DiffLine[]; fill?: boolean }) {
  return (
    <div
      className={`overflow-auto rounded border border-zinc-200 font-mono text-xs leading-relaxed dark:border-zinc-800 ${
        fill ? "max-h-full" : "max-h-72"
      }`}
    >
      {rowsWithContext(toSideBySide(lines)).map((row, i) =>
        row === null ? (
          <div key={i} className="bg-zinc-100 px-2 text-center text-zinc-400 dark:bg-zinc-800/60 dark:text-zinc-600">
            ⋯
          </div>
        ) : (
          <div key={i} className="grid grid-cols-2">
            <div
              className={`whitespace-pre-wrap break-words border-r border-zinc-200 px-2 dark:border-zinc-800 ${
                row.changed
                  ? row.left === null
                    ? "bg-zinc-50 dark:bg-zinc-900/40"
                    : "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                  : "text-zinc-500 dark:text-zinc-500"
              }`}
            >
              {row.left ?? " "}
            </div>
            <div
              className={`whitespace-pre-wrap break-words px-2 ${
                row.changed
                  ? row.right === null
                    ? "bg-zinc-50 dark:bg-zinc-900/40"
                    : "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "text-zinc-500 dark:text-zinc-500"
              }`}
            >
              {row.right ?? " "}
            </div>
          </div>
        ),
      )}
    </div>
  );
}

/** Unified diff view (write-tool cards: all additions). */
export function DiffBlock({ lines }: { lines: DiffLine[] }) {
  return (
    <pre className="max-h-72 overflow-auto rounded border border-zinc-200 font-mono text-xs leading-relaxed dark:border-zinc-800">
      {withContext(lines).map((line, i) =>
        line === null ? (
          <div key={i} className="bg-zinc-100 px-2 text-center text-zinc-400 dark:bg-zinc-800/60 dark:text-zinc-600">
            ⋯
          </div>
        ) : (
          <div
            key={i}
            className={
              line.type === "add"
                ? "bg-emerald-50 px-2 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                : line.type === "del"
                  ? "bg-red-50 px-2 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                  : "px-2 text-zinc-500 dark:text-zinc-500"
            }
          >
            {line.type === "add" ? "+ " : line.type === "del" ? "− " : "  "}
            {line.text}
          </div>
        ),
      )}
    </pre>
  );
}
