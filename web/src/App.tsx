import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Theme } from "@pi-outpost/shared";
import { AssistantMessage } from "./components/AssistantMessage";
import { Composer } from "./components/Composer";
import { CustomMessageCard } from "./components/CustomMessageCard";
import { ExtensionDialog } from "./components/ExtensionDialog";
import { ExtensionNotifications } from "./components/ExtensionNotifications";
import { ExtensionWidgets } from "./components/ExtensionWidgets";
import { Header } from "./components/Header";
import { ModelBar } from "./components/ModelBar";
import { Sidebar } from "./components/Sidebar";
import { ToolCard } from "./components/ToolCard";
import { ThemeContext } from "./ThemeContext";
import { useAgent } from "./useAgent";
import { useTheme } from "./useTheme";

export interface AppHandle {
  setTheme(theme: Theme): void;
}

interface AppProps {
  /** pi-outpost backend origin (e.g. "https://api.example.com"); "" (default) = same origin as this page. */
  serverUrl?: string;
  /**
   * Element `data-theme`/`--accent` are applied to. Defaults to
   * `document.documentElement` (the standalone app). Passing one also skips the
   * `document.title` mutation below — both would otherwise leak onto the host
   * page when mounted inside a Shadow DOM (see `embed/src/mount.tsx`).
   */
  rootElement?: HTMLElement;
  /** Overrides branding.defaultTheme (avoids a flash of the wrong theme before branding loads). */
  initialTheme?: Theme;
}

const App = forwardRef<AppHandle, AppProps>(function App({ serverUrl = "", rootElement, initialTheme }, ref) {
  const embedded = rootElement !== undefined;
  const accentTarget = rootElement ?? document.documentElement;
  const {
    state,
    prompt,
    abort,
    setModel,
    setThinking,
    newSession,
    switchSession,
    deleteSession,
    listSessions,
    compact,
    respondToDialog,
    dismissNotification,
    listDirectory,
    readFile,
    closeFilePreview,
    searchFiles,
    clearFileSearch,
  } = useAgent(serverUrl);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { theme, toggle: toggleTheme, setTheme } = useTheme(
    initialTheme ?? state.branding.defaultTheme ?? "system",
    state.branding.allowThemeToggle !== false,
    accentTarget,
  );
  useImperativeHandle(ref, () => ({ setTheme }), [setTheme]);
  const mainRef = useRef<HTMLElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Track whether the user is reading scrollback: only auto-scroll when
  // already near the bottom (avoids yanking during streaming).
  function handleScroll() {
    const main = mainRef.current;
    if (!main) return;
    stickToBottom.current = main.scrollHeight - main.scrollTop - main.clientHeight < 120;
  }

  useEffect(() => {
    if (stickToBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [state.items]);

  useEffect(() => {
    // An extension's setTitle() (see extensions.md#custom-ui) wins until branding changes again.
    // Skipped when embedded: the host page owns its own <title>.
    if (!embedded) document.title = state.extensionTitle ?? state.branding.title ?? "pi";
    if (state.branding.accentColor) {
      accentTarget.style.setProperty("--accent", state.branding.accentColor);
    }
  }, [state.branding, state.extensionTitle, embedded, accentTarget]);

  return (
    <ThemeContext.Provider value={theme}>
      <div className="flex h-full">
        {sidebarOpen && (
          <Sidebar
            tree={state.fileTree}
            openFile={state.openFile}
            writableRoot={state.writableRoot}
            onExpand={listDirectory}
            onSelectFile={readFile}
            onClosePreview={closeFilePreview}
          />
        )}
        <div className="flex h-full min-w-0 flex-1 flex-col">
          <Header
            title={state.branding.title}
            sessions={state.sessions}
            sessionId={state.sessionId}
            isStreaming={state.isStreaming}
            connected={state.connected}
            theme={theme}
            showThemeToggle={state.branding.allowThemeToggle !== false}
            statuses={state.statuses}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
            onToggleTheme={toggleTheme}
            onNewSession={newSession}
            onSwitchSession={switchSession}
            onDeleteSession={deleteSession}
            onListSessions={listSessions}
          />

          <main ref={mainRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
            <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-6">
              {state.items.length === 0 && (
                <div className="mt-24 text-center text-zinc-500 dark:text-zinc-600">
                  <div className="mb-2 text-4xl">{state.branding.title ?? "π"}</div>
                  <p className="text-sm">{state.branding.welcome ?? "Send a message to start the agent."}</p>
                </div>
              )}
              {state.items.map((item, i) => {
                // Scope keys to the session so component state (collapsed cards…)
                // never bleeds across session_replaced
                const key = `${state.sessionId}:${i}`;
                if (item.kind === "user") {
                  return (
                    <div
                      key={key}
                      className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-xl bg-blue-100 px-4 py-2 text-[15px] text-blue-950 dark:bg-blue-950/60 dark:text-zinc-100"
                    >
                      {item.text}
                    </div>
                  );
                }
                if (item.kind === "tool") {
                  return <ToolCard key={item.toolCallId ? `${state.sessionId}:${item.toolCallId}` : key} item={item} />;
                }
                if (item.kind === "custom") {
                  return <CustomMessageCard key={key} item={item} />;
                }
                // Tool-call-only messages produce empty assistant items — skip them
                if (item.blocks.length === 0 && !item.errorMessage) return null;
                return <AssistantMessage key={key} item={item} />;
              })}

              {(state.queue.steering.length > 0 || state.queue.followUp.length > 0) && (
                <div className="rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-700">
                  {state.queue.steering.map((text, i) => (
                    <div key={`s${i}`}>⏩ steering: {text}</div>
                  ))}
                  {state.queue.followUp.map((text, i) => (
                    <div key={`f${i}`}>⏭ follow-up: {text}</div>
                  ))}
                </div>
              )}

              {state.errors.map((error, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
                >
                  {error}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          </main>

          <footer className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <div className="mx-auto max-w-3xl">
              <ExtensionWidgets widgets={state.widgets} placement="aboveEditor" />
              <Composer
                isStreaming={state.isStreaming}
                connected={state.connected}
                commands={state.commands}
                fileSearch={state.fileSearch}
                prefill={state.editorPrefill}
                onSend={prompt}
                onAbort={abort}
                onSearchFiles={searchFiles}
                onClearFileSearch={clearFileSearch}
              />
              <ExtensionWidgets widgets={state.widgets} placement="belowEditor" />
              <ModelBar
                model={state.model}
                models={state.models}
                thinkingLevel={state.thinkingLevel}
                modelSupportsReasoning={state.modelSupportsReasoning}
                isStreaming={state.isStreaming}
                contextUsage={state.contextUsage}
                isCompacting={state.isCompacting}
                onSetModel={setModel}
                onSetThinking={setThinking}
                onCompact={compact}
              />
            </div>
          </footer>
        </div>
      </div>

      {state.dialogQueue[0] && <ExtensionDialog request={state.dialogQueue[0]} onRespond={respondToDialog} />}
      <ExtensionNotifications notifications={state.notifications} onDismiss={dismissNotification} />
    </ThemeContext.Provider>
  );
});

export default App;
