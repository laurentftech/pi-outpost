import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { OutcomeTarget, Theme, WireImage } from "@pi-outpost/shared";
import { AssistantMessage } from "./components/AssistantMessage";
import { CustomMessageCard } from "./components/CustomMessageCard";
import { SessionAnalysisPanel } from "./components/SessionAnalysis";
import { ThemeContext } from "./theme/ThemeContext";
import { useConversationJump } from "./useConversationJump";
import { analyzeSession } from "./util/sessionAnalysis";
import { sessionUsage } from "./util/sessionUsage";
import { repoForPath } from "./util/gitRepos";
import { ToolCard } from "./components/ToolCard";
import { createActionDispatch } from "./presentations/actions";
import { UserMessage } from "./components/UserMessage";
import { useTheme } from "./theme/useTheme";
import { hasPathExtractionTool, isImageFile, isPdfFile, rawFileUrl } from "./util/workspacePath";
import {
  addPathAttachment,
  imagePreviewToAttachment,
  pdfPreviewToAttachment,
  type Attachment,
  filesToAttachments,
  needsUpload,
  removeAttachment,
  replacePreviewAttachment,
  textPreviewToAttachment,
} from "./attachments";
import { Composer } from "./components/Composer";
import { ExtensionDialog } from "./components/ExtensionDialog";
import { ExtensionNotifications } from "./components/ExtensionNotifications";
import { ExtensionWidgets } from "./components/ExtensionWidgets";
import { FileViewer } from "./components/FileViewer";
import { GitCommitView } from "./components/GitCommitView";
import { GitFileHistory } from "./components/GitFileHistory";
import { Header } from "./components/Header";
import { useWorkspaceNotifications } from "./useWorkspaceNotifications";
import { ServerPathPicker } from "./components/ServerPathPicker";
import { ModelBar } from "./components/ModelBar";
import { Onboarding } from "./components/Onboarding";
import { Sidebar } from "./components/Sidebar";
import { TokenGate } from "./components/TokenGate";
import { WorkPlanPanel } from "./components/WorkPlanPanel";
import { TerminalPanel } from "./components/TerminalPanel";
import { OutcomePanel } from "./components/OutcomePanel";
import { useAgent } from "./useAgent";

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
  /**
   * Project this widget binds to, by its root path. Defaults to the server's
   * default project; a root the server does not have open falls back to it too.
   * Embedding hosts choose the project — the widget never offers to change it.
   */
  workspace?: string;
}

/**
 * How close to the end counts as "at the bottom", in pixels.
 *
 * One number, two readers: the effect that follows streamed content, and the
 * return-to-latest control's visibility. A second literal would let the button
 * claim the reader is away while the transcript keeps scrolling under them.
 */
const NEAR_BOTTOM_PX = 120;

const App = forwardRef<AppHandle, AppProps>(function App({ serverUrl = "", rootElement, initialTheme, token, workspace }, ref) {
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
    refreshFileTree,
    readFile,
    writeFile,
    createFile,
    createDirectory,
    uploadFile,
    openNative,
    renameFile,
    deleteFile,
    moveFile,
    copyFile,
    closeFilePreview,
    searchFiles,
    clearFileSearch,
    fetchGitDiff,
    clearGitDiff,
    fetchGitLog,
    fetchGitShow,
    clearGitShow,
    fetchGitFileHistory,
    closeGitFileHistory,
    fetchGitFileDiff,
    clearGitFileDiff,
    setCredential,
    declareProvider,
    updateConfig,
    suggestAgentResourceClonePath,
    cloneAgentResourceRepository,
    enrollAgentResourceRepository,
    refreshAgentResourceRepositories,
    updateAgentResourceRepository,
    browseServerDirectory,
    closeServerBrowser,
    switchWorkspace,
    openProject,
    closeProject,
    openTerminal,
    sendTerminalInput,
    getTerminalCwd,
    resizeTerminal,
    closeTerminal,
    subscribeTerminal,
    setOutcomeActive,
    refreshOutcome,
  } = useAgent(serverUrl, token, embedded, workspace);
  useWorkspaceNotifications(state.workspaces, state.workspace?.root ?? null);
  /**
   * Drop everything a switch must not carry across.
   *
   * Attachments name paths inside the project they were picked in, so following the
   * user to another one would send a file from the wrong sandbox. The scroll
   * position is reset for the same reason the open file is: coming back to a
   * project shows its conversation, not the screen it was left on. The composer
   * draft is the one thing that survives, and it lives in `drafts`.
   */
  const boundRoot = state.workspace?.root ?? null;
  useEffect(() => {
    setAttachments([]);
    setPendingUploads([]);
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [boundRoot]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  // Paths the composer's draft names with `@`: they reference a file as surely as a chip does
  const [draftMentions, setDraftMentions] = useState<string[]>([]);
  const [previewAttachmentError, setPreviewAttachmentError] = useState<string | null>(null);
  const [loadedPreviewImagePath, setLoadedPreviewImagePath] = useState<string | null>(null);
  const [loadedPreviewPdf, setLoadedPreviewPdf] = useState<{ path: string; revision: number } | null>(null);
  const [viewerDirty, setViewerDirty] = useState(false);
  /**
   * Unsent composer text, per project root.
   *
   * A ref rather than state: it changes on every keystroke and nothing renders
   * from it — only the composer's own remount reads it, when returning to a
   * project.
   */
  /**
   * Which header picker owns the single server-browse listing, or null.
   *
   * One value rather than a flag per control: Settings, the sandbox-root chooser
   * and the project chooser all read the same listing, so two open at once would
   * leave one of them showing a walk the other started, and cancelling either
   * would close the listing the other is still reading.
   */
  const [headerPicker, setHeaderPicker] = useState<"project" | "root" | "settings" | null>(null);
  /**
   * The last path the user touched in the tree, file or directory — what the branch
   * chip names a repository from. Not `openFile`: walking into a project without
   * opening anything is still saying which project you are in, and closing the viewer
   * is not saying you have left it.
   */
  const [treeSelection, setTreeSelection] = useState<string | null>(null);
  const projectPicker = headerPicker === "project";
  const setProjectPicker = (open: boolean) => setHeaderPicker(open ? "project" : null);
  /**
   * What a mounted widget offers for its workspace, from the server's policy.
   *
   * `settings` — the default, and what a server that has never heard of the
   * setting says — keeps the interface embeds have always had: one project, its
   * sandbox root reachable through Settings alone.
   */
  const embedControl =
    state.embedWorkspaceControls === "projects" ? "projects" : state.embedWorkspaceControls === "root" ? "root" : "none";
  const drafts = useRef<Record<string, string>>({});
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
  // Session analysis drawer: closed until asked for, from the model bar's usage indicator.
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [workPlanOpen, setWorkPlanOpen] = useState(true);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const terminalEnabled = state.terminal?.enabled ?? false;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!terminalEnabled) return;
      if ((event.ctrlKey || event.metaKey) && event.key === "`") {
        event.preventDefault();
        setTerminalOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [terminalEnabled]);

  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [requestedTaskId, setRequestedTaskId] = useState<string | null>(null);
  const clearRequestedTask = useCallback(() => setRequestedTaskId(null), []);
  function toggleAnalysis() {
    const next = !analysisOpen;
    setAnalysisOpen(next);
    if (next) { setWorkPlanOpen(false); setOutcomeOpen(false); }
  }
  function toggleWorkPlan() {
    const next = !workPlanOpen;
    setWorkPlanOpen(next);
    if (next) { setAnalysisOpen(false); setOutcomeOpen(false); }
  }
  function toggleOutcome() {
    const next = !outcomeOpen;
    setOutcomeOpen(next);
    if (next) { setAnalysisOpen(false); setWorkPlanOpen(false); }
  }
  useEffect(() => {
    setOutcomeActive(outcomeOpen);
    return () => setOutcomeActive(false);
  }, [outcomeOpen, setOutcomeActive, state.sessionId, state.workspace?.root]);
  useEffect(() => {
    setOutcomeOpen(false);
    setRequestedTaskId(null);
  }, [boundRoot]);
  const [attachmentErrors, setAttachmentErrors] = useState<string[]>([]);
  // Files being copied into the workspace right now — the composer shows one chip
  // each and refuses to send while any of them is outstanding.
  const [pendingUploads, setPendingUploads] = useState<{ id: string; name: string }[]>([]);
  const uploadCounterRef = useRef(0);
  // Overlapping drops form one "wave": the first to start clears what is on
  // screen, and every batch in the wave adds to it (see attachFiles).
  const batchesInFlightRef = useRef(0);
  // Counter, not boolean: dragenter/dragleave fire for every child crossed
  const [dragDepth, setDragDepth] = useState(0);

  /**
   * Files supplied from outside the workspace. The ones that need a copy travel to
   * the server first, so this is asynchronous where it used to be immediate — and
   * the pending chips exist because the composer must not send a prompt whose
   * attachments have not resolved yet.
   *
   * Pending entries carry an id rather than being keyed by name: dropping two
   * files called the same thing is ordinary, and clearing "the one named X" would
   * clear the wrong one.
   */
  async function attachFiles(files: Iterable<File>) {
    const list = [...files];
    const pending = list
      .filter(needsUpload)
      .map((file) => ({ id: `${uploadCounterRef.current++}`, name: file.name }));
    if (pending.length > 0) setPendingUploads((current) => [...current, ...pending]);
    // A batch clears the errors on screen only if it is the first one in flight.
    // This used to be a plain replace, which was safe while attaching was
    // synchronous; now that a batch spans a round trip, two overlapping drops
    // would race and the second one's (usually empty) errors would wipe the
    // first's before anyone had read them.
    if (batchesInFlightRef.current === 0) setAttachmentErrors([]);
    batchesInFlightRef.current++;
    try {
      const { attachments: added, errors } = await filesToAttachments(list, uploadFile);
      if (added.length > 0) setAttachments((current) => [...current, ...added]);
      if (errors.length > 0) setAttachmentErrors((current) => [...current, ...errors]);
    } finally {
      batchesInFlightRef.current--;
      // Cleared whatever the outcome: a failed upload contributes an error and no
      // attachment, and leaving its chip up would block submission forever.
      if (pending.length > 0) {
        const done = new Set(pending.map((entry) => entry.id));
        setPendingUploads((current) => current.filter((entry) => !done.has(entry.id)));
      }
    }
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
    const toolReadableBinary =
      file.status === "error" &&
      file.message === "Binary file — preview not supported" &&
      hasPathExtractionTool(path);

    if (activePreviewPathRef.current !== path) {
      activePreviewPathRef.current = path;
      dismissedPreviewPathRef.current = null;
      setAttachments((current) => current.filter((attachment) => attachment.source !== "preview"));
      setPreviewAttachmentError(null);
      setLoadedPreviewImagePath(null);
      setLoadedPreviewPdf(null);
    }
    if (dismissedPreviewPathRef.current === path) return;

    // A raw preview revision means the bytes at this path may have changed. Drop
    // the previous automatic attachment before attempting the replacement so a
    // failed refresh cannot leave stale image bytes queued for the next prompt.
    if (isImageFile(path) || isPdfFile(path)) {
      setAttachments((current) => current.filter((attachment) => attachment.source !== "preview"));
    }

    let cancelled = false;
    async function attachPreview() {
      const result = isImageFile(path)
        ? loadedPreviewImagePath === path
          ? await imagePreviewToAttachment(path, rawFileUrl(serverUrl, path, authToken, state.previewRevision))
          : null
          : isPdfFile(path)
          ? // A PDF never reaches "loaded" — the text preview refuses it as binary.
            // Its own viewer says when it displayed, and only then is it attachable.
            loadedPreviewPdf?.path === path && loadedPreviewPdf.revision === state.previewRevision
            ? pdfPreviewToAttachment(path)
            : null
          : toolReadableBinary
            ? textPreviewToAttachment(path)
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
  }, [state.openFile, state.previewRevision, serverUrl, authToken, loadedPreviewImagePath, loadedPreviewPdf]);

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
    state.branding.defaultTheme ?? "system",
    state.branding.allowThemeToggle !== false,
    accentTarget,
    initialTheme,
  );
  useImperativeHandle(ref, () => ({ setTheme }), [setTheme]);
  const mainRef = useRef<HTMLElement | null>(null);
  /**
   * The scroller, as state as well as a ref.
   *
   * The embed renders nothing until its branding request settles, so an effect
   * that reached for the ref on the first render found null — and nothing in its
   * dependencies changed when the real interface finally mounted, so it never
   * looked again. A callback ref reports the mount itself.
   */
  const [scrollerElement, setScrollerElement] = useState<HTMLElement | null>(null);
  const attachScroller = useCallback((node: HTMLElement | null) => {
    mainRef.current = node;
    setScrollerElement(node);
  }, []);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  /**
   * The same fact as `stickToBottom`, in a form a render can read.
   *
   * The ref stays authoritative: the effect below reads it in the tick a scroll
   * writes it, where state would still be one render behind and would follow
   * content the reader had just scrolled away from. This mirror exists only so
   * the return-to-latest control can appear and disappear, and it is written
   * everywhere the ref is — see `setStick` and `useConversationJump`.
   */
  const [atBottom, setAtBottom] = useState(true);

  /** Writes both representations of the near-bottom fact, so they cannot drift. */
  const setStick = useCallback((next: boolean) => {
    if (next !== stickToBottom.current) setAtBottom(next);
    stickToBottom.current = next;
  }, []);

  /** Reads the near-bottom fact off the scroller's current geometry. */
  const syncStick = useCallback(() => {
    const main = mainRef.current;
    if (!main) return;
    setStick(main.scrollHeight - main.scrollTop - main.clientHeight < NEAR_BOTTOM_PX);
  }, [setStick]);

  /**
   * True while a return-to-latest animation is still on its way to the end.
   *
   * A smooth scroll emits a scroll event per frame, and every one of them but the
   * last reports a viewport still far from the end. Read naively they say the
   * reader has gone back to the scrollback, which flickers the control on again
   * for the length of the animation and — worse — stops the transcript following
   * anything that streams in while it runs.
   */
  const returning = useRef<number | null>(null);

  /**
   * Arms the guard for a scroll this app is about to start towards the end.
   *
   * Only when that scroll has somewhere to travel. From inside the near-bottom
   * region it covers less ground than the region itself, so none of its frames
   * can read as a departure — and arming there would leave the guard held by an
   * animation that never ran, swallowing the reader's next scroll instead.
   */
  const beginReturn = useCallback(() => {
    const main = mainRef.current;
    if (!main) return;
    if (main.scrollHeight - main.scrollTop - main.clientHeight < NEAR_BOTTOM_PX) return;
    returning.current = main.scrollTop;
  }, []);

  // Track whether the user is reading scrollback: only auto-scroll when
  // already near the bottom (avoids yanking during streaming).
  const evaluatePosition = useCallback(() => {
    const main = mainRef.current;
    if (!main) return;
    const near = main.scrollHeight - main.scrollTop - main.clientHeight < NEAR_BOTTOM_PX;
    const from = returning.current;
    if (from !== null) {
      if (main.scrollTop < from) {
        // Away from the end: nothing this app started moves that way, so this is
        // the reader — with the scrollbar, say, which emits no gesture of its own.
        returning.current = null;
      } else {
        returning.current = near ? null : main.scrollTop;
        // Still on its way. Reporting the position it is passing through would
        // say the reader had left the bottom, which shows the control mid-flight
        // and stops the transcript following anything that streams in meanwhile.
        if (!near) return;
      }
    }
    setStick(near);
  }, [setStick]);

  /** A scroll the reader started: whatever we were animating towards, they own it now. */
  function handleScrollGesture() {
    returning.current = null;
  }

  /**
   * Two things the scroll handler alone would miss.
   *
   * `scrollend` is what finally ends a guarded return, whatever ended it: the
   * animation arriving, or a reader dragging the scrollbar *towards* the end and
   * letting go short of it — a drag that emits no gesture and only ever moves the
   * way the animation was going, so nothing else can tell it apart.
   *
   * The observer covers the geometry moving under a scroll position that did not:
   * a resized window, a composer that grew, tool cards revealed. None of those
   * scroll, and all of them can put the end out of reach without a word.
   */
  useEffect(() => {
    const main = scrollerElement;
    if (!main) return;
    const settle = () => {
      returning.current = null;
      evaluatePosition();
    };
    main.addEventListener("scrollend", settle);
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        if (stickToBottom.current) {
          // A reader being followed has not gone anywhere: the end moved. Content
          // that finishes rendering after it arrived — a diagram, an image — grows
          // the transcript with no item to trigger the effect that follows it, and
          // reporting the new distance would file the reader as having walked away
          // from a page they never touched.
          beginReturn();
          bottomRef.current?.scrollIntoView({ behavior: "auto" });
          return;
        }
        evaluatePosition();
      });
      observer.observe(main);
      // The transcript's own box: its height is what tool cards and streamed
      // content change, and the scroller's own box never moves for either.
      if (main.firstElementChild) observer.observe(main.firstElementChild);
    }
    return () => {
      main.removeEventListener("scrollend", settle);
      observer?.disconnect();
    };
  }, [scrollerElement, evaluatePosition, beginReturn]);

  /**
   * Return to the newest message.
   *
   * The near-bottom state is restored here rather than left to the scroll events
   * the animation emits: a smooth scroll that a reduced-motion setting turns into
   * a jump may never emit a settling event, which would strand the button on
   * screen and leave streamed content unfollowed.
   */
  const scrollToLatest = useCallback(() => {
    setStick(true);
    beginReturn();
    // `smooth` is not softened by a reduced-motion preference the way a CSS
    // transition is — the browser animates it regardless — so the preference is
    // read here and the scroll becomes a jump when it is set.
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    bottomRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
  }, [setStick, beginReturn]);

  useEffect(() => {
    if (stickToBottom.current) {
      // Guarded like the explicit return, and for the same reason: a turn or a
      // tool card taller than the near-bottom region starts this animation from
      // outside it, and its own intermediate frames would otherwise read as the
      // reader walking away — ending the follow midway through a stream.
      beginReturn();
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    /**
     * The transcript changed under a reader who is not at the end.
     *
     * `<main>` survives a session switch, so a reader parked at the top of a long
     * conversation who switches to a short or empty one keeps `scrollTop = 0` —
     * a position that is now the bottom, with no scroll event to say so. Reading
     * the geometry back is the only thing that notices, and it is safe here
     * precisely because the reader is not being followed: nothing moves.
     */
    syncStick();
  }, [state.items, syncStick, beginReturn]);

  // Recomputed only when the transcript itself changes, not on every unrelated
  // render of a component this tall.
  const usage = useMemo(() => sessionUsage(state.items), [state.items]);
  // The breakdown behind that total. Derived only while the panel is open: the
  // walk is linear but the rankings sort, and the panel is closed most of the time.
  const analysis = useMemo(
    () => (analysisOpen ? analyzeSession(state.items) : null),
    [analysisOpen, state.items],
  );
  // What a tool presentation is allowed to ask for. The names are a closed set
  // and each one lands on an action this app already exposes: a card can open a
  // file or its history, never send a message of its own making.
  const toolActions = useMemo(
    () =>
      createActionDispatch({
        readFile: (path) => {
          setDiffOnOpen(false);
          readFile(path);
        },
        fetchGitFileHistory: (path) => fetchGitFileHistory(path),
        // Same route the tree's diff badge takes: open the viewer already on the
        // uncommitted diff, which is what fetches it.
        fetchGitDiff: (path) => {
          setDiffOnOpen(true);
          readFile(path);
        },
        searchFiles: (query) => searchFiles(query),
      }),
    [readFile, fetchGitFileHistory, searchFiles],
  );
  const showTools = useCallback(() => setHideTools(false), []);
  /**
   * Stop following the bottom, because a jump has taken the reader elsewhere.
   *
   * Unless it has not. Jumping to something already on screen at the end of the
   * conversation moves nothing and emits no scroll event, so suppressing the
   * follow there would strand a reader who is *at* the bottom with a transcript
   * that no longer follows and no control offered to fix it — the control being
   * hidden precisely because they are at the bottom.
   *
   * The target's own box is what settles it, not the scroll position alone: a
   * jump from the bottom to something far above does move the reader, and waiting
   * for its first frame to prove that leaves a window in which a streamed item
   * pulls them straight back and cancels the navigation they just asked for.
   */
  const handleJump = useCallback(
    (target: Element) => {
      const main = mainRef.current;
      if (main) {
        const view = main.getBoundingClientRect();
        const box = target.getBoundingClientRect();
        const onScreen = box.top >= view.top && box.bottom <= view.bottom;
        const near = main.scrollHeight - main.scrollTop - main.clientHeight < NEAR_BOTTOM_PX;
        if (onScreen && near) return;
      }
      setStick(false);
    },
    [setStick],
  );
  const { jumpToItem, highlightIndex } = useConversationJump({
    items: state.items,
    scrollerRef: mainRef,
    hideTools,
    onShowTools: showTools,
    onJump: handleJump,
  });

  useEffect(() => {
    // An extension's setTitle() (see extensions.md#custom-ui) wins until branding changes again.
    // Skipped when embedded: the host page owns its own <title>.
    if (!embedded) document.title = state.extensionTitle ?? state.branding.title ?? "pi";
    if (state.branding.accentColor) {
      accentTarget.style.setProperty("--accent", state.branding.accentColor);
    }
  }, [state.branding, state.extensionTitle, embedded, accentTarget]);

  // The embed has no server-rendered shell to hide its defaults. Leave its
  // shadow root empty until the independent HTTP branding request settles, so
  // the first visible frame already carries the server's identity.
  if (embedded && !state.brandingReady) return null;

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
              Drop files to attach (images, documents &amp; text)
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
            onSelectDirectory={setTreeSelection}
            onRefresh={refreshFileTree}
            onSelectFile={(path) => {
              setDiffOnOpen(false);
              setTreeSelection(path);
              readFile(path);
            }}
            onSelectDiff={(path) => {
              setDiffOnOpen(true);
              setTreeSelection(path);
              readFile(path);
            }}
            onToggleAttachPath={toggleAttachPath}
            onCreateFile={(path) => {
              setDiffOnOpen(false);
              createFile(path);
            }}
            onCreateDirectory={createDirectory}
            onOpenNative={openNative}
            onRenameFile={renameFile}
            onDeleteFile={deleteFile}
            onMoveFile={moveFile}
            onCopyFile={copyFile}
            fileOperation={state.fileOperation}
            createError={state.createError}
            created={state.created}
          />
        )}
        <div className="flex h-full min-w-0 flex-1 flex-col">
          {/* Choosing a project root reuses the picker the sandbox root already
              uses — the same walk of the server's filesystem, for the same kind of
              answer. */}
          {projectPicker && (
            <ServerPathPicker
              label="Choose a project directory"
              browse={state.serverBrowse}
              onBrowse={browseServerDirectory}
              onSelect={(root) => {
                setProjectPicker(false);
                closeServerBrowser();
                openProject(root);
              }}
              onCancel={() => {
                setProjectPicker(false);
                closeServerBrowser();
              }}
            />
          )}
          <Header
            workspace={state.workspace}
            workspaces={state.workspaces}
            // The server lock alone. An embed that offers no project affordance
            // says so through `workspaceControl` below, so the two reasons stay
            // apart: one is what the server forbids, the other is what this
            // deployment chose to present.
            workspaceLocked={state.workspaceLocked}
            // Standalone is unchanged whatever the policy says: it applies to
            // mounted widgets only. Inside one, `settings` — the default, and
            // what every server said before the setting existed — offers nothing.
            workspaceControl={!embedded ? "projects" : embedControl}
            rootControl={{
              sandbox: state.sandbox,
              browse: state.serverBrowse,
              applyState: state.settingsApply,
              blocked: headerPicker !== null && headerPicker !== "root",
              onBrowse: browseServerDirectory,
              onCloseBrowser: () => {
                setHeaderPicker(null);
                closeServerBrowser();
              },
              onOpened: () => setHeaderPicker("root"),
              // The whole current sandbox with only the root replaced: the other
              // permissions and the writable root are the user's, not this
              // control's, and the server refuses the pair rather than quietly
              // relocating a writable root that would fall outside the new one.
              onSelect: (root) =>
                updateConfig({
                  sandbox: {
                    root,
                    allowWrite: state.sandbox?.allowWrite ?? false,
                    allowBash: state.sandbox?.allowBash ?? false,
                    ...(state.sandbox?.writableRoot ? { writableRoot: state.sandbox.writableRoot } : {}),
                  },
                }),
            }}
            onSwitchWorkspace={switchWorkspace}
            onOpenProject={() => { setProjectPicker(true); browseServerDirectory(""); }}
            onCloseProject={closeProject}
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
            outcomeOpen={outcomeOpen}
            hideTools={hideTools}
            onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
            onToggleOutcome={toggleOutcome}
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
            gitSelectedPath={treeSelection}
            gitLog={state.gitLog}
            extensionPaths={state.extensionPaths}
            configuredExtensionPaths={state.configuredExtensionPaths}
            userExtensionPaths={state.userExtensionPaths}
            extensionLock={state.extensionLock}
            tools={state.tools}
            commands={state.commands}
            sandbox={state.sandbox}
            gitUnavailable={state.gitUnavailable}
            userSkillPaths={state.userSkillPaths}
            serverBrowse={state.serverBrowse}
            settingsApply={state.settingsApply}
            agentResources={state.agentResources}
            agentResourceOperations={state.agentResourceOperations}
            versions={state.versions}
            onBrowseServerPath={browseServerDirectory}
            onCloseServerBrowser={closeServerBrowser}
            settingsPickerBlocked={headerPicker !== null && headerPicker !== "settings"}
            onSettingsPickerOpened={() => setHeaderPicker("settings")}
            onUpdateConfig={updateConfig}
            onSuggestAgentResourceClonePath={suggestAgentResourceClonePath}
            onCloneAgentResourceRepository={cloneAgentResourceRepository}
            onEnrollAgentResourceRepository={enrollAgentResourceRepository}
            onRefreshAgentResourceRepositories={refreshAgentResourceRepositories}
            onUpdateAgentResourceRepository={updateAgentResourceRepository}
            onFetchGitLog={fetchGitLog}
            onShowCommit={fetchGitShow}
            terminalOpen={terminalOpen}
            onToggleTerminal={terminalEnabled ? () => setTerminalOpen((prev) => !prev) : undefined}
          />

          {/* `z-0` makes this a stacking context, so everything inside it (the file
              viewer, a commit view) stays below the header's menus no matter what
              z-index it asks for. */}
          <div className="relative z-0 flex min-h-0 flex-1 flex-col">
          {state.workPlan && (
            <WorkPlanPanel
              plan={state.workPlan}
              open={workPlanOpen}
              onToggle={toggleWorkPlan}
              onOpenWorkspace={(path) => {
                setDiffOnOpen(false);
                readFile(path);
              }}
              requestedTaskId={requestedTaskId}
              onTaskRequestHandled={clearRequestedTask}
            />
          )}
          {outcomeOpen && (
            <OutcomePanel
              state={state.outcome}
              onClose={() => setOutcomeOpen(false)}
              onRefresh={refreshOutcome}
              onTarget={(target: OutcomeTarget) => {
                if (target.kind === "work-plan-task") {
                  setRequestedTaskId(target.taskId);
                  setOutcomeOpen(false);
                  setAnalysisOpen(false);
                  setWorkPlanOpen(true);
                } else if (target.kind === "workspace-file") {
                  setDiffOnOpen(false);
                  readFile(target.path);
                } else if (target.kind === "workspace-diff") {
                  setDiffOnOpen(true);
                  readFile(target.path);
                }
              }}
            />
          )}
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
              inRepository={repoForPath(state.gitStatus?.repos ?? [], state.openFile.path) !== null}
              onOpenGitHistory={fetchGitFileHistory}
              onClose={closePreview}
              onReload={readFile}
              onSave={writeFile}
              serverUrl={serverUrl}
              token={authToken}
              onImageLoad={setLoadedPreviewImagePath}
              onPdfLoad={(path) => setLoadedPreviewPdf({ path, revision: state.previewRevision })}
              rawRevision={state.previewRevision}
            />
          )}
          {state.gitFileHistory && (
            <GitFileHistory
              history={state.gitFileHistory}
              diff={state.gitFileDiff}
              dirty={state.gitStatus?.files[state.gitFileHistory.path] !== undefined}
              onFetchDiff={fetchGitFileDiff}
              onClearDiff={clearGitFileDiff}
              onClose={closeGitFileHistory}
            />
          )}
          {state.gitShow && <GitCommitView show={state.gitShow} onClose={clearGitShow} />}
          {analysis && (
            <SessionAnalysisPanel
              analysis={analysis}
              onJump={jumpToItem}
              onClose={() => setAnalysisOpen(false)}
            />
          )}
          {/* The drawer overlays the right side; padding keeps the conversation
              beside it rather than behind it, so a jump lands somewhere visible. */}
          <main
            ref={attachScroller}
            onScroll={evaluatePosition}
            // A gesture beats an animation: whichever of these the reader makes,
            // the return we were still animating stops being what they asked for.
            onWheel={handleScrollGesture}
            onTouchStart={handleScrollGesture}
            onKeyDown={handleScrollGesture}
            /* During a switch the outgoing conversation fades and holds rather than
               emptying: a blank pane makes a switch read as a page reload, which is
               the one thing this transition exists to avoid. No skeleton — the old
               content stays until the new arrives. */
            className={`flex-1 overflow-y-auto transition-opacity duration-150 ${state.switching ? "opacity-40" : "opacity-100"} ${analysisOpen ? "md:pr-[26rem]" : state.workPlan && workPlanOpen ? "md:pr-[23rem]" : ""}`}
          >
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
                // `data-item-index` is what the analysis panel scrolls to; the ring
                // marks the arrival long enough to find it among its neighbours.
                const anchor = (content: React.ReactNode, anchorKey = key) => (
                  <div
                    key={anchorKey}
                    data-item-index={i}
                    className={`flex flex-col gap-3 rounded-lg transition-shadow ${
                      highlightIndex === i ? "ring-2 ring-blue-400 dark:ring-blue-500" : ""
                    }`}
                  >
                    {content}
                  </div>
                );
                if (item.kind === "user") {
                  const showSpinner = i === state.items.length - 1 && state.isStreaming;
                  return anchor(
                    <>
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
                    </>,
                  );
                }
                if (item.kind === "tool") {
                  if (hideTools) return null;
                  return anchor(
                    <ToolCard item={item} dispatch={toolActions} />,
                    item.toolCallId ? `${state.sessionId}:${item.toolCallId}` : key,
                  );
                }
                if (item.kind === "custom") {
                  return anchor(<CustomMessageCard item={item} />);
                }
                // Tool-call-only messages produce empty assistant items — nothing to
                // show, but they are turns and carry usage, so the analysis can point
                // at one. A bare anchor keeps that jump from landing nowhere.
                if (item.blocks.length === 0 && !item.errorMessage) {
                  return <div key={key} data-item-index={i} className="sr-only" aria-hidden />;
                }
                return anchor(
                  <AssistantMessage
                    item={item}
                    serverUrl={serverUrl}
                    token={authToken}
                    onOpenFile={(path) => {
                      setDiffOnOpen(false);
                      readFile(path);
                    }}
                  />,
                );
              })}

              {/*
                The prompt this client just sent, until the server echoes it back.
                Dimmed and not editable: it has no persisted entry to rewind to,
                and it is a claim about what was sent, not yet a record of it.
              */}
              {state.pendingPrompt && (
                <div className="flex flex-col gap-3 opacity-60" data-pending-prompt>
                  <UserMessage
                    item={{ kind: "user", ...state.pendingPrompt }}
                    canEdit={false}
                    onEdit={() => {}}
                  />
                  <div className="flex justify-end px-4">
                    <div className="flex items-center gap-2 py-1">
                      <span className="inline-block h-4 w-4 animate-spin rounded-full border-[3px] border-zinc-300 border-t-blue-500 dark:border-zinc-600 dark:border-t-blue-400 motion-reduce:animate-pulse" />
                      <span className="text-xs text-zinc-400 dark:text-zinc-500">sending…</span>
                    </div>
                  </div>
                </div>
              )}

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
          {/* Outside <main> on purpose: a child of the scroller travels with the
              transcript. Absolute against the `relative z-0` wrapper rather than
              `fixed`, which would resolve against the host page's viewport when
              this widget is embedded in one, not against the widget.

              `z-0` rather than `z-10`: the drawers that overlay the conversation
              sit at `z-10` and are rendered above this in the tree, so an equal
              level would let a control for the transcript paint over the panel
              covering it — full-width, on a narrow viewport. Still above the
              transcript, which is not positioned at all.

              The strip carries the same padding <main> takes beside an open
              drawer, so the button centres on the conversation the reader can
              see rather than on the region the drawer is sitting in. */}
          <div
            className={`pointer-events-none absolute inset-x-0 bottom-4 z-0 flex justify-center ${analysisOpen || outcomeOpen ? "md:pr-[26rem]" : state.workPlan && workPlanOpen ? "md:pr-[23rem]" : ""}`}
          >
          {!atBottom && (
            <button
              type="button"
              onClick={scrollToLatest}
              aria-label="Scroll to the latest message"
              className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-zinc-300 bg-white/95 px-3 py-1.5 text-xs text-zinc-600 shadow-lg backdrop-blur transition-colors hover:bg-zinc-50 motion-reduce:transition-none dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <span aria-hidden>↓</span>
              Latest
            </button>
          )}
          </div>
          </div>

          {terminalEnabled && (
            <TerminalPanel
              open={terminalOpen}
              onClose={() => setTerminalOpen(false)}
              cwd={state.workspace?.root}
              onSetWorkspaceRoot={(newRoot) => {
                if (openProject && !embedded) {
                  openProject(newRoot);
                } else if (state.sandbox) {
                  updateConfig({
                    sandbox: {
                      root: newRoot,
                      allowWrite: state.sandbox.allowWrite,
                      allowBash: state.sandbox.allowBash,
                      ...(state.sandbox.writableRoot ? { writableRoot: state.sandbox.writableRoot } : {}),
                    },
                  });
                } else {
                  // No sandbox configured on this server: keep unconstrained write and bash
                  updateConfig({
                    sandbox: {
                      root: newRoot,
                      allowWrite: true,
                      allowBash: true,
                    },
                  });
                }
              }}
              openTerminal={openTerminal}
              sendTerminalInput={sendTerminalInput}
              getTerminalCwd={getTerminalCwd}
              resizeTerminal={resizeTerminal}
              closeTerminal={closeTerminal}
              subscribeTerminal={subscribeTerminal}
            />
          )}

          <footer className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <div className="mx-auto max-w-3xl">
              <ExtensionWidgets widgets={state.widgets} placement="aboveEditor" />
              <Composer
                // Remount on a project change so the restored draft becomes the
                // field's initial value; without the key React keeps the old text.
                key={state.workspace?.root ?? ""}
                initialDraft={drafts.current[state.workspace?.root ?? ""] ?? ""}
                onDraftChange={(text) => {
                  drafts.current[state.workspace?.root ?? ""] = text;
                }}
                isStreaming={state.isStreaming}
                connected={state.connected}
                commands={state.commands}
                fileSearch={state.fileSearch}
                prefill={state.editorPrefill}
                attachments={attachments}
                pendingUploads={pendingUploads}
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
                thinkingLevels={state.thinkingLevels}
                modelSupportsReasoning={state.modelSupportsReasoning}
                isStreaming={state.isStreaming}
                contextUsage={state.contextUsage}
                sessionUsage={usage}
                analysisOpen={analysisOpen}
                onToggleAnalysis={toggleAnalysis}
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
