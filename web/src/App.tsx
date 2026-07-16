import { forwardRef, Fragment, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { Theme, WireImage } from "@pi-outpost/shared";
import { AssistantMessage } from "./components/AssistantMessage";
import {
  addPathAttachment,
  imagePreviewToAttachment,
  type Attachment,
  filesToAttachments,
  removeAttachment,
  replacePreviewAttachment,
  textPreviewToAttachment,
} from "./attachments";
import { Composer } from "./components/Composer";
import { CustomMessageCard } from "./components/CustomMessageCard";
import { ExtensionDialog } from "./components/ExtensionDialog";
import { ExtensionNotifications } from "./components/ExtensionNotifications";
import { ExtensionWidgets } from "./components/ExtensionWidgets";
import { FileViewer } from "./components/FileViewer";
import { GitCommitView } from "./components/GitCommitView";
import { Header } from "./components/Header";
import { ModelBar } from "./components/ModelBar";
import { Onboarding } from "./components/Onboarding";
import { Sidebar } from "./components/Sidebar";
import { TokenGate } from "./components/TokenGate";
import { ToolCard } from "./components/ToolCard";
import { UserMessage } from "./components/UserMessage";
import { ThemeContext } from "./ThemeContext";
import { useAgent } from "./useAgent";
import { useTheme } from "./useTheme";
import { isImageFile, rawFileUrl } from "./workspacePath";

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
  /** Auth token for servers with `server.token` set (embed hosts supply it programmatically). */
  token?: string;
}

const App = forwardRef<AppHandle, AppProps>(function App({ serverUrl = "", rootElement, initialTheme, token }, ref) {
  const embedded = rootElement !== undefined;
  const accentTarget = rootElement ?? document.documentElement;
  const {
    state,
    authToken,
    submitToken,
    prompt,
    abort,
    setModel,
    setThinking,
    newSession,
    switchSession,
    deleteSession,
    listSessions,
    renameSession,
    searchSessions,
    clearSessionSearch,
    listTree,
    navigateTree,
    forkSession,
    editPrompt,
    compact,
    respondToDialog,
    dismissNotification,
    listDirectory,
    readFile,
    writeFile,
    closeFilePreview,
    searchFiles,
    clearFileSearch,
    fetchGitDiff,
    clearGitDiff,
    fetchGitLog,
    fetchGitShow,
    clearGitShow,
    setCredential,
    declareProvider,
  } = useAgent(serverUrl, token, embedded);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  // Paths the composer's draft names with `@`: they reference a file as surely as a chip does
  const [draftMentions, setDraftMentions] = useState<string[]>([]);
  const [previewAttachmentError, setPreviewAttachmentError] = useState<string | null>(null);
  const [loadedPreviewImagePath, setLoadedPreviewImagePath] = useState<string | null>(null);
  const [viewerDirty, setViewerDirty] = useState(false);
  const attachmentsRef = useRef<Attachment[]>([]);
  const activePreviewPathRef = useRef<string | null>(null);
  const dismissedPreviewPathRef = useRef<string | null>(null);
  // Badge click in the tree opens the file straight onto its uncommitted diff
  const [diffOnOpen, setDiffOnOpen] = useState(false);
  // Tool-noise filter: skip tool cards in the list (long sessions drown in them).
  // Cards aren't CSS-hidden — hidden ones must not cost layout.
  const [hideTools, setHideTools] = useState(() => {
    try {
      return localStorage.getItem("pi-outpost:hide-tools") === "1";
    } catch {
      return false;
    }
  });
  function toggleHideTools() {
    setHideTools((current) => {
      try {
        localStorage.setItem("pi-outpost:hide-tools", current ? "0" : "1");
      } catch {
        // Storage unavailable — the toggle still works for this session
      }
      return !current;
    });
  }
  const [attachmentErrors, setAttachmentErrors] = useState<string[]>([]);
  // Counter, not boolean: dragenter/dragleave fire for every child crossed
  const [dragDepth, setDragDepth] = useState(0);

  async function attachFiles(files: Iterable<File>) {
    const { attachments: added, errors } = await filesToAttachments(files);
    if (added.length > 0) setAttachments((current) => [...current, ...added]);
    setAttachmentErrors(errors);
  }

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    const file = state.openFile;
    // Closing the viewer must not discard its context: the user needs to close the
    // overlay before they can use the composer. A newly opened file replaces it.
    if (!file) return;
    const path = file.path;
    const loaded = file.status === "loaded";

    if (activePreviewPathRef.current !== path) {
      activePreviewPathRef.current = path;
      dismissedPreviewPathRef.current = null;
      setAttachments((current) => current.filter((attachment) => attachment.source !== "preview"));
      setPreviewAttachmentError(null);
      setLoadedPreviewImagePath(null);
    }
    if (dismissedPreviewPathRef.current === path) return;

    let cancelled = false;
    async function attachPreview() {
      const result = isImageFile(path)
        ? loadedPreviewImagePath === path
          ? await imagePreviewToAttachment(path, rawFileUrl(serverUrl, path, authToken))
          : null
        : loaded
          ? textPreviewToAttachment(path)
          : null;
      if (cancelled || result === null || activePreviewPathRef.current !== path || dismissedPreviewPathRef.current === path) return;
      if (typeof result === "string") {
        setPreviewAttachmentError(result);
        return;
      }
      setPreviewAttachmentError(null);
      setAttachments((current) => replacePreviewAttachment(current, result));
    }
    void attachPreview();
    return () => {
      cancelled = true;
    };
  }, [state.openFile, serverUrl, authToken, loadedPreviewImagePath]);

  function closePreview() {
    activePreviewPathRef.current = null;
    dismissedPreviewPathRef.current = null;
    closeFilePreview();
  }

  const attachedPaths = useMemo(
    () => [
      ...attachments.filter((attachment) => attachment.kind === "path").map((attachment) => attachment.data),
      ...draftMentions,
    ],
    [attachments, draftMentions],
  );

  /** Tree pin: reference a file in the prompt, or drop the reference it already has. */
  function toggleAttachPath(path: string) {
    const index = attachmentsRef.current.findIndex((attachment) => attachment.kind === "path" && attachment.data === path);
    // Removing through the same path as the chip's ✕ keeps the preview-suppression bookkeeping in one place
    if (index >= 0) handleRemoveAttachment(index);
    // A path the draft already mentions needs no chip — and the tree must not edit the user's text
    else if (!draftMentions.includes(path)) setAttachments((current) => addPathAttachment(current, path));
  }

  function handleRemoveAttachment(index: number) {
    const attachment = attachmentsRef.current[index];
    if (attachment?.source === "preview") {
      dismissedPreviewPathRef.current = attachment.previewPath ?? activePreviewPathRef.current;
      setPreviewAttachmentError(null);
    }
    setAttachments((current) => removeAttachment(current, index));
  }

  function sendPrompt(text: string, images?: WireImage[]) {
    prompt(text, images);
    setAttachments([]);
    setAttachmentErrors([]);
    setPreviewAttachmentError(null);
    // Sending a message means the user wants the conversation back — close the file
    // viewer unless it holds unsaved edits (the viewer's activity strip covers that case)
    if (!viewerDirty) closePreview();
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragDepth(0);
    if (e.dataTransfer.files.length > 0) void attachFiles(Array.from(e.dataTransfer.files));
  }
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

  if (state.authRequired) {
    return (
      <ThemeContext.Provider value={theme}>
        <TokenGate title={state.branding.title} onSubmit={submitToken} />
      </ThemeContext.Provider>
    );
  }

  // No model can answer: a chat here would only fail on the user's first message,
  // with an error pointing at a terminal command this UI does not have. Ask instead.
  if (state.credentials && !state.credentials.usableModel) {
    return (
      <ThemeContext.Provider value={theme}>
        <Onboarding
          title={state.branding.title}
          credentials={state.credentials}
          onSetCredential={setCredential}
          onDeclareProvider={declareProvider}
          errors={state.errors}
        />
      </ThemeContext.Provider>
    );
  }

  return (
    <ThemeContext.Provider value={theme}>
      <div
        className="relative flex h-full"
        onDragEnter={(e) => {
          if (e.dataTransfer.types.includes("Files")) setDragDepth((d) => d + 1);
        }}
        onDragLeave={() => setDragDepth((d) => Math.max(0, d - 1))}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        {dragDepth > 0 && (
          // Above the header (z-30) too: a drop target the header punches a hole in reads as broken.
          <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center border-2 border-dashed bg-white/70 backdrop-blur-sm dark:bg-zinc-950/70" style={{ borderColor: "var(--accent, #3b82f6)" }}>
            <p className="text-lg font-medium text-zinc-700 dark:text-zinc-200">
              Drop files to attach (images &amp; text)
            </p>
          </div>
        )}
        {sidebarOpen && (
          <Sidebar
            tree={state.fileTree}
            openFile={state.openFile}
            writableRoot={state.writableRoot}
            gitFiles={state.gitStatus?.files}
            attachedPaths={attachedPaths}
            onExpand={listDirectory}
            onSelectFile={(path) => {
              setDiffOnOpen(false);
              readFile(path);
            }}
            onSelectDiff={(path) => {
              setDiffOnOpen(true);
              readFile(path);
            }}
            onToggleAttachPath={toggleAttachPath}
          />
        )}
        <div className="flex h-full min-w-0 flex-1 flex-col">
          <Header
            title={state.branding.title}
            sessions={state.sessions}
            sessionSearch={state.sessionSearch}
            sessionId={state.sessionId}
            tree={state.tree}
            isStreaming={state.isStreaming}
            connected={state.connected}
            theme={theme}
            showThemeToggle={state.branding.allowThemeToggle !== false}
            statuses={state.statuses}
            sidebarOpen={sidebarOpen}
            hideTools={hideTools}
            onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
            onToggleHideTools={toggleHideTools}
            onToggleTheme={toggleTheme}
            onNewSession={newSession}
            onSwitchSession={switchSession}
            onDeleteSession={deleteSession}
            onListSessions={listSessions}
            onRenameSession={renameSession}
            onSearchSessions={searchSessions}
            onClearSessionSearch={clearSessionSearch}
            onListTree={listTree}
            onNavigateTree={navigateTree}
            onForkSession={forkSession}
            gitAvailable={state.gitAvailable}
            gitStatus={state.gitStatus}
            gitLog={state.gitLog}
            onFetchGitLog={fetchGitLog}
            onShowCommit={fetchGitShow}
          />

          {/* `z-0` makes this a stacking context, so everything inside it (the file
              viewer, a commit view) stays below the header's menus no matter what
              z-index it asks for. */}
          <div className="relative z-0 flex min-h-0 flex-1 flex-col">
          {state.openFile && (
            <FileViewer
              // Remount per file: edit drafts must never survive a switch to another path
              key={state.openFile.path}
              file={state.openFile}
              writableRoot={state.writableRoot}
              isStreaming={state.isStreaming}
              onDirtyChange={setViewerDirty}
              gitState={state.gitStatus?.files[state.openFile.path]}
              initialShowGitDiff={diffOnOpen}
              gitDiff={state.gitDiff}
              onFetchGitDiff={fetchGitDiff}
              onClearGitDiff={clearGitDiff}
              onClose={closePreview}
              onReload={readFile}
              onSave={writeFile}
              serverUrl={serverUrl}
              token={authToken}
              onImageLoad={setLoadedPreviewImagePath}
            />
          )}
          {state.gitShow && <GitCommitView show={state.gitShow} onClose={clearGitShow} />}
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
                  const showSpinner = i === state.items.length - 1 && state.isStreaming;
                  return (
                    <Fragment key={key}>
                      <UserMessage
                        item={item}
                        canEdit={!state.isStreaming && state.connected}
                        onEdit={editPrompt}
                      />
                      {showSpinner && (
                        <div className="flex justify-end px-4">
                          <div className="flex items-center gap-2 py-1">
                            <span className="inline-block h-4 w-4 animate-spin rounded-full border-[3px] border-zinc-300 border-t-blue-500 dark:border-zinc-600 dark:border-t-blue-400 motion-reduce:animate-pulse" />
                            <span className="text-xs text-zinc-400 dark:text-zinc-500">working…</span>
                          </div>
                        </div>
                      )}
                    </Fragment>
                  );
                }
                if (item.kind === "tool") {
                  if (hideTools) return null;
                  return <ToolCard key={item.toolCallId ? `${state.sessionId}:${item.toolCallId}` : key} item={item} />;
                }
                if (item.kind === "custom") {
                  return <CustomMessageCard key={key} item={item} />;
                }
                // Tool-call-only messages produce empty assistant items — skip them
                if (item.blocks.length === 0 && !item.errorMessage) return null;
                return (
                  <AssistantMessage
                    key={key}
                    item={item}
                    serverUrl={serverUrl}
                    token={authToken}
                    onOpenFile={(path) => {
                      setDiffOnOpen(false);
                      readFile(path);
                    }}
                  />
                );
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

              {attachmentErrors.map((error, i) => (
                <div
                  key={`att${i}`}
                  className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300"
                >
                  {error}
                </div>
              ))}
              {previewAttachmentError && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
                  {previewAttachmentError}
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
          </div>

          <footer className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <div className="mx-auto max-w-3xl">
              <ExtensionWidgets widgets={state.widgets} placement="aboveEditor" />
              <Composer
                isStreaming={state.isStreaming}
                connected={state.connected}
                commands={state.commands}
                fileSearch={state.fileSearch}
                prefill={state.editorPrefill}
                attachments={attachments}
                onAttach={(files) => void attachFiles(files)}
                onMentionPaths={setDraftMentions}
                onRemoveAttachment={handleRemoveAttachment}
                onSend={sendPrompt}
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
