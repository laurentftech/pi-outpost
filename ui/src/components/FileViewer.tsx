import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { GitFileState } from "@pi-outpost/shared";
import type { GitDiffState, OpenFile } from "../useAgent";
import { CodeHighlight } from "./CodeHighlight";
import { CopyButton } from "./CopyButton";
import { SplitDiffBlock } from "./DiffBlocks";
import { diffLines } from "../util/diff";
import { isImageFile, isPdfFile, rawFileUrl, resolveRelativeHref } from "../util/workspacePath";
import { normalizeMathDelimiters } from "../util/markdownMath";
import { MarkdownPre } from "./Mermaid";
import { ViewerErrorBoundary } from "./ViewerErrorBoundary";
import { readStructuredExchangeFile } from "../presentations/structuredExchange";
import type { ValidatedStructuredExchange } from "@pi-outpost/shared/structured-exchange";
import { StructuredExchangeDocument } from "../presentations/StructuredExchangeView";
import { FindBar } from "./FindBar";
import { findMatchesInText, highlightMatches, type DomMatch } from "../util/findInPage";
import type { PdfFindState, PdfViewerHandle } from "./PdfViewer";

// pdf.js is over a megabyte: a session that never opens a PDF must not load it.
const PdfViewer = lazy(() => import("./PdfViewer"));

interface FileViewerProps {
  file: OpenFile;
  /** Writable zone; see SessionSnapshot.writableRoot (undefined = everything, null = nothing). */
  writableRoot?: string | null;
  /** The viewer covers the chat: surface agent activity so a running reply isn't invisible. */
  isStreaming: boolean;
  /** Reports whether the editor holds unsaved changes (App auto-closes the viewer on prompt send only when it doesn't). */
  onDirtyChange: (dirty: boolean) => void;
  /** Git status of this file, when it has uncommitted changes (enables the diff toggle). */
  gitState?: GitFileState;
  /** Open straight onto the uncommitted diff (tree badge click). */
  initialShowGitDiff?: boolean;
  /** Latest git_diff answer (may belong to another file — matched by path). */
  gitDiff: GitDiffState | null;
  onFetchGitDiff: (path: string) => void;
  onClearGitDiff: () => void;
  /**
   * Whether this file is inside one of the workspace's repositories — which enables
   * the history affordance, for any file in one, changed or not.
   *
   * Not "does the workspace have git": a directory of projects can hold loose files
   * beside versioned ones, and a file under no repository has no history to show.
   */
  inRepository: boolean;
  onOpenGitHistory: (path: string) => void;
  onClose: () => void;
  /** Refetch the file from disk (discards the edit baseline). */
  onReload: (path: string) => void;
  onSave: (path: string, content: string, expectedMtimeMs: number, force?: boolean) => void;
  /** Backend origin for the embed widget ("" = same-origin) — for /files/raw image URLs. */
  serverUrl?: string;
  /** Auth token appended to /files/raw image URLs (img can't send headers). */
  token?: string | null;
  /** Confirms that an image preview decoded successfully before it becomes a chat attachment. */
  onImageLoad: (path: string) => void;
  /** Confirms that a PDF actually rendered before it becomes a chat attachment. */
  onPdfLoad?: (path: string) => void;
  /** Changes when raw bytes at the same workspace path must be fetched again. */
  rawRevision?: number;
}

/**
 * How long the editor rests before the picture is recomputed.
 *
 * Short enough that it reads as following the typing, long enough that a burst of
 * keystrokes is one recomputation rather than twenty.
 */
const RENDER_DEBOUNCE_MS = 250;

/**
 * Whether there is room for two panes.
 *
 * Below this the split is two unusable halves rather than one usable pane, so the
 * mode falls back to the rendering it extends. Asked of the browser rather than
 * measured here; where `matchMedia` is absent the answer is yes, which keeps a
 * host that does not implement it from losing the mode entirely.
 */
const SPLIT_NEEDS = "(min-width: 768px)";

function useRoomForTwo(): boolean {
  const [roomy, setRoomy] = useState(() => window.matchMedia?.(SPLIT_NEEDS).matches ?? true);
  useEffect(() => {
    const query = window.matchMedia?.(SPLIT_NEEDS);
    if (query === undefined) return;
    const answer = () => setRoomy(query.matches);
    answer();
    query.addEventListener?.("change", answer);
    return () => query.removeEventListener?.("change", answer);
  }, []);
  return roomy;
}

/** A value that follows another one, but not faster than `delay`. */
function useDebounced<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/** The envelope a file was holding when it was opened, if it was holding one. */
function validOpenedDocument(content: string): ValidatedStructuredExchange | undefined {
  const verdict = readStructuredExchangeFile(content);
  return verdict.status === "valid" ? verdict.envelope : undefined;
}

/**
 * What the viewer is showing of a file that has a rendering.
 *
 * `split` is offered only for a structured-exchange document: it is the mode for
 * revising one by hand, and a Markdown file already has a preview elsewhere.
 */
type ViewMode = "rendered" | "source" | "split";

function isMarkdown(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

/** Client-side hint only — the server re-checks every write against the sandbox. */
function isWritable(path: string, writableRoot: string | null | undefined): boolean {
  if (writableRoot === undefined) return true;
  if (writableRoot === null) return false;
  return writableRoot === "" || path === writableRoot || path.startsWith(`${writableRoot}/`);
}

/** Baseline captured when Edit mode starts; saves are validated against it. */
interface EditState {
  draft: string;
  baseContent: string;
  baseMtimeMs: number;
}

/**
 * Full-size file viewer overlaying the chat pane: syntax-highlighted (or rendered
 * markdown) reading, and — inside the writable zone — a textarea edit mode whose
 * saves go through write_file with an mtime conflict guard.
 */
export function FileViewer({
  file,
  writableRoot,
  isStreaming,
  onDirtyChange,
  gitState,
  initialShowGitDiff = false,
  gitDiff,
  onFetchGitDiff,
  onClearGitDiff,
  inRepository,
  onOpenGitHistory,
  onClose,
  onReload,
  onSave,
  serverUrl = "",
  token = null,
  onImageLoad,
  onPdfLoad,
  rawRevision = 0,
}: FileViewerProps) {
  // One value rather than a flag per pane. "raw && split" means nothing, and a
  // second boolean is how a state that means nothing becomes representable.
  const [mode, setMode] = useState<ViewMode>("rendered");
  const [showGitDiff, setShowGitDiff] = useState(initialShowGitDiff);
  // A file created from the tree opens in edit mode: creating a file is wanting
  // to write in it. The viewer is remounted per path, so this only ever applies
  // to the file that was just created.
  const [edit, setEdit] = useState<EditState | null>(
    file.status === "loaded" && file.justCreated
      ? { draft: file.content, baseContent: file.content, baseMtimeMs: file.mtimeMs }
      : null,
  );
  // "done" = a reply finished while this viewer was covering the chat
  const [agentActivity, setAgentActivity] = useState<"idle" | "streaming" | "done">("idle");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Content of the last submitted save — the rebase effect below matches on it, not on
  // the live draft, so typing during the save round-trip can't wedge a false conflict
  const lastSubmitted = useRef<string | null>(null);

  const loaded = file.status === "loaded" ? file : null;
  const markdown = loaded !== null && isMarkdown(file.path);
  // Images can't travel the text-preview protocol (read_file answers "binary");
  // the viewer loads them straight from /files/raw instead and ignores that error.
  const image = isImageFile(file.path);
  // Same door for a PDF — it renders from the raw bytes, not from the preview.
  const pdf = isPdfFile(file.path);
  // A structured-exchange document is recognised by what it declares, never by its
  // name: a `.json` file is one because its `schema` field says so, and any other
  // JSON keeps the display it has always had. Reading the file is the only way to
  // know, so the verdict is computed from the content and remembered against it.
  const exchange = useMemo(
    () => (loaded === null ? undefined : readStructuredExchangeFile(loaded.content)),
    [loaded?.content],
  );
  const diagram = exchange?.status === "valid";
  /**
   * Recognised — not necessarily drawable.
   *
   * A document that declares the contract and fails it is still one of ours, and
   * the side-by-side mode is exactly where someone goes to fix it. Offering the
   * mode only for a document that already validates would shut the door on the
   * one case it is most wanted for.
   */
  const recognised = exchange?.status === "valid" || exchange?.status === "invalid";
  /**
   * A file with something to show beside its text.
   *
   * Markdown belongs here for the same reason a structured-exchange document does:
   * it has a rendering, and revising it means reading that rendering while typing.
   * It arrives with no notion of invalid — every text renders as something — so its
   * half of the split never goes stale.
   */
  const renderable = recognised || markdown;
  /** The old boolean, derived: every existing branch keeps reading one thing. */
  const showRaw = mode === "source";
  const roomForTwo = useRoomForTwo();
  // A PDF is never editable here: this viewer edits text, and there is no text.
  const writable = isWritable(file.path, writableRoot) && !pdf;
  const dirty = edit !== null && edit.draft !== edit.baseContent;
  const saving = loaded?.pendingSave !== undefined;
  // The reducer refetches on file_changed, so a foreign write shows up as a new mtime
  const changedOnDisk = edit !== null && loaded !== null && loaded.mtimeMs !== edit.baseMtimeMs;
  const conflict = loaded?.saveError?.conflict === true || changedOnDisk;

  /**
   * The text the rendering is drawn from: the buffer when one is open, the file
   * otherwise.
   *
   * One source, never two kept in step. A reader who has saved nothing has still
   * changed the model in front of them, and a picture of the file on disk would be
   * a picture of a document that no longer exists in this session.
   */
  const editedText = edit?.draft ?? loaded?.content ?? "";
  // Validation and layout are arithmetic over the whole document — cheap for a
  // small model, not free for a large one. A short debounce bounds how often that
  // runs; the previous picture stays on screen in between.
  const settledText = useDebounced(editedText, RENDER_DEBOUNCE_MS);
  const liveVerdict = useMemo(
    () => (loaded === null ? undefined : readStructuredExchangeFile(settledText)),
    [settledText, loaded === null],
  );
  /**
   * The last rendering that was good.
   *
   * Seeded from the file as opened, so a document that is invalid before anything
   * is typed shows its reason and no picture — rather than a stale one carried in
   * from somewhere else. The viewer is remounted per path, so "as opened" is this
   * file and no other.
   */
  const [lastGood, setLastGood] = useState<ValidatedStructuredExchange | undefined>(() =>
    file.status === "loaded" ? validOpenedDocument(file.content) : undefined,
  );
  useEffect(() => {
    if (liveVerdict?.status === "valid") setLastGood(liveVerdict.envelope);
  }, [liveVerdict]);
  /** The picture no longer matches the editor — it is the document as it last stood. */
  const stale = liveVerdict !== undefined && liveVerdict.status !== "valid" && lastGood !== undefined;
  /**
   * Why the editor's text is refused.
   *
   * The server's diagnosis describes the file *on disk*. The moment the buffer
   * differs from it, those reasons are about text nobody is looking at any more,
   * so they are used only while the two agree.
   */
  const liveIssues =
    liveVerdict?.status !== "invalid"
      ? undefined
      : settledText === loaded?.content && loaded.documentIssues !== undefined
        ? loaded.documentIssues
        : liveVerdict.issues;
  /**
   * The one-line reason, for the refusals that have no issue list.
   *
   * Text under revision is unparseable for most of the keystrokes that produce it,
   * and that is the state a reader most often sees the stale marker in — so it is
   * the state most in need of saying why. Found by typing in the running app: the
   * marker appeared and the reason list beside it was empty.
   */
  const liveRefusal =
    liveVerdict?.status === "not-a-document"
      ? liveVerdict.why === "unparseable"
        ? "This is not parseable JSON yet."
        : "This no longer declares a structured-exchange `schema`."
      : liveVerdict?.status === "unsupported-version"
        ? `This declares ${liveVerdict.schema}, which this version does not render.`
        : undefined;

  /**
   * The side-by-side mode, once everything that could rule it out has.
   *
   * A git diff replaces the whole body, and an unrecognised file was never offered
   * the mode; either way there is no second pane to show.
   */
  const splitting = mode === "split" && renderable && !showGitDiff && loaded !== null && roomForTwo;
  /**
   * What the fallback shows when there is no room for two panes.
   *
   * Two orderings reach it and they are not the same. Choosing the mode in a narrow
   * pane never opens an editor, so the rendering it extends is what shows. Narrowing
   * *while* editing has a buffer in hand, and the editor stays — discarding
   * somebody's unsaved text to honour a layout rule would be the worse trade by
   * far. Found by resizing the running application, where the second ordering
   * behaved differently from the test that only exercised the first.
   */

  // --- find-in-page ----------------------------------------------------------
  /**
   * What Ctrl+F searches, for the file as currently displayed.
   *
   * The split and git-diff views show two things (or a diff) at once and are
   * not offered find in this version — a file with neither text nor a PDF's
   * bytes yet (still loading, or an image) has nothing to search either.
   */
  type FindMode = "pdf" | "edit" | "dom" | "none";
  const findMode: FindMode =
    showGitDiff || splitting
      ? "none"
      : pdf
        ? "pdf"
        : edit !== null
          ? "edit"
          : loaded !== null && !image
            ? "dom"
            : "none";

  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  // Shared position pointer for dom/edit mode (pdf mode tracks its own, inside
  // PdfViewer, since only it knows which page a match lives on).
  const [findCurrent, setFindCurrent] = useState(0);
  const findInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pdfViewerRef = useRef<PdfViewerHandle>(null);
  const [pdfFindState, setPdfFindState] = useState<PdfFindState>({ matchCount: 0, currentIndex: -1, searching: false });
  const [domMatches, setDomMatches] = useState<DomMatch[]>([]);
  const [domTruncated, setDomTruncated] = useState(false);
  const domHighlightRef = useRef<ReturnType<typeof highlightMatches> | null>(null);
  // The imperative source of truth for which elements exist right now — kept
  // separate from the `domMatches` state (which exists to drive the count
  // display) because a React effect reacting to that state can run against a
  // stale, already-discarded snapshot: Strict Mode's dev-only mount → cleanup
  // → remount cycle tears the marks down and rebuilds them without an
  // intervening render, so an effect keyed on the *first* build's array
  // toggles a class on elements already unwrapped back to plain text —
  // invisible, because they are no longer attached to the document. Found by
  // driving Ctrl+F in the running app: the count updated on every "next" click
  // but the highlight never moved, because it was never landing on live DOM.
  const domMatchesRef = useRef<DomMatch[]>([]);
  /** Which match is current, alongside `domMatchesRef` and for the same reason:
   * navigation has to act on what is true now, not on what the render that
   * created the click handler happened to see. */
  const currentDomMatchRef = useRef(0);
  /** The query the marks in the DOM were built from, so a rebuild can tell
   * "the reader typed something else" (start again at the first match) from
   * "the content underneath was re-rendered" (stay where the reader was). */
  const domQueryRef = useRef("");

  /** Marks `index` current among whatever `domMatchesRef` holds *right now*,
   * scrolling it into view. Called directly at the moment marks are (re)built
   * or the current index changes — not from an effect watching a snapshot. */
  function markCurrentDomMatch(index: number) {
    currentDomMatchRef.current = index;
    for (const [i, match] of domMatchesRef.current.entries()) {
      for (const mark of match.marks) {
        if (mark.isConnected) mark.classList.toggle("find-match-current", i === index);
      }
    }
    const marks = domMatchesRef.current[index]?.marks;
    if (marks?.[0]?.isConnected) marks[0].scrollIntoView({ block: "center" });
  }

  // The query search/highlighting actually run against — "" while the bar is
  // closed, even though `findQuery` is kept so reopening restores it (rather
  // than leaving a stale highlight, or a stale PDF match, sitting on screen
  // after the bar that showed it has closed).
  const effectiveFindQuery = findOpen ? findQuery : "";
  const editMatches = useMemo(
    () => (findMode === "edit" ? findMatchesInText(editedText, effectiveFindQuery) : []),
    [findMode, editedText, effectiveFindQuery],
  );

  // A view that stops being searchable (switching to split, to a diff, or to
  // an image) closes its own find bar rather than leaving one open over
  // nothing to search.
  useEffect(() => {
    if (findOpen && findMode === "none") setFindOpen(false);
  }, [findOpen, findMode]);

  // Bumped by CodeHighlight's `onRendered` once its async syntax highlighting
  // actually lands, replacing whatever was in its `<pre>` (the plain-text
  // fallback, or a previous highlight's marks) with new DOM. That swap must
  // re-run the effect below, or a highlight applied to the fallback vanishes
  // the moment the real markup arrives. `onRendered` only means anything as
  // an "actually changed" signal because CodeHighlight is memoized (see its
  // own comment) — without that, this effect would need to reapply the
  // highlight after *any* unrelated re-render of the viewer, since React
  // resets a `dangerouslySetInnerHTML` element's real DOM on every render of
  // the component that owns it, not only when the HTML string changes.
  const [codeRenderTick, setCodeRenderTick] = useState(0);
  const bumpCodeRenderTick = useCallback(() => setCodeRenderTick((tick) => tick + 1), []);

  /**
   * Marks every occurrence in whatever is currently mounted at `contentRef` —
   * the rendered Markdown or the highlighted source, never both, since they
   * are mutually exclusive views.
   *
   * Re-applied whenever the query changes, the view mode changes, or
   * `codeRenderTick` says the mounted content was just replaced out from
   * under it. Deliberately *not* driven by a `MutationObserver` on
   * `contentRef`: this effect's own `highlightMatches`/`clear()` calls mutate
   * that same container, and no amount of disconnecting or ignore-flagging
   * around those calls proved reliable — a live run still produced a
   * self-sustaining apply → mutate → observe → apply loop that hung the tab
   * (the browser is free to split one synchronous batch of mutations across
   * more than one callback invocation, and only some of the ways of guarding
   * against that were tried before this was rewritten to not need it at
   * all). Depending on an explicit, React-owned signal instead — a counter
   * only `onRendered` increments — means this effect only ever reacts to a
   * change *it did not cause itself*, which a DOM observer watching a
   * container this same effect writes to cannot promise.
   */
  useEffect(() => {
    function clear() {
      domHighlightRef.current?.clear();
      domHighlightRef.current = null;
      domMatchesRef.current = [];
      setDomMatches([]);
      setDomTruncated(false);
      // Deliberately not resetting `currentDomMatchRef`: React runs this
      // cleanup immediately before the effect re-runs, so zeroing it here
      // would erase the reader's place on every re-mark before the body had a
      // chance to keep it. A stale index is harmless — the next apply clamps
      // it to the new match count, and a new query zeroes it explicitly.
    }
    const container = contentRef.current;
    if (findMode !== "dom" || effectiveFindQuery === "" || container === null) {
      clear();
      return;
    }

    domHighlightRef.current?.clear();
    const result = highlightMatches(container, effectiveFindQuery);
    domHighlightRef.current = result;
    domMatchesRef.current = result.matches;
    setDomMatches(result.matches);
    setDomTruncated(result.truncated);

    // A different query starts again at the first match. The *same* query
    // re-marked because the content underneath was re-rendered (syntax
    // highlighting arriving late, a view switch) must keep the reader where
    // they were: resetting here sent someone who had already stepped to match
    // 4 back to match 1 the moment highlight.js finished loading.
    const queryChanged = effectiveFindQuery !== domQueryRef.current;
    domQueryRef.current = effectiveFindQuery;
    const current = queryChanged ? 0 : Math.min(currentDomMatchRef.current, Math.max(result.matches.length - 1, 0));
    setFindCurrent(current);
    markCurrentDomMatch(current);

    return clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `mode`/`showRaw`
    // decide which element is mounted at contentRef; `codeRenderTick` is the
    // signal that its content was just replaced (see above) — everything
    // else about what changed inside it is irrelevant to this effect.
  }, [findMode, effectiveFindQuery, mode, showRaw, codeRenderTick]);

  /** Indicates the match by selection, per the edit-mode requirement — a
   * textarea's value carries no markup, so this is the only match actually
   * shown; the count above it stays accurate regardless. Focus moves to the
   * textarea just long enough for the browser to scroll the selection into
   * view, then back to the find field so Enter/Shift+Enter keep working. */
  function selectEditMatch(matches: { start: number; end: number }[], index: number) {
    const match = matches[index];
    const textarea = textareaRef.current;
    if (match === undefined || textarea === null) return;
    textarea.focus();
    textarea.setSelectionRange(match.start, match.end);
    findInputRef.current?.focus();
  }

  // Jumps to (and selects) the first match when the query changes — but not
  // on every keystroke typed into the document itself: editMatches recomputes
  // for those too, and refocusing the textarea on each one would fight typing.
  useEffect(() => {
    if (findMode !== "edit" || !findOpen) return;
    const matches = findMatchesInText(editedText, effectiveFindQuery);
    setFindCurrent(0);
    if (matches.length > 0) selectEditMatch(matches, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reruns on the
    // query (or entering edit mode with one already set), not on the buffer.
  }, [effectiveFindQuery, findMode, findOpen]);

  function openFind() {
    setFindOpen(true);
  }

  function closeFind() {
    setFindOpen(false);
  }

  function findNext() {
    if (findMode === "pdf") {
      pdfViewerRef.current?.findNext();
    } else if (findMode === "edit") {
      if (editMatches.length === 0) return;
      const next = (findCurrent + 1) % editMatches.length;
      setFindCurrent(next);
      selectEditMatch(editMatches, next);
    } else {
      // From the refs, not the render's state: a rebuild in flight (late
      // syntax highlighting) can leave the state this handler closed over
      // momentarily empty, and a click answered with nothing is a click lost.
      const total = domMatchesRef.current.length;
      if (total === 0) return;
      const next = (currentDomMatchRef.current + 1) % total;
      setFindCurrent(next);
      markCurrentDomMatch(next);
    }
  }

  function findPrevious() {
    if (findMode === "pdf") {
      pdfViewerRef.current?.findPrevious();
    } else if (findMode === "edit") {
      if (editMatches.length === 0) return;
      const next = (findCurrent - 1 + editMatches.length) % editMatches.length;
      setFindCurrent(next);
      selectEditMatch(editMatches, next);
    } else {
      const total = domMatchesRef.current.length;
      if (total === 0) return;
      const next = (currentDomMatchRef.current - 1 + total) % total;
      setFindCurrent(next);
      markCurrentDomMatch(next);
    }
  }

  const findBarState =
    findMode === "pdf"
      ? { matchCount: pdfFindState.matchCount, currentIndex: pdfFindState.currentIndex, truncated: false, searching: pdfFindState.searching }
      : findMode === "edit"
        ? {
            matchCount: editMatches.length,
            currentIndex: editMatches.length > 0 ? Math.min(findCurrent, editMatches.length - 1) : -1,
            truncated: false,
            searching: false,
          }
        : {
            matchCount: domMatches.length,
            currentIndex: domMatches.length > 0 ? Math.min(findCurrent, domMatches.length - 1) : -1,
            truncated: domTruncated,
            searching: false,
          };

  /**
   * The editor, named once.
   *
   * The same element in both places it appears: full width in edit mode, and in one
   * half of the split. A second textarea would be a second set of handlers, and the
   * save path is the thing that must not fork.
   */
  const editor =
    edit === null ? null : (
      <textarea
        ref={textareaRef}
        value={edit.draft}
        onChange={(event) => setEdit({ ...edit, draft: event.target.value })}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "s") {
            event.preventDefault();
            if (dirty && !saving && !conflict) save();
          }
        }}
        spellCheck={false}
        className="h-full w-full resize-none bg-transparent p-4 font-mono text-[13px] leading-relaxed text-zinc-800 outline-none ring-inset focus-visible:ring-1 focus-visible:ring-zinc-300 dark:text-zinc-200 dark:focus-visible:ring-zinc-700"
      />
    );

  /**
   * The Markdown rendering, named once.
   *
   * The full-width view and the split pane both call it, so the relative links and
   * image references it resolves behave the same in either — a figure referenced
   * from a report that loaded in one mode and not the other would be the exact
   * confusion this rendering exists to avoid.
   */
  function renderedMarkdown(source: string) {
    return (
            <div className="prose-chat mx-auto max-w-3xl p-4 text-zinc-700 dark:text-zinc-300">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex]}
                components={{
                  // Same routing AssistantMessage uses: a ```mermaid fence renders as a
                  // diagram here too, instead of falling through to plain <pre> text.
                  pre: MarkdownPre,
                  // Relative links point at sibling files, not server routes: open them
                  // in the viewer instead of navigating the page (which 404s)
                  a: ({ href, children, ...rest }) => {
                    if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) {
                      return (
                        <a href={href} target="_blank" rel="noreferrer" {...rest}>
                          {children}
                        </a>
                      );
                    }
                    if (href.startsWith("#")) {
                      return (
                        <a href={href} {...rest}>
                          {children}
                        </a>
                      );
                    }
                    return (
                      <a
                        href={href}
                        onClick={(event) => {
                          event.preventDefault();
                          onReload(resolveRelativeHref(file.path, href));
                        }}
                        {...rest}
                      >
                        {children}
                      </a>
                    );
                  },
                  // Relative image references resolve against this file's directory
                  // and load through /files/raw (the text protocol refuses binary)
                  img: ({ src, alt, ...rest }) => {
                    const resolved =
                      typeof src === "string" && src !== "" && !/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith("//")
                        ? rawFileUrl(serverUrl, resolveRelativeHref(file.path, src), token)
                        : src;
                    return <img {...rest} src={resolved} alt={alt ?? ""} loading="lazy" className="max-w-full rounded-lg" />;
                  },
                }}
              >
                {normalizeMathDelimiters(source)}
              </ReactMarkdown>
            </div>
    );
  }

  /**
   * Change what the viewer is showing.
   *
   * Leaving the side-by-side mode with unsaved changes is leaving the editor, and
   * asks what leaving the editor asks. Staying inside it — or entering it — keeps
   * whatever is in the buffer.
   */
  function changeMode(next: ViewMode) {
    if (mode === "split" && next !== "split" && dirty && !window.confirm("Discard unsaved changes?")) return;
    if (mode === "split" && next !== "split") setEdit(null);
    setMode(next);
  }

  function requestClose() {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    onClose();
  }

  function startEdit() {
    if (!loaded) return;
    setEdit({ draft: loaded.content, baseContent: loaded.content, baseMtimeMs: loaded.mtimeMs });
  }

  function save(overwrite = false) {
    if (!loaded || edit === null || saving) return;
    // Normal saves carry the edit baseline so the server refuses if the file moved
    // underneath us; "overwrite" (after the conflict banner) forces past that check —
    // the client may not know the fresh mtime (external writes broadcast nothing).
    lastSubmitted.current = edit.draft;
    onSave(file.path, edit.draft, edit.baseMtimeMs, overwrite);
  }

  function reload() {
    setEdit(null);
    onReload(file.path);
  }

  function toggleGitDiff() {
    const next = !showGitDiff;
    setShowGitDiff(next);
    if (next) onFetchGitDiff(file.path);
    else onClearGitDiff();
  }

  // A successful save replaces content + mtime in state: leave edit mode back to the
  // rendered view — unless the user typed during the round-trip, in which case keep
  // the live draft and just rebase the baseline on the saved state.
  useEffect(() => {
    if (
      edit !== null &&
      loaded !== null &&
      lastSubmitted.current !== null &&
      loaded.content === lastSubmitted.current &&
      loaded.mtimeMs !== edit.baseMtimeMs
    ) {
      const submitted = lastSubmitted.current;
      lastSubmitted.current = null;
      if (edit.draft === submitted) {
        setEdit(null);
      } else {
        setEdit({ ...edit, baseContent: loaded.content, baseMtimeMs: loaded.mtimeMs });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded?.mtimeMs]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        // The find bar closes first — it, not the viewer, is what an open
        // find bar's Escape means. A second, separate Escape (find bar
        // already closed) reaches this branch's `else` and closes the viewer,
        // exactly as it does without this feature.
        if (findOpen) closeFind();
        else requestClose();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        if (findMode === "none") return;
        event.preventDefault();
        openFind();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  // Choosing the side-by-side mode is choosing to revise the document: it opens the
  // editor, on a file the reader may write. Outside the writable zone it stays a
  // reading pane, which is what the requirement asks for.
  useEffect(() => {
    if (splitting && writable && edit === null && loaded !== null) {
      setEdit({ draft: loaded.content, baseContent: loaded.content, baseMtimeMs: loaded.mtimeMs });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitting, writable, loaded?.mtimeMs]);

  useEffect(() => {
    if (isStreaming) setAgentActivity("streaming");
    else setAgentActivity((current) => (current === "streaming" ? "done" : current));
  }, [isStreaming]);

  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  // Fetched diff contents are per-file: drop them when this viewer unmounts;
  // when opened straight onto the diff (badge click), fetch it now
  useEffect(() => {
    if (initialShowGitDiff) onFetchGitDiff(file.path);
    return () => onClearGitDiff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-white dark:bg-zinc-950">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        {/* Three modes rather than two, and only for a document with a rendering to
            sit beside: revising a model by hand means reading the picture and
            changing the text in one motion, which a toggle makes a round trip. */}
        {renderable && !showGitDiff && (
          <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label="How to show this document">
            {(
              [
                ["rendered", "⚏ rendered", "Show the rendering"],
                ["split", "⇹ split", "Edit the file beside its rendering"],
                ["source", "⌗ source", "Show the file as written"],
              ] as const
            ).map(([value, label, title]) => (
              <button
                key={value}
                type="button"
                onClick={() => changeMode(value)}
                aria-pressed={mode === value}
                title={title}
                className={`rounded px-1.5 py-0.5 text-xs ${
                  mode === value
                    ? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                    : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {gitState !== undefined && edit === null && (
          <button
            type="button"
            onClick={toggleGitDiff}
            aria-pressed={showGitDiff}
            title={showGitDiff ? "Show file content" : "Show uncommitted changes (vs HEAD)"}
            className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${
              showGitDiff
                ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            }`}
          >
            ± diff
          </button>
        )}
        {inRepository && edit === null && (
          <button
            type="button"
            onClick={() => onOpenGitHistory(file.path)}
            title="Show this file's history"
            className="shrink-0 rounded px-1.5 py-0.5 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            ⎇ history
          </button>
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-500 dark:text-zinc-400" title={file.path}>
          {file.path}
          {dirty && <span className="ml-1 text-amber-500">●</span>}
        </span>
        {loaded && edit === null && <CopyButton text={loaded.content} />}
        {loaded && edit === null && !showGitDiff && writable && (
          <button
            type="button"
            onClick={startEdit}
            className="shrink-0 rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-zinc-200"
          >
            ✎ edit
          </button>
        )}
        {loaded && edit === null && !writable && (
          <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-600" title="Outside the writable zone">
            🔒 read-only
          </span>
        )}
        {edit !== null && (
          <>
            <button
              type="button"
              onClick={() => save()}
              disabled={!dirty || saving || conflict}
              className="shrink-0 rounded border border-emerald-300 px-2 py-0.5 text-xs text-emerald-700 hover:border-emerald-500 disabled:opacity-50 dark:border-emerald-900 dark:text-emerald-400 dark:hover:border-emerald-600"
            >
              {saving ? "saving…" : "save"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (dirty && !window.confirm("Discard unsaved changes?")) return;
                // Cancelling in the side-by-side mode discards the draft and keeps
                // the mode: the reader asked to look at this document beside its
                // picture, and throwing away an edit is not a request to stop. A
                // plain setEdit(null) left them in "split" with a read-only pane,
                // because the effect that opens the editor watches the mode and not
                // the buffer, so it never fired again.
                setEdit(
                  splitting && loaded !== null
                    ? { draft: loaded.content, baseContent: loaded.content, baseMtimeMs: loaded.mtimeMs }
                    : null,
                );
              }}
              className="shrink-0 rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-500 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-500"
            >
              cancel
            </button>
          </>
        )}
        <button
          type="button"
          onClick={requestClose}
          title="Close (Esc)"
          aria-label="Close file viewer"
          className="shrink-0 px-1 text-sm text-zinc-400 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-300"
        >
          ✕
        </button>
      </div>

      {findOpen && findMode !== "none" && (
        <FindBar
          inputRef={findInputRef}
          query={findQuery}
          onQueryChange={setFindQuery}
          matchCount={findBarState.matchCount}
          currentIndex={findBarState.currentIndex}
          truncated={findBarState.truncated}
          searching={findBarState.searching}
          onNext={findNext}
          onPrev={findPrevious}
          onClose={closeFind}
        />
      )}

      {conflict && edit !== null && (
        <div className="flex items-center gap-3 border-b border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
          <span className="min-w-0 flex-1">File changed on disk since you started editing.</span>
          <button type="button" onClick={reload} className="shrink-0 rounded border border-amber-400 px-2 py-0.5 text-xs hover:bg-amber-100 dark:border-amber-800 dark:hover:bg-amber-950/60">
            reload (discard my edits)
          </button>
          <button type="button" onClick={() => save(true)} disabled={saving} className="shrink-0 rounded border border-amber-400 px-2 py-0.5 text-xs hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:hover:bg-amber-950/60">
            overwrite with my version
          </button>
        </div>
      )}
      {edit !== null && loaded?.saveError && !loaded.saveError.conflict && (
        <div className="border-b border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
          {loaded.saveError.message}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {showGitDiff && edit === null && (
          <div className="p-4">
            {gitDiff?.path === file.path && "error" in gitDiff && (
              <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                {gitDiff.error}
              </div>
            )}
            {gitDiff?.path === file.path && "before" in gitDiff && (
              <SplitDiffBlock fill lines={diffLines(gitDiff.before, gitDiff.after)} />
            )}
            {gitDiff?.path !== file.path && <div className="text-sm text-zinc-400 dark:text-zinc-600">loading diff…</div>}
          </div>
        )}
        {pdf && edit === null && !showGitDiff && (
          <ViewerErrorBoundary label="This PDF">
            <Suspense fallback={<div className="p-4 text-sm text-zinc-400 dark:text-zinc-600">loading…</div>}>
              <PdfViewer
                ref={pdfViewerRef}
                path={file.path}
                serverUrl={serverUrl}
                token={token}
                revision={rawRevision}
                findQuery={findMode === "pdf" ? effectiveFindQuery : ""}
                onFindStateChange={setPdfFindState}
                {...(onPdfLoad ? { onLoaded: onPdfLoad } : {})}
              />
            </Suspense>
          </ViewerErrorBoundary>
        )}
        {image && edit === null && !showGitDiff && (
          <div className="flex h-full items-center justify-center p-4">
            <img
              src={rawFileUrl(serverUrl, file.path, token, rawRevision)}
              alt={file.path}
              onLoad={() => onImageLoad(file.path)}
              className="max-h-full max-w-full rounded object-contain"
            />
          </div>
        )}
        {file.status === "loading" && edit === null && !showGitDiff && !image && !pdf && (
          <div className="p-4 text-sm text-zinc-400 dark:text-zinc-600">loading…</div>
        )}
        {file.status === "error" && !image && !pdf && (
          <div className="p-4 text-sm text-red-600 dark:text-red-400">{file.message}</div>
        )}
        {/* Keyed on `edit`, not `loaded`: the post-save file_changed refetch flips the file
            to "loading" for a moment and must not unmount the textarea (focus/caret loss) */}
        {edit !== null && !splitting && editor}
        {loaded && edit === null && !splitting && !showGitDiff && markdown && !showRaw && (
          <div ref={contentRef}>{renderedMarkdown(loaded.content)}</div>
        )}
        {splitting && (
          <div className="flex h-full min-h-0" data-testid="file-split">
            {/* Each pane scrolls on its own: a long document must not scroll the
                diagram out of view, and a wide diagram must not widen the editor.
                min-w-0 is what stops a wide child from pushing its half open. */}
            <div className="min-w-0 flex-1 overflow-auto border-r border-zinc-200 dark:border-zinc-800">
              {editor ?? (
                // Outside the writable zone there is nothing to type into, and the
                // document still deserves to be read beside its picture.
                <div className="p-4">
                  <CodeHighlight code={loaded.content} path={file.path} />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1 overflow-auto" data-testid="file-split-rendering">
              {markdown && !recognised ? (
                // Markdown has no invalid state — every text is a rendering of
                // something — so there is nothing here to mark stale or to explain.
                // The same renderer as the full-width view, on the same debounce.
                <div className="prose-chat p-4 text-zinc-700 dark:text-zinc-300">{renderedMarkdown(settledText)}</div>
              ) : (
                <>
              {stale && (
                // Said plainly and while they are looking: the picture is the
                // document as it last stood, and the text beside it has moved on.
                <p
                  data-testid="file-split-stale"
                  className="flex flex-wrap items-center gap-2 border-b border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
                >
                  <span>
                    Showing the document as it last stood.{" "}
                    {liveRefusal ?? "The text beside it does not satisfy the schema it declares."}
                  </span>
                </p>
              )}
              {liveIssues !== undefined && (
                <ul
                  data-testid="file-split-issues"
                  className="space-y-0.5 border-b border-zinc-200 px-3 py-1.5 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400"
                >
                  {liveIssues.slice(0, 6).map((issue, index) => (
                    <li key={index}>
                      <span className="font-mono opacity-70">{issue.path === "" ? "(document)" : issue.path}</span>{" "}
                      {issue.message}
                    </li>
                  ))}
                  {liveIssues.length > 6 && <li className="opacity-70">…and {liveIssues.length - 6} more</li>}
                </ul>
              )}
              {lastGood === undefined ? (
                <p className="p-4 text-sm text-zinc-400 dark:text-zinc-600" data-testid="file-split-nothing">
                  Nothing to draw yet. {liveRefusal ?? "This document does not satisfy the schema it declares."}
                </p>
              ) : (
                <ViewerErrorBoundary label="This diagram">
                  <div className="p-4" data-testid="file-structured-exchange">
                    <StructuredExchangeDocument envelope={lastGood} source={editedText} />
                  </div>
                </ViewerErrorBoundary>
              )}
                </>
              )}
            </div>
          </div>
        )}
        {loaded && edit === null && !splitting && !showGitDiff && diagram && !showRaw && exchange?.status === "valid" && (
          <ViewerErrorBoundary label="This diagram">
            <div className="mx-auto max-w-5xl p-4" data-testid="file-structured-exchange">
              <StructuredExchangeDocument envelope={exchange.envelope} source={loaded.content} />
            </div>
          </ViewerErrorBoundary>
        )}
        {loaded && edit === null && !splitting && !showGitDiff && exchange?.status === "invalid" && (
          // Named, not merely refused. A document that declares the schema and does
          // not satisfy it is the producer's mistake, and the reader is the one
          // person positioned to say so — which they cannot do from "could not be
          // displayed". The reasons come from the server's reference validator when
          // it sent any; this browser's own check is a verdict without a diagnosis,
          // and its one generic sentence is the fallback, not the intent. The file
          // stays readable as text underneath either way.
          <div
            data-testid="file-structured-exchange-invalid"
            className="mx-4 mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
          >
            <p className="font-medium">This declares a structured-exchange document and does not satisfy the schema.</p>
            <ul className="mt-1 space-y-0.5 text-xs">
              {(loaded.documentIssues ?? exchange.issues).slice(0, 8).map((issue, index) => (
                <li key={index}>
                  <span className="font-mono opacity-70">{issue.path === "" ? "(document)" : issue.path}</span> {issue.message}
                </li>
              ))}
              {(loaded.documentIssues ?? exchange.issues).length > 8 && (
                <li className="opacity-70">…and {(loaded.documentIssues ?? exchange.issues).length - 8} more</li>
              )}
            </ul>
          </div>
        )}
        {loaded && edit === null && !splitting && !showGitDiff && exchange?.status === "unsupported-version" && (
          // No rendering attempted: validating a version 2 document against the
          // version 1 schema would report failures against a contract it never
          // claimed to meet, and blame a producer who did nothing wrong.
          <div
            data-testid="file-structured-exchange-unsupported"
            className="mx-4 mt-4 rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
          >
            This document declares <span className="font-mono">{exchange.schema}</span>, which this version does not
            render. Shown as text.
          </div>
        )}
        {loaded && edit === null && !splitting && !showGitDiff && (!markdown || showRaw) && (!diagram || showRaw) && (
          <div ref={contentRef} className="p-4">
            <CodeHighlight code={loaded.content} path={file.path} onRendered={bumpCodeRenderTick} />
          </div>
        )}
      </div>

      {agentActivity !== "idle" && (
        <button
          type="button"
          onClick={requestClose}
          aria-live="polite"
          className="flex items-center gap-2 border-t border-zinc-200 px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
        >
          {agentActivity === "streaming" ? (
            <>
              <span aria-hidden className="h-2 w-2 animate-pulse motion-reduce:animate-none rounded-full bg-amber-500" />
              <span className="text-amber-700 dark:text-amber-400">π is replying…</span>
            </>
          ) : (
            <>
              <span aria-hidden className="h-2 w-2 rounded-full bg-emerald-500" />
              <span className="text-emerald-700 dark:text-emerald-400">π replied</span>
            </>
          )}
          <span className="ml-auto text-xs text-zinc-400 dark:text-zinc-500">show conversation →</span>
        </button>
      )}
    </div>
  );
}
