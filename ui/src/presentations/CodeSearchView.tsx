import { useState } from "react";
import { countHits, parseSearchHits } from "./parseSearchHits";
import { RawBody } from "./builtin";
import type { PresentationProps, ToolItem } from "./types";

const FILES_SHOWN = 8;
const HITS_PER_FILE = 5;

export function CodeSearchView({ item, dispatch }: PresentationProps) {
  const groups = parseSearchHits(item.output ?? "");
  const [showAll, setShowAll] = useState(false);

  // Not a hit list — an error, a "no matches" note, or a format we do not read.
  if (groups.length === 0) return <RawBody item={item} />;

  const shown = showAll ? groups : groups.slice(0, FILES_SHOWN);

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-zinc-500">
        {countHits(groups)} match{countHits(groups) === 1 ? "" : "es"} in {groups.length} file
        {groups.length === 1 ? "" : "s"}
      </div>
      {shown.map((group) => (
        <div key={group.path} className="flex flex-col">
          <button
            type="button"
            onClick={() => dispatch({ kind: "openFile", path: group.path })}
            className="flex items-center gap-2 truncate text-left font-mono text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            <span className="truncate">{group.path}</span>
            <span className="shrink-0 text-zinc-400 dark:text-zinc-600">{group.hits.length}</span>
          </button>
          <div className="overflow-x-auto rounded border border-zinc-200 font-mono text-xs dark:border-zinc-800">
            {group.hits.slice(0, HITS_PER_FILE).map((hit, i) => (
              <div key={i} className="flex gap-2 px-2">
                <span className="shrink-0 select-none text-zinc-400 dark:text-zinc-600">{hit.line}</span>
                <span className="whitespace-pre text-zinc-700 dark:text-zinc-300">{hit.text}</span>
              </div>
            ))}
            {group.hits.length > HITS_PER_FILE && (
              <div className="px-2 text-zinc-400 dark:text-zinc-600">
                +{group.hits.length - HITS_PER_FILE} more in this file
              </div>
            )}
          </div>
        </div>
      ))}
      {!showAll && groups.length > FILES_SHOWN && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="self-start text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          show {groups.length - FILES_SHOWN} more file{groups.length - FILES_SHOWN === 1 ? "" : "s"}
        </button>
      )}
    </div>
  );
}

export const codeSearchPresentation = {
  id: "code-search",
  match: (item: ToolItem) => item.toolName === "grep",
  stable: true,
  showsRawReveal: true,
  Expanded: CodeSearchView,
} as const;
