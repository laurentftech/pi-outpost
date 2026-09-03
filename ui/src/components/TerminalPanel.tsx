import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { ThemeContext } from "../theme/ThemeContext";
import type {
  TerminalCwdListener,
  TerminalDataListener,
  TerminalErrorListener,
  TerminalExitListener,
} from "../useAgent";

export interface TerminalPanelProps {
  open: boolean;
  onClose(): void;
  cwd?: string;
  onSetWorkspaceRoot?(root: string): void;
  openTerminal?(terminalId: string, cwd?: string, cols?: number, rows?: number): void;
  sendTerminalInput?(terminalId: string, data: string): void;
  getTerminalCwd?(terminalId: string): void;
  resizeTerminal?(terminalId: string, cols: number, rows: number): void;
  closeTerminal?(terminalId: string): void;
  subscribeTerminal?(
    terminalId: string,
    callbacks: {
      onData?: TerminalDataListener;
      onCwd?: TerminalCwdListener;
      onExit?: TerminalExitListener;
      onError?: TerminalErrorListener;
    },
  ): () => void;
}

interface TabItem {
  id: string;
  title: string;
}

interface SingleTerminalViewProps {
  id: string;
  cwd?: string;
  isActive: boolean;
  isPanelOpen: boolean;
  openTerminal?: TerminalPanelProps["openTerminal"];
  sendTerminalInput?: TerminalPanelProps["sendTerminalInput"];
  getTerminalCwd?: TerminalPanelProps["getTerminalCwd"];
  resizeTerminal?: TerminalPanelProps["resizeTerminal"];
  closeTerminal?: TerminalPanelProps["closeTerminal"];
  subscribeTerminal?: TerminalPanelProps["subscribeTerminal"];
  onCwdUpdate(id: string, cwd: string): void;
  registerClear(id: string, fn: () => void): void;
}

const DARK_THEME = {
  background: "#09090b",
  foreground: "#f4f4f5",
  cursor: "#38bdf8",
  cursorAccent: "#09090b",
  selectionBackground: "rgba(56, 189, 248, 0.3)",
  black: "#27272a",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#facc15",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#38bdf8",
  white: "#f4f4f5",
  brightBlack: "#52525b",
  brightRed: "#ef4444",
  brightGreen: "#22c55e",
  brightYellow: "#eab308",
  brightBlue: "#3b82f6",
  brightMagenta: "#a855f7",
  brightCyan: "#06b6d4",
  brightWhite: "#ffffff",
};

const LIGHT_THEME = {
  background: "#ffffff",
  foreground: "#18181b",
  cursor: "#0284c7",
  cursorAccent: "#ffffff",
  selectionBackground: "rgba(2, 132, 199, 0.2)",
  black: "#18181b",
  red: "#dc2626",
  green: "#16a34a",
  yellow: "#ca8a04",
  blue: "#2563eb",
  magenta: "#9333ea",
  cyan: "#0891b2",
  white: "#e4e4e7",
  brightBlack: "#71717a",
  brightRed: "#b91c1c",
  brightGreen: "#15803d",
  brightYellow: "#a16207",
  brightBlue: "#1d4ed8",
  brightMagenta: "#7e22ce",
  brightCyan: "#0e7490",
  brightWhite: "#27272a",
};

function shortenPath(p: string): string {
  if (!p) return "";
  const parts = p.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 3) return p;
  return "…/" + parts.slice(-3).join("/");
}

function SingleTerminalView({
  id,
  cwd,
  isActive,
  isPanelOpen,
  openTerminal,
  sendTerminalInput,
  getTerminalCwd,
  resizeTerminal,
  closeTerminal,
  subscribeTerminal,
  onCwdUpdate,
  registerClear,
}: SingleTerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const theme = useContext(ThemeContext);
  const isDark = theme === "dark";

  const callbacksRef = useRef({
    cwd,
    openTerminal,
    sendTerminalInput,
    getTerminalCwd,
    resizeTerminal,
    closeTerminal,
    subscribeTerminal,
    onCwdUpdate,
    registerClear,
  });

  callbacksRef.current = {
    cwd,
    openTerminal,
    sendTerminalInput,
    getTerminalCwd,
    resizeTerminal,
    closeTerminal,
    subscribeTerminal,
    onCwdUpdate,
    registerClear,
  };

  // Dynamic theme update without unmounting / restarting the shell
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = isDark ? DARK_THEME : LIGHT_THEME;
    }
  }, [isDark]);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, Menlo, Monaco, 'Courier New', monospace",
      lineHeight: 1.2,
      theme: isDark ? DARK_THEME : LIGHT_THEME,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    term.open(containerRef.current);
    fitAddon.fit();

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    // Register clear handler
    callbacksRef.current.registerClear(id, () => {
      term.clear();
    });

    // Notify server to spawn shell
    callbacksRef.current.openTerminal?.(id, callbacksRef.current.cwd, term.cols, term.rows);

    let cwdDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    let lastCwdQueryTime = 0;

    const requestCwdThrottled = () => {
      const now = Date.now();
      if (now - lastCwdQueryTime < 1000) {
        if (!cwdDebounceTimer) {
          cwdDebounceTimer = setTimeout(() => {
            cwdDebounceTimer = null;
            lastCwdQueryTime = Date.now();
            callbacksRef.current.getTerminalCwd?.(id);
          }, 1000 - (now - lastCwdQueryTime));
        }
        return;
      }
      lastCwdQueryTime = now;
      callbacksRef.current.getTerminalCwd?.(id);
    };

    // Keystrokes to server
    const dataDispose = term.onData((data) => {
      callbacksRef.current.sendTerminalInput?.(id, data);
      // When enter is pressed, query cwd with throttling
      if (data.includes("\r") || data.includes("\n")) {
        requestCwdThrottled();
      }
    });

    // Output from server
    const unsubscribe = callbacksRef.current.subscribeTerminal?.(id, {
      onData: (data) => {
        term.write(data);
        // Extract OSC 7 (current directory notification) if emitted by shell
        const osc7Match = data.match(/\x1b\]7;file:\/\/[^/]*([^\x07\x1b]+)(?:\x07|\x1b\\)/);
        if (osc7Match && osc7Match[1]) {
          try {
            const decodedPath = decodeURIComponent(osc7Match[1]);
            callbacksRef.current.onCwdUpdate(id, decodedPath);
          } catch {
            // Ignore
          }
        }
      },
      onCwd: (newCwd) => {
        callbacksRef.current.onCwdUpdate(id, newCwd);
      },
      onExit: (exitCode) => {
        term.writeln(`\r\n\x1b[90m[Process completed (exit code ${exitCode ?? 0})]\x1b[0m`);
      },
      onError: (message) => {
        term.writeln(`\r\n\x1b[31m[Terminal error: ${message}]\x1b[0m`);
      },
    }) ?? (() => {});

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      if (containerRef.current && containerRef.current.clientWidth > 0 && containerRef.current.clientHeight > 0) {
        try {
          fitAddon.fit();
          if (term.cols > 0 && term.rows > 0) {
            callbacksRef.current.resizeTerminal?.(id, term.cols, term.rows);
          }
        } catch {
          // Ignore transient resize errors
        }
      }
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      dataDispose.dispose();
      unsubscribe();
      resizeObserver.disconnect();
      term.dispose();
      callbacksRef.current.closeTerminal?.(id);
    };
  }, [id]);

  // When active tab changes or panel becomes visible, refit, focus, and refresh cwd
  useEffect(() => {
    if (isPanelOpen && isActive && fitAddonRef.current && terminalRef.current && containerRef.current) {
      callbacksRef.current.getTerminalCwd?.(id);
      const timer = setTimeout(() => {
        try {
          fitAddonRef.current?.fit();
          terminalRef.current?.focus();
        } catch {
          // Ignore
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isPanelOpen, isActive, id]);

  return (
    <div
      ref={containerRef}
      className={`h-full w-full p-2 bg-white dark:bg-zinc-950 overflow-hidden ${isActive ? "block" : "hidden"}`}
    />
  );
}

export function TerminalPanel({
  open,
  onClose,
  cwd,
  onSetWorkspaceRoot,
  openTerminal,
  sendTerminalInput,
  getTerminalCwd,
  resizeTerminal,
  closeTerminal,
  subscribeTerminal,
}: TerminalPanelProps) {
  const [hasBeenOpened, setHasBeenOpened] = useState(open);

  useEffect(() => {
    if (open) setHasBeenOpened(true);
  }, [open]);

  const [tabs, setTabs] = useState<TabItem[]>([{ id: "term-1", title: "terminal 1" }]);
  const [activeTabId, setActiveTabId] = useState<string>("term-1");
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [cwdMap, setCwdMap] = useState<Record<string, string>>({});
  const [isMaximized, setIsMaximized] = useState(false);
  const [syncedConfirm, setSyncedConfirm] = useState(false);
  const clearHandlersRef = useRef<Map<string, () => void>>(new Map());

  const registerClear = useCallback((id: string, fn: () => void) => {
    clearHandlersRef.current.set(id, fn);
  }, []);

  const handleCwdUpdate = useCallback((id: string, newCwd: string) => {
    setCwdMap((prev) => ({ ...prev, [id]: newCwd }));
  }, []);

  const addTab = useCallback(() => {
    const nextNum = tabs.length + 1;
    const newId = `term-${Date.now()}-${nextNum}`;
    const newTab: TabItem = { id: newId, title: `terminal ${nextNum}` };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newId);
  }, [tabs.length]);

  const removeTab = useCallback(
    (idToRemove: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (tabs.length <= 1) {
        onClose();
        return;
      }
      setTabs((prev) => {
        const nextTabs = prev.filter((t) => t.id !== idToRemove);
        if (activeTabId === idToRemove) {
          const idx = prev.findIndex((t) => t.id === idToRemove);
          const nextActive = nextTabs[Math.max(0, idx - 1)]?.id ?? nextTabs[0]?.id;
          setActiveTabId(nextActive);
        }
        return nextTabs;
      });
      clearHandlersRef.current.delete(idToRemove);
      setCwdMap((prev) => {
        const copy = { ...prev };
        delete copy[idToRemove];
        return copy;
      });
    },
    [tabs.length, activeTabId, onClose],
  );

  const startRenameTab = (tab: TabItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingTabId(tab.id);
    setEditingTitle(tab.title);
  };

  const commitRenameTab = () => {
    if (editingTabId) {
      const trimmed = editingTitle.trim();
      if (trimmed) {
        setTabs((prev) =>
          prev.map((t) => (t.id === editingTabId ? { ...t, title: trimmed } : t)),
        );
      }
      setEditingTabId(null);
    }
  };

  const handleKeyDownRename = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      commitRenameTab();
    } else if (e.key === "Escape") {
      setEditingTabId(null);
    }
  };

    const handleClearCurrent = useCallback(() => {
    const fn = clearHandlersRef.current.get(activeTabId);
    if (fn) fn();
  }, [activeTabId]);

  const activeCwd = cwdMap[activeTabId] || cwd || "";

  const handleSyncToWorkspace = () => {
    if (activeCwd && onSetWorkspaceRoot) {
      if (activeCwd === "/" || activeCwd === "\\" || /^[A-Za-z]:[\\/]?$/.test(activeCwd)) {
        if (!window.confirm(`Open root filesystem "${activeCwd}" as the workspace project?`)) {
          return;
        }
      }
      onSetWorkspaceRoot(activeCwd);
      setSyncedConfirm(true);
      setTimeout(() => setSyncedConfirm(false), 2000);
    }
  };

  if (!hasBeenOpened) return null;

  return (
    <div
      className={`flex-col border-t border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 transition-all duration-150 ${
        open ? "flex" : "hidden"
      } ${
        isMaximized ? "h-[85vh]" : "h-72"
      } relative z-20`}
    >
      {/* Terminal Toolbar */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-zinc-200 dark:border-zinc-800 select-none bg-zinc-50 dark:bg-zinc-950 text-xs">
        {/* Left: Tab list */}
        <div className="flex items-center space-x-1 overflow-x-auto min-w-0">
          <div className="flex items-center space-x-1">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              const isEditing = tab.id === editingTabId;
              return (
                <div
                  key={tab.id}
                  onClick={() => setActiveTabId(tab.id)}
                  onDoubleClick={(e) => startRenameTab(tab, e)}
                  title="Double-click to rename tab"
                  className={`flex items-center space-x-1 px-2.5 py-1 rounded text-xs cursor-pointer transition-colors ${
                    isActive
                      ? "bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-medium shadow-sm"
                      : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50"
                  }`}
                >
                  {isEditing ? (
                    <input
                      type="text"
                      data-testid="terminal-tab-rename-input"
                      value={editingTitle}
                      autoFocus
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onBlur={commitRenameTab}
                      onKeyDown={handleKeyDownRename}
                      className="bg-transparent border border-sky-500 rounded px-1 py-0 text-xs font-mono outline-none text-zinc-900 dark:text-zinc-100 w-24"
                    />
                  ) : (
                    <span>{tab.title}</span>
                  )}
                  {tabs.length > 1 && (
                    <span
                      onClick={(e) => removeTab(tab.id, e)}
                      role="button"
                      tabIndex={0}
                      aria-label="Close terminal tab"
                      className="ml-1 hover:text-red-500 rounded p-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <button
            onClick={addTab}
            type="button"
            title="New Terminal Tab"
            className="p-1 rounded text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>

        {/* Center: Current PWD & Open as Project button */}
        {activeCwd && (
          <div className="hidden md:flex items-center space-x-1.5 px-2 text-xs font-mono text-zinc-500 dark:text-zinc-400">
            {onSetWorkspaceRoot && (
              <button
                onClick={handleSyncToWorkspace}
                type="button"
                title={`Open "${activeCwd}" as the workspace project and reposition the LLM agent`}
                className={`flex items-center space-x-1 px-1.5 py-0.5 rounded text-[11px] font-sans transition-colors ${
                  syncedConfirm
                    ? "bg-emerald-500 text-white font-medium"
                    : "bg-zinc-200/80 hover:bg-sky-500 hover:text-white dark:bg-zinc-800 dark:hover:bg-sky-600 dark:hover:text-white text-zinc-700 dark:text-zinc-300"
                }`}
              >
                <span>
                  {syncedConfirm
                    ? "✓ Project opened"
                    : `📁 ${shortenPath(activeCwd)} → open as project`}
                </span>
              </button>
            )}
          </div>
        )}

        {/* Right: Actions */}
        <div className="flex items-center space-x-1 text-zinc-500 dark:text-zinc-400">
          <button
            onClick={handleClearCurrent}
            type="button"
            title="Clear Terminal Output"
            className="p-1 rounded hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
          <button
            onClick={() => setIsMaximized((prev) => !prev)}
            type="button"
            title={isMaximized ? "Restore Terminal Panel" : "Maximize Terminal Panel"}
            className="p-1 rounded hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60"
          >
            {isMaximized ? (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            )}
          </button>
          <button
            onClick={onClose}
            type="button"
            title="Minimize Terminal Panel (Ctrl+`)"
            className="p-1 rounded hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Terminal active view */}
      <div className="flex-1 min-h-0 relative">
        {tabs.map((tab) => (
          <SingleTerminalView
            key={tab.id}
            id={tab.id}
            cwd={cwd}
            isActive={tab.id === activeTabId}
            isPanelOpen={open}
            openTerminal={openTerminal}
            sendTerminalInput={sendTerminalInput}
            getTerminalCwd={getTerminalCwd}
            resizeTerminal={resizeTerminal}
            closeTerminal={closeTerminal}
            subscribeTerminal={subscribeTerminal}
            onCwdUpdate={handleCwdUpdate}
            registerClear={registerClear}
          />
        ))}
      </div>
    </div>
  );
}
