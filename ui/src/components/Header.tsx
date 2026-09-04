import { useEffect, useState } from "react";
import { MIN_SESSION_QUERY_LENGTH, type AgentResourceInventory, type GitUnavailable, type SessionSummary, type TreeNode, type WorkspaceInfo } from "@pi-outpost/shared";
import { ProjectMenu } from "./ProjectMenu";
import { WorkspaceRootControl, type WorkspaceRootSandbox } from "./WorkspaceRootControl";
import type { AgentResourceOperationState, GitLogState, GitStatusState, ServerBrowseState, SessionSearch, SettingsApplyState } from "../useAgent";
import { stripAnsi } from "../util/ansi";
import { useClickOutside } from "../util/clickOutside";
import {
  CONVERSATION_FILTER_KINDS,
  CONVERSATION_FILTER_LABELS,
  hiddenCount,
  type ConversationFilterKind,
  type ConversationFilters,
} from "../conversationFilters";
import { GitMenu } from "./GitMenu";
import { SettingsMenu } from "./SettingsMenu";
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
  workspace: WorkspaceInfo | null;
  workspaces: WorkspaceInfo[];
  workspaceLocked: boolean;
  /**
   * Which workspace affordance this header carries. `projects` is the selector
   * the standalone app has always shown; `root` is the single-root chooser an
   * embed gets under that policy; `none` is the embed that offers neither.
   */
  workspaceControl: "projects" | "root" | "none";
  /** Everything the `root` control needs; required only in that mode. */
  rootControl?: {
    sandbox: WorkspaceRootSandbox | null;
    browse: ServerBrowseState | null;
    applyState: SettingsApplyState | null;
    blocked: boolean;
    onBrowse: (path: string) => void;
    onCloseBrowser: () => void;
    onOpened: () => void;
    onSelect: (root: string) => void;
  };
  onSwitchWorkspace: (root: string) => void;
  onOpenProject: () => void;
  onCloseProject: (root: string) => void;
  theme: "light" | "dark";
  showThemeToggle: boolean;
  /** Extension setStatus() key/text pairs — see extensions.md#custom-ui. */
  statuses: Record<string, string>;
  sidebarOpen: boolean;
  outcomeOpen: boolean;
  /** What the conversation shows; true means the kind is present. */
  filters: ConversationFilters;
  gitAvailable: boolean;
  gitStatus: GitStatusState | null;
  gitLog: GitLogState | null;
  extensionPaths: string[] | null;
  configuredExtensionPaths: string[];
  userExtensionPaths: string[];
  extensionLock: boolean;
  tools?: { name: string; active: boolean }[];
  commands?: { name: string; source: string }[];
  sandbox: { root: string; allowWrite: boolean; allowBash: boolean; writableRoot?: string } | null;
  /** Why git is unavailable, when it is — shown in Settings, where a user looks. */
  gitUnavailable: GitUnavailable | null;
  versions?: { piOutpost: string; piSdk?: string; agent?: string } | null;
  /** Skill paths added through Settings — editable there. */
  userSkillPaths: string[];
  /** Open server-directory listing behind the settings path picker. */
  serverBrowse: ServerBrowseState | null;
  /** In-flight settings apply, so a refusal can be shown where it was requested. */
  settingsApply: SettingsApplyState | null;
  agentResources: AgentResourceInventory | null;
  agentResourceOperations: AgentResourceOperationState;
  onBrowseServerPath: (path: string) => void;
  onCloseServerBrowser: () => void;
  /** Another header picker owns the server-browse listing: Settings closes its own. */
  settingsPickerBlocked?: boolean;
  /** Settings opened a picker, so the other header controls close theirs. */
  onSettingsPickerOpened?: () => void;
  onUpdateConfig: (update: {
    sandbox?: { root: string; allowWrite: boolean; allowBash: boolean; writableRoot?: string };
    userSkillPaths?: string[];
    userExtensionPaths?: string[];
  }) => void;
  onSuggestAgentResourceClonePath: (repositoryUrl: string) => void;
  onCloneAgentResourceRepository: (repositoryUrl: string, destinationPath: string) => void;
  onEnrollAgentResourceRepository: (previewToken: string, skillRoots: string[], extensionRoots: string[]) => void;
  onRefreshAgentResourceRepositories: (repositoryId?: string) => void;
  onUpdateAgentResourceRepository: (
    repositoryId: string,
    assessmentToken: string,
    localRevision: string,
    upstreamRevision: string,
    allowExecutableChanges?: boolean,
  ) => void;
  onToggleSidebar: () => void;
  onToggleOutcome: () => void;
  onFilterChange: (kind: ConversationFilterKind, shown: boolean) => void;
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
  onFetchGitLog: (repo: string) => void;
  onShowCommit: (repo: string, sha: string) => void;
  /** What the viewer has open, so the branch chip can name that project's repository. */
  gitSelectedPath: string | null;
  terminalOpen?: boolean;
  onToggleTerminal?: () => void;
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

/**
 * What the conversation shows, as one menu rather than a button per kind.
 *
 * Checked means shown. The control this replaced was pressed when it was
 * *hiding*, which is what nobody could read off it: a row of checkboxes meaning
 * "hide this" is a double negative on every glance.
 *
 * Stateless about filtering — it renders what it is given and reports intent —
 * so nothing here can disagree with the conversation it sits above.
 */
function ConversationFilterMenu({
  filters,
  onFilterChange,
}: {
  filters: ConversationFilters;
  onFilterChange: (kind: ConversationFilterKind, shown: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));
  const hidden = hiddenCount(filters);
  // The count is the whole point of the closed state: "am I looking at all of
  // it?" has to be answerable without opening the menu.
  const label = hidden > 0 ? `Filter · ${hidden} hidden` : "Filter";

  return (
    <div
      className="relative"
      ref={ref}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Choose what the conversation shows"
        className={`rounded-md border px-2 py-1 text-xs ${
          hidden > 0
            ? "border-zinc-400 bg-zinc-100 text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
            : "border-zinc-300 text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
        }`}
      >
        {label}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-48 rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {CONVERSATION_FILTER_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              role="menuitemcheckbox"
              aria-checked={filters[kind]}
              onClick={() => onFilterChange(kind, !filters[kind])}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <span aria-hidden className="w-3">{filters[kind] ? "✓" : ""}</span>
              <span>{CONVERSATION_FILTER_LABELS[kind]}</span>
            </button>
          ))}
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
    // `relative z-30`: the dropdowns below (sessions, tree, git) are absolutely
    // positioned and spill over the content area. Without a stacking context of its
    // own, the header competes there on DOM order alone — and the open FileViewer,
    // declared after it, wins. The menus would open *behind* the file preview.
    <header className="relative z-30 flex items-center gap-3 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
      {/* The workspace affordance comes first: it scopes everything else in this
          bar. Which one appears is the deployment's choice; the project selector
          still renders nothing while a single project is open or on a pinned
          server, and `none` is an embed that offers neither. */}
      {props.workspaceControl === "projects" && (
        <ProjectMenu
          workspace={props.workspace}
          workspaces={props.workspaces}
          locked={props.workspaceLocked}
          onSwitch={props.onSwitchWorkspace}
          onOpen={props.onOpenProject}
          onClose={props.onCloseProject}
        />
      )}
      {props.workspaceControl === "root" && props.rootControl && (
        <WorkspaceRootControl
          sandbox={props.rootControl.sandbox}
          browse={props.rootControl.browse}
          applyState={props.rootControl.applyState}
          blocked={props.rootControl.blocked}
          onBrowse={props.rootControl.onBrowse}
          onCloseBrowser={props.rootControl.onCloseBrowser}
          onOpened={props.rootControl.onOpened}
          onSelect={props.rootControl.onSelect}
        />
      )}
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
      <button
        type="button"
        onClick={props.onToggleOutcome}
        aria-pressed={props.outcomeOpen}
        title="Review structured workspace Outcome"
        className={`rounded-md border px-2 py-1 text-xs ${
          props.outcomeOpen
            ? "border-zinc-400 bg-zinc-100 text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
            : props.workspace?.activity === "ready-for-review"
              ? "border-amber-400 text-amber-700 dark:text-amber-300"
              : "border-zinc-300 text-zinc-500 hover:border-zinc-400 dark:border-zinc-800 dark:text-zinc-400"
        }`}
      >
        Outcome{props.workspace?.activity === "ready-for-review" ? " •" : ""}
      </button>
      {props.gitAvailable && (
        <GitMenu
          status={props.gitStatus}
          selected={props.gitSelectedPath}
          log={props.gitLog}
          onFetchLog={props.onFetchGitLog}
          onShowCommit={props.onShowCommit}
        />
      )}

      <span className="text-lg font-semibold tracking-tight" style={{ color: "var(--accent, inherit)" }}>
        {props.title ?? "π"}
      </span>

      {Object.entries(props.statuses).map(([key, text]) => (
        <span
          key={key}
          className="rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400"
        >
          {/* Statuses come from the same terminal-rendered source as widgets. The
              header is a chrome strip, so the escapes are dropped rather than
              coloured — the text is what carries the meaning here. */}
          {stripAnsi(text)}
        </span>
      ))}

      <div className="ml-auto flex items-center gap-2">
        <ConversationFilterMenu filters={props.filters} onFilterChange={props.onFilterChange} />
        {props.onToggleTerminal && (
          <button
            type="button"
            onClick={props.onToggleTerminal}
            title={props.terminalOpen ? "Close Terminal (Ctrl+`)" : "Open Terminal (Ctrl+`)"}
            aria-pressed={props.terminalOpen}
            className={`rounded-md border px-2 py-1 text-xs ${
              props.terminalOpen
                ? "border-zinc-400 bg-zinc-100 text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
                : "border-zinc-300 text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
            }`}
          >
            &gt;_ terminal
          </button>
        )}
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
        <SettingsMenu
          extensionPaths={props.extensionPaths}
          configuredExtensionPaths={props.configuredExtensionPaths}
          userExtensionPaths={props.userExtensionPaths}
          extensionLock={props.extensionLock}
          tools={props.tools ?? []}
          commands={props.commands ?? []}
          sandbox={props.sandbox}
          gitUnavailable={props.gitUnavailable}
          userSkillPaths={props.userSkillPaths}
          serverBrowse={props.serverBrowse}
          applyState={props.settingsApply}
          agentResources={props.agentResources}
          agentResourceOperations={props.agentResourceOperations}
          versions={props.versions}
          onBrowseServerPath={props.onBrowseServerPath}
          onCloseServerBrowser={props.onCloseServerBrowser}
          pickerBlocked={props.settingsPickerBlocked}
          onPickerOpened={props.onSettingsPickerOpened}
          onUpdateConfig={props.onUpdateConfig}
          onSuggestAgentResourceClonePath={props.onSuggestAgentResourceClonePath}
          onCloneAgentResourceRepository={props.onCloneAgentResourceRepository}
          onEnrollAgentResourceRepository={props.onEnrollAgentResourceRepository}
          onRefreshAgentResourceRepositories={props.onRefreshAgentResourceRepositories}
          onUpdateAgentResourceRepository={props.onUpdateAgentResourceRepository}
        />
        <span
          className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500"}`}
          title={connected ? "connected" : "disconnected"}
        />
      </div>
    </header>
  );
}
