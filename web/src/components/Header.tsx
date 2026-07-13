import { useEffect, useRef, useState } from "react";
import { MIN_SESSION_QUERY_LENGTH, type GitLogEntry, type SessionSummary, type TreeNode } from "@pi-outpost/shared";
import type { GitStatusState, SessionSearch } from "../useAgent";
import { GitMenu } from "./GitMenu";
import { TreeMenu } from "./TreeMenu";

interface HeaderProps {
  title?: string;
  sessions: SessionSummary[] | null;
  /** Active session search (name / first message / transcript), null when the menu lists everything. */
  sessionSearch: SessionSearch | null;
  sessionId: string;
  tree: TreeNode[] | null;
  isStreaming: boolean;
  connected: boolean;
  theme: "light" | "dark";
  showThemeToggle: boolean;
  /** Extension setStatus() key/text pairs — see extensions.md#custom-ui. */
  statuses: Record<string, string>;
  sidebarOpen: boolean;
  /** Tool-noise filter: tool cards are hidden from the conversation. */
  hideTools: boolean;
  gitAvailable: boolean;
  gitStatus: GitStatusState | null;
  gitLog: GitLogEntry[] | null;
  onToggleSidebar: () => void;
  onToggleHideTools: () => void;
  onToggleTheme: () => void;
  onNewSession: () => void;
  onSwitchSession: (path: string) => void;
  onDeleteSession: (path: string) => void;
  onListSessions: () => void;
  onRenameSession: (path: string, name: string) => void;
  onSearchSessions: (query: string) => void;
  onClearSessionSearch: () => void;
  onListTree: () => void;
  onNavigateTree: (entryId: string) => void;
  onForkSession: (entryId: string) => void;
  onFetchGitLog: () => void;
  onShowCommit: (sha: string) => void;
}

function useClickOutside(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handler(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);
  return ref;
}

const SESSION_SEARCH_DEBOUNCE_MS = 200;

/** Inline rename field: Enter commits, Escape cancels, an empty value clears the name. */
function RenameField({ initial, onCommit, onCancel }: { initial: string; onCommit: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  return (
    <input
      autoFocus
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={onCancel}
      onKeyDown={(event) => {
        if (event.key === "Enter") onCommit(value);
        else if (event.key === "Escape") onCancel();
      }}
      placeholder="Session name (empty to clear)"
      aria-label="Session name"
      className="w-full rounded-md border border-zinc-400 bg-transparent px-2 py-1 text-sm outline-none placeholder:text-zinc-400 dark:border-zinc-600 dark:placeholder:text-zinc-600"
    />
  );
}

function SessionRow({
  session,
  isCurrent,
  renaming,
  onSwitch,
  onDelete,
  onStartRename,
  onRename,
  onCancelRename,
}: {
  session: SessionSummary;
  isCurrent: boolean;
  renaming: boolean;
  onSwitch: () => void;
  onDelete: () => void;
  onStartRename: () => void;
  onRename: (name: string) => void;
  onCancelRename: () => void;
}) {
  if (renaming) {
    return (
      <div className="px-3 py-2">
        <RenameField initial={session.name ?? ""} onCommit={onRename} onCancel={onCancelRename} />
      </div>
    );
  }
  return (
    <div
      className={`group flex items-start gap-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
        isCurrent ? "bg-zinc-100 dark:bg-zinc-800/60" : ""
      }`}
    >
      <button type="button" onClick={onSwitch} className="min-w-0 flex-1 px-3 py-2 text-left text-sm">
        <div className="truncate text-zinc-700 dark:text-zinc-300">
          {session.name || session.firstMessage || "(empty)"}
        </div>
        {/* Why this session matched: the excerpt is only sent for search results */}
        {session.snippet && (
          <div className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-500">{session.snippet}</div>
        )}
        <div className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-600">
          {new Date(session.modified).toLocaleString()} · {session.messageCount} messages
          {isCurrent ? " · current" : ""}
        </div>
      </button>
      <button
        type="button"
        onClick={onStartRename}
        title="rename session"
        aria-label="Rename session"
        className="mt-2 rounded px-1.5 py-0.5 text-xs text-zinc-400 opacity-0 hover:bg-zinc-200 hover:text-zinc-700 focus-visible:opacity-100 group-hover:opacity-100 dark:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
      >
        ✎
      </button>
      {!isCurrent && (
        <button
          type="button"
          onClick={onDelete}
          title="delete session"
          aria-label="Delete session"
          className="mr-2 mt-2 rounded px-1.5 py-0.5 text-xs text-zinc-400 opacity-0 hover:bg-red-100 hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100 dark:text-zinc-600 dark:hover:bg-red-950/60 dark:hover:text-red-400"
        >
          ✕
        </button>
      )}
    </div>
  );
}

/**
 * Saved sessions: named (the agent titles a session after its first exchange, the
 * user renames with ✎) and searchable — the query is matched server-side against
 * the whole transcript, so a session is findable by anything ever said in it.
 */
function SessionMenu({
  sessions,
  sessionSearch,
  sessionId,
  onSwitchSession,
  onDeleteSession,
  onListSessions,
  onRenameSession,
  onSearchSessions,
  onClearSessionSearch,
}: Pick<
  HeaderProps,
  | "sessions"
  | "sessionSearch"
  | "sessionId"
  | "onSwitchSession"
  | "onDeleteSession"
  | "onListSessions"
  | "onRenameSession"
  | "onSearchSessions"
  | "onClearSessionSearch"
>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const ref = useClickOutside(() => setOpen(false));

  const trimmed = query.trim();
  // A single letter would scan every transcript for nothing useful — the server
  // ignores it too (MIN_QUERY_LENGTH), so don't even ask
  const searching = trimmed.length >= MIN_SESSION_QUERY_LENGTH;

  // Debounced: every keystroke re-reads every session file on the server
  useEffect(() => {
    if (!open) return;
    if (!searching) {
      onClearSessionSearch();
      return;
    }
    const timer = setTimeout(() => onSearchSessions(trimmed), SESSION_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, trimmed, searching]);

  function close() {
    setOpen(false);
    setRenamingPath(null);
  }

  // While an answer is in flight the results are empty but not *known* to be empty:
  // rendering "no matches" there would call every query a miss for a whole round trip.
  // Results for an older query are just as wrong — the user has typed on since.
  const pending = searching && !(sessionSearch?.status === "loaded" && sessionSearch.query === trimmed);
  const rows = searching ? (pending ? null : (sessionSearch?.results ?? null)) : sessions;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => {
          if (open) {
            close();
            return;
          }
          setOpen(true);
          setQuery("");
          setRenamingPath(null);
          onClearSessionSearch();
          onListSessions();
        }}
        className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
      >
        sessions
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 flex max-h-96 w-96 flex-col rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          <div className="border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search sessions"
              aria-label="Search sessions"
              className="w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700 dark:placeholder:text-zinc-600 dark:focus:border-zinc-500"
            />
            <p className="mt-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
              Searches names and everything said in a session · ✎ to rename
            </p>
          </div>
          <div className="min-h-0 overflow-y-auto">
            {rows === null && <div className="px-3 py-2 text-xs text-zinc-500">loading…</div>}
            {rows?.length === 0 && (
              <div className="px-3 py-2 text-xs text-zinc-500">{searching ? "no matches" : "no saved sessions"}</div>
            )}
            {rows?.map((session) => (
              <SessionRow
                key={session.path}
                session={session}
                isCurrent={session.id === sessionId}
                renaming={renamingPath === session.path}
                onSwitch={() => {
                  onSwitchSession(session.path);
                  close();
                }}
                onDelete={() => {
                  if (window.confirm("Delete this session?")) onDeleteSession(session.path);
                }}
                onStartRename={() => setRenamingPath(session.path)}
                onRename={(name) => {
                  onRenameSession(session.path, name);
                  setRenamingPath(null);
                  // Search results are a server-side snapshot: the rename's `sessions`
                  // broadcast doesn't refresh them, so ask again
                  if (searching) onSearchSessions(query.trim());
                }}
                onCancelRename={() => setRenamingPath(null)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ThemeToggle({ theme, onToggle }: { theme: "light" | "dark"; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
    >
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}

export function Header(props: HeaderProps) {
  const { isStreaming, connected } = props;

  return (
    <header className="flex items-center gap-3 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
      {/* File/repo controls live on the left, the side their panel opens on */}
      <button
        type="button"
        onClick={props.onToggleSidebar}
        title={props.sidebarOpen ? "Hide files (panel opens on the left)" : "Show files"}
        aria-pressed={props.sidebarOpen}
        className={`rounded-md border px-2 py-1 text-xs ${
          props.sidebarOpen
            ? "border-zinc-400 bg-zinc-100 text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
            : "border-zinc-300 text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
        }`}
      >
        {props.sidebarOpen ? "◧" : "◨"} files
      </button>
      {props.gitAvailable && (
        <GitMenu
          status={props.gitStatus}
          log={props.gitLog}
          onFetchLog={props.onFetchGitLog}
          onShowCommit={props.onShowCommit}
        />
      )}

      <span className="text-lg font-semibold tracking-tight" style={{ color: "var(--accent, inherit)" }}>
        {props.title ?? "π"}
      </span>

      {isStreaming && (
        <span aria-live="polite" className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
          <span className="h-1.5 w-1.5 animate-pulse motion-reduce:animate-none rounded-full bg-amber-500 dark:bg-amber-400" />
          working
        </span>
      )}

      {Object.entries(props.statuses).map(([key, text]) => (
        <span
          key={key}
          className="rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400"
        >
          {text}
        </span>
      ))}

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={props.onToggleHideTools}
          title={props.hideTools ? "Show tool cards in the conversation" : "Hide tool cards (long sessions read better without them)"}
          aria-pressed={props.hideTools}
          className={`rounded-md border px-2 py-1 text-xs ${
            props.hideTools
              ? "border-zinc-400 bg-zinc-100 text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
              : "border-zinc-300 text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
          }`}
        >
          ⚒ tools
        </button>
        {props.showThemeToggle && <ThemeToggle theme={props.theme} onToggle={props.onToggleTheme} />}
        <button
          type="button"
          onClick={props.onNewSession}
          title="new session"
          className="rounded-md border border-emerald-300 px-2 py-1 text-xs text-emerald-700 hover:border-emerald-500 hover:text-emerald-600 dark:border-emerald-900 dark:text-emerald-400 dark:hover:border-emerald-600 dark:hover:text-emerald-300"
        >
          + new
        </button>
        <TreeMenu
          tree={props.tree}
          isStreaming={isStreaming}
          onListTree={props.onListTree}
          onNavigate={props.onNavigateTree}
          onFork={props.onForkSession}
        />
        <SessionMenu
          sessions={props.sessions}
          sessionSearch={props.sessionSearch}
          sessionId={props.sessionId}
          onSwitchSession={props.onSwitchSession}
          onDeleteSession={props.onDeleteSession}
          onListSessions={props.onListSessions}
          onRenameSession={props.onRenameSession}
          onSearchSessions={props.onSearchSessions}
          onClearSessionSearch={props.onClearSessionSearch}
        />
        <span
          className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500"}`}
          title={connected ? "connected" : "disconnected"}
        />
      </div>
    </header>
  );
}
