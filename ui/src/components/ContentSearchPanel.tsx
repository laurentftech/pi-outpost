import { useEffect, useRef, type ReactNode } from "react";
import type { ContentSearchHit } from "@pi-outpost/shared";
import type { ContentSearch } from "../useAgent";

interface ContentSearchPanelProps {
  query: string;
  onQueryChange: (query: string) => void;
  search: ContentSearch | null;
  /** Run the search for the query as typed; an empty one runs nothing. */
  onSearch: (query: string) => void;
  /** Open the hit's file at its line or page. `query` is the one the hit answered. */
  onOpenHit: (hit: ContentSearchHit, query: string) => void;
  /** Back to the tree; the query and the results stay for the next open. */
  onClose: () => void;
}

/**
 * Files → Search in files: a query, then the files holding it, one row per matching
 * line or PDF page. Enter runs the search — a walk of the whole project is too costly
 * to restart on every keystroke.
 */
export function ContentSearchPanel({ query, onQueryChange, search, onSearch, onOpenHit, onClose }: ContentSearchPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const groups = groupByPath(search?.hits ?? []);
  return (
    <div className="flex flex-col gap-2" data-content-search>
      <form
        role="search"
        aria-label="Search in files"
        className="flex items-center gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch(query);
        }}
      >
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            // The panel's own way out; the viewer and the dialogs behind it keep theirs.
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }}
          placeholder="Search in files"
          aria-label="Text to search for in files"
          className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-800 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
        />
        <button
          type="button"
          onClick={onClose}
          title="Back to the file tree"
          aria-label="Close the search"
          className="rounded px-1 py-0.5 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-400"
        >
          ×
        </button>
      </form>
      {search && <SearchStatus search={search} fileCount={groups.length} />}
      {search?.status === "loaded" && groups.length > 0 && (
        <ul aria-label="Search results" className="flex flex-col gap-2">
          {groups.map(([path, hits]) => (
            <li key={path}>
              <div className="flex items-baseline gap-1 px-1 text-xs font-medium text-zinc-700 dark:text-zinc-300" title={path}>
                <span className="min-w-0 truncate">{path}</span>
                <span className="shrink-0 text-zinc-400 dark:text-zinc-600">{hits.length}</span>
              </div>
              <ul>
                {hits.map((hit) => (
                  <li key={hit.kind === "line" ? `l${hit.line}` : `p${hit.page}`}>
                    <button
                      type="button"
                      onClick={() => onOpenHit(hit, search.query)}
                      aria-label={`${path}, ${hit.kind === "line" ? `line ${hit.line}` : `page ${hit.page}`}`}
                      className="flex w-full gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <span className="w-10 shrink-0 text-right tabular-nums text-zinc-400 dark:text-zinc-600">
                        {hit.kind === "line" ? hit.line : `p. ${hit.page}`}
                      </span>
                      <span className="min-w-0 break-words font-mono text-zinc-600 dark:text-zinc-400">
                        {highlighted(hit.excerpt, search.query)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SearchStatus({ search, fileCount }: { search: ContentSearch; fileCount: number }) {
  if (search.status === "loading") {
    return <p role="status" className="px-1 text-xs text-zinc-500">Searching…</p>;
  }
  const notes: string[] = [];
  if (search.truncated) notes.push("The search stopped early: these are partial results. Narrow the query to see everything.");
  if (search.skipped > 0) notes.push(`${search.skipped} PDF${search.skipped === 1 ? "" : "s"} could not be read.`);
  return (
    <div role="status" className="flex flex-col gap-1 px-1 text-xs text-zinc-500">
      <p>
        {search.hits.length === 0
          ? "No matches"
          : `${search.hits.length} match${search.hits.length === 1 ? "" : "es"} in ${fileCount} file${fileCount === 1 ? "" : "s"}`}
      </p>
      {notes.map((note) => (
        <p key={note} className="text-amber-700 dark:text-amber-400">
          {note}
        </p>
      ))}
    </div>
  );
}

/** Hits in the order the server found them, gathered under their file. */
function groupByPath(hits: ContentSearchHit[]): [string, ContentSearchHit[]][] {
  const groups = new Map<string, ContentSearchHit[]>();
  for (const hit of hits) {
    const group = groups.get(hit.path);
    if (group) group.push(hit);
    else groups.set(hit.path, [hit]);
  }
  return [...groups];
}

/** The excerpt with each case-insensitive occurrence of the query marked. */
function highlighted(excerpt: string, query: string): ReactNode {
  const needle = query.trim().toLowerCase();
  if (needle === "") return excerpt;
  const lower = excerpt.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, from)) {
    if (at > from) parts.push(excerpt.slice(from, at));
    parts.push(
      <mark key={at} className="rounded-sm bg-amber-200 text-zinc-900 dark:bg-amber-700/60 dark:text-zinc-100">
        {excerpt.slice(at, at + needle.length)}
      </mark>,
    );
    from = at + needle.length;
  }
  if (from < excerpt.length) parts.push(excerpt.slice(from));
  return parts;
}
