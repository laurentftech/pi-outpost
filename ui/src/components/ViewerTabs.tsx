import { keepFocus } from "./AgentStatusStrip";

export interface ViewerTab {
  path: string;
  dirty: boolean;
}

const nameOf = (path: string) => path.split(/[\\/]/).pop() ?? path;

/**
 * The open files, as tabs above the viewer — shown from the second file on. A
 * pointer press does not take focus from the editor; a middle click closes, as in
 * a browser.
 */
export function ViewerTabs({
  tabs,
  active,
  onActivate,
  onClose,
}: {
  tabs: readonly ViewerTab[];
  active: string | null;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
}) {
  if (tabs.length < 2) return null;
  return (
    <div role="tablist" aria-label="Open files" className="flex shrink-0 overflow-x-auto border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
      {tabs.map((tab) => {
        const selected = tab.path === active;
        const name = nameOf(tab.path);
        return (
          <div
            key={tab.path}
            className={`group flex min-w-0 max-w-[14rem] shrink-0 items-center border-r border-zinc-200 dark:border-zinc-800 ${
              selected ? "bg-white dark:bg-zinc-950" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
            }`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={selected}
              title={tab.path}
              onMouseDown={keepFocus}
              onClick={() => onActivate(tab.path)}
              onAuxClick={(event) => {
                if (event.button === 1) onClose(tab.path);
              }}
              className={`flex min-h-6 min-w-0 items-center gap-1.5 py-1.5 pl-3 pr-1 text-xs ${selected ? "font-medium text-zinc-800 dark:text-zinc-100" : "text-zinc-500 dark:text-zinc-400"}`}
            >
              <span className="truncate">{name}</span>
              {tab.dirty && <span aria-label="unsaved changes" className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />}
            </button>
            <button
              type="button"
              aria-label={`Close ${name}`}
              title={`Close ${name}`}
              onMouseDown={keepFocus}
              onClick={() => onClose(tab.path)}
              className="mr-1 flex min-h-6 min-w-6 items-center justify-center rounded text-xs text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
