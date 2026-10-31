/**
 * A `.drawio` diagram with the controls every diagram here has.
 *
 * Drawn in two places: in a reply that references the file as a picture, and in the file
 * viewer's rendered mode. Both get the controls Mermaid and the structured-exchange view
 * have, in the same place and look (`diagramControls`): enlarge, download SVG, and here
 * also the `.drawio` file itself. A reply's block reads the file on its own and follows
 * it; the viewer's is handed the text it already holds.
 *
 * Touch-up — moving boxes, re-attaching wires, fixing labels — is offered in the file
 * viewer and at full size, not in a reply's small block, where a wire's end is too small
 * to aim at. It saves the page shown back into the file it started from, through the
 * server's modification-time guard: a file that moved meanwhile is refused, not
 * overwritten. Anything beyond a touch-up is draw.io desktop's.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { DrawioFrame, type DrawioFrameHandle, type DrawioTouchUpState, type DrawioWireStyle } from "./DrawioFrame";
import { DIAGRAM_ACTION, DIAGRAM_ACTIONS } from "./diagramControls";
import { EnlargedView } from "./EnlargedView";
import { useDrawioFiles } from "./drawioFiles";
import { FileIoError } from "../fileIo";
import { spliceDrawioPage } from "../util/drawioSplice";
import { drawioPageIndex } from "../util/drawioPages";

type Where = "inline" | "enlarged";

const CLEAN: DrawioTouchUpState = { dirty: false, canUndo: false, canRedo: false };
const DISCARD = "Discard the unsaved touch-ups to this diagram?";

/** The file's name without its folder or extension, for downloads. */
function baseName(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.replace(/\.(drawio|dio)$/i, "") || "diagram";
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The SVG's file name: the diagram's, then the page's when it has one. */
export function svgFileName(path: string, pageName: string | null): string {
  const page = pageName?.trim().replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "");
  return `${baseName(path)}${page ? `-${page}` : ""}.svg`;
}

/** A reply's diagram reads its file itself, once near the screen, and again when it changes. */
function useFileText(path: string, enabled: boolean, visible: boolean) {
  const { fileIo } = useDrawioFiles();
  const [file, setFile] = useState<{ status: "loading" } | { status: "loaded"; content: string } | { status: "failed"; message: string }>({ status: "loading" });
  const generation = useRef(0);

  const read = useCallback(() => {
    if (!enabled) return;
    if (fileIo === undefined) {
      setFile({ status: "failed", message: "files cannot be read here" });
      return;
    }
    const mine = ++generation.current;
    fileIo.read(path).then(
      ({ content }) => { if (mine === generation.current) setFile({ status: "loaded", content }); },
      (error: unknown) => { if (mine === generation.current) setFile({ status: "failed", message: error instanceof Error ? error.message : String(error) }); },
    );
  }, [enabled, fileIo, path]);

  useEffect(() => {
    if (!visible) return;
    read();
  }, [read, visible]);

  useEffect(() => {
    if (!enabled || !visible || fileIo === undefined) return;
    return fileIo.onChanged(path, read);
  }, [enabled, visible, fileIo, path, read]);

  return file;
}

/** Whether `ref` is on screen or near it, once it has been: a frame parses 4.3 MB of viewer. */
function useNearViewport(ref: RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [near, setNear] = useState(!enabled || typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (near || ref.current === null) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setNear(true);
    }, { rootMargin: "600px 0px" });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [near, ref]);
  return near;
}

export function DrawioBlock({
  path,
  xml,
  variant,
  fallback,
  onTouchUpDirtyChange,
  page,
  startTouchUp = false,
  onEscape: leaveOnEscape,
}: {
  /** Workspace-relative. */
  path: string;
  /** The text, when the holder has it (the file viewer); a reply's block reads the file. */
  xml?: string;
  variant: "reply" | "viewer";
  /** Shown under the failure when the viewer cannot draw the text: its source, in the file viewer. */
  fallback?: ReactNode;
  /** Unsaved touch-ups exist, so the holder can ask before leaving them. */
  onTouchUpDirtyChange?: (dirty: boolean) => void;
  /** The page shown first: its name, or its number from 1 (a poster's diagram frame names one). */
  page?: string;
  /** Begins touch-up as soon as the file is read, as when a poster's diagram is opened to touch it up. */
  startTouchUp?: boolean;
  /** Escape, wherever the keyboard is, means leaving the holder rather than ending the touch-up (a poster's diagram, opened over it). */
  onEscape?: () => void;
}) {
  const { serverUrl, fileIo, onOpenFile } = useDrawioFiles();
  const blockRef = useRef<HTMLDivElement>(null);
  const near = useNearViewport(blockRef, variant === "reply");
  const read = useFileText(path, xml === undefined, near);
  const text = xml ?? (read.status === "loaded" ? read.content : null);

  const inline = useRef<DrawioFrameHandle>(null);
  const enlargedFrame = useRef<DrawioFrameHandle>(null);
  const [enlarged, setEnlarged] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Touch-up: where it happens, the file it started from, and what the frame reports
  const [touching, setTouching] = useState<Where | null>(null);
  const baseline = useRef<{ content: string; mtimeMs: number } | null>(null);
  const [state, setState] = useState<DrawioTouchUpState>(CLEAN);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [problem, setProblem] = useState<{ message: string; conflict: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const frameOf = (where: Where) => (where === "inline" ? inline : enlargedFrame);
  // A touch-up works on the file as it was read when it began, whatever the holder shows
  const textFor = (where: Where) => (touching === where && baseline.current !== null ? baseline.current.content : text);
  const canTouchUp = fileIo !== undefined;
  const dirty = touching !== null && state.dirty;
  // The page asked for, as the viewer counts it; or why the file has no such page
  const start = useMemo(() => {
    if (page === undefined || text === null) return { index: 0, problem: null };
    try {
      return { index: drawioPageIndex(text, page), problem: null };
    } catch (error) {
      return { index: 0, problem: error instanceof Error ? error.message : String(error) };
    }
  }, [page, text]);
  const started = useRef(false);
  useEffect(() => {
    if (!startTouchUp || started.current || text === null || start.problem !== null) return;
    started.current = true;
    void beginTouchUp("inline");
  });
  // The file saved from elsewhere (draw.io desktop, the agent) during a touch-up holding nothing
  // unsaved: the touch-up starts again on it, drawn, rather than on a version that is gone. With
  // touch-ups unsaved it waits, and their save is refused (DrawioTouchUpSaving).
  const restartOn = useRef<Where | null>(null);
  useEffect(() => {
    if (touching === null || state.dirty || baseline.current === null || text === null || text === baseline.current.content) return;
    restartOn.current = touching;
    baseline.current = null;
    setState(CLEAN);
    setTouching(null);
  }, [text, touching, state.dirty]);
  useEffect(() => {
    if (touching !== null || restartOn.current === null) return;
    const where = restartOn.current;
    restartOn.current = null;
    void beginTouchUp(where);
  });

  useEffect(() => {
    onTouchUpDirtyChange?.(dirty);
  }, [dirty, onTouchUpDirtyChange]);
  useEffect(() => () => onTouchUpDirtyChange?.(false), [onTouchUpDirtyChange]);

  async function beginTouchUp(where: Where) {
    if (fileIo === undefined || touching !== null) return;
    setProblem(null);
    setNotice(null);
    try {
      // The file as it is on disk now, with the time the save will be checked against
      baseline.current = await fileIo.read(path);
      setState(CLEAN);
      setTouching(where);
    } catch (error) {
      setProblem({ message: error instanceof Error ? error.message : String(error), conflict: false });
    }
  }

  function endTouchUp(): boolean {
    if (dirty && !window.confirm(DISCARD)) return false;
    setTouching(null);
    setState(CLEAN);
    setProblem(null);
    setNotice(null);
    baseline.current = null;
    return true;
  }

  async function save() {
    const where = touching;
    const start = baseline.current;
    if (where === null || start === null || fileIo === undefined || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setProblem(null);
    try {
      const page = await frameOf(where).current!.save();
      const content = spliceDrawioPage(start.content, page.page, page.xml);
      const { mtimeMs } = await fileIo.write(path, content, start.mtimeMs);
      baseline.current = { content, mtimeMs };
      frameOf(where).current?.markClean();
    } catch (error) {
      const conflict = error instanceof FileIoError && error.reason === "conflict";
      setProblem({
        message: conflict
          ? "The file changed on disk, or was removed, since this touch-up began, so it was not saved. Leave without saving to see what is there now."
          : `Could not save: ${error instanceof Error ? error.message : String(error)}`,
        conflict,
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function downloadSvg(where: Where) {
    setDownloadError(null);
    try {
      const svg = await frameOf(where).current!.exportSvg();
      download(svgFileName(path, svg.name), svg.svg, "image/svg+xml;charset=utf-8");
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : String(error));
    }
  }

  function closeEnlarged() {
    if (touching === "enlarged" && !endTouchUp()) return;
    setEnlarged(false);
  }

  const onPageLocked = useCallback(() => setNotice("Save or undo the touch-ups on this page before turning to another."), []);

  // Escape while touching up means "done", wherever the keyboard is: in the frame (it
  // says so) or on these controls. Caught before the full-size view or the file viewer
  // take it as "close", which would be leaving more than the touch-up.
  const endTouchUpRef = useRef(endTouchUp);
  endTouchUpRef.current = endTouchUp;
  // From the frame: "done" while touching up, else what Escape means around it — closing
  // the full-size view
  const closeEnlargedRef = useRef(closeEnlarged);
  closeEnlargedRef.current = closeEnlarged;
  const touchingRef = useRef(touching);
  touchingRef.current = touching;
  const enlargedRef = useRef(enlarged);
  enlargedRef.current = enlarged;
  const leaveRef = useRef(leaveOnEscape);
  leaveRef.current = leaveOnEscape;
  const onEscape = useCallback(() => {
    if (leaveRef.current) leaveRef.current();
    else if (touchingRef.current !== null) endTouchUpRef.current();
    else if (enlargedRef.current) closeEnlargedRef.current();
  }, []);
  useEffect(() => {
    if (touching === null) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (leaveRef.current) leaveRef.current();
      else endTouchUpRef.current();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [touching]);

  function downloads(where: Where) {
    return (
      <>
        <button type="button" className={DIAGRAM_ACTION} disabled={text === null || failure !== null} onClick={() => void downloadSvg(where)}
          title="Save the page shown as .svg — insert it as a picture in a document">
          ⤓ download SVG
        </button>
        <button type="button" className={DIAGRAM_ACTION} disabled={text === null} onClick={() => text !== null && download(path.slice(path.lastIndexOf("/") + 1), text, "application/xml;charset=utf-8")}
          title="Save the .drawio file, to open or share it">
          ⤓ download .drawio
        </button>
      </>
    );
  }

  function touchUpControls(where: Where) {
    if (touching !== where) {
      return canTouchUp && touching === null && failure === null ? (
        <button type="button" className={DIAGRAM_ACTION} disabled={text === null} onClick={() => void beginTouchUp(where)}
          title="Move boxes, re-attach wires and fix labels here; anything more in draw.io">
          ✎ touch up
        </button>
      ) : null;
    }
    return (
      <>
        <button type="button" className={DIAGRAM_ACTION} disabled={!state.dirty || saving} onClick={() => void save()}>
          {saving ? "saving…" : "✓ save"}
        </button>
        <button type="button" className={DIAGRAM_ACTION} disabled={!state.canUndo} onClick={() => frameOf(where).current?.undo()} title="Undo (⌘Z / Ctrl+Z)">
          ↶ undo
        </button>
        <button type="button" className={DIAGRAM_ACTION} disabled={!state.canRedo} onClick={() => frameOf(where).current?.redo()} title="Redo (⇧⌘Z / Ctrl+Y)">
          ↷ redo
        </button>
        <label className="inline-flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400" title="How the selected wires are drawn — or every wire of the page when none is selected — and new wires too">
          wires
          <select
            className={DIAGRAM_ACTION}
            aria-label="Wire style"
            value={state.wireStyle ?? "orthogonal"}
            onChange={(event) => {
              const style = event.target.value as DrawioWireStyle | "mixed";
              if (style !== "mixed") frameOf(where).current?.setWireStyle(style);
            }}
          >
            <option value="straight">straight</option>
            <option value="orthogonal">orthogonal</option>
            <option value="curved">curved</option>
            {state.wireStyle === "mixed" && <option value="mixed" disabled>mixed</option>}
          </select>
        </label>
        <button
          type="button"
          className={DIAGRAM_ACTION}
          disabled={!state.bends}
          onClick={() => frameOf(where).current?.removeBends()}
          title="Remove the bends of the selected wires — or of every wire of the page when none is selected — and let draw.io route them. Double-click a bend to remove just that one."
        >
          remove bends
        </button>
        <button type="button" className={DIAGRAM_ACTION} onClick={() => endTouchUp()} title="Leave touch-up (Escape); unsaved touch-ups are asked about first">
          done
        </button>
        <span className="text-xs text-zinc-400" data-testid="drawio-touchup-status">
          {state.dirty ? "● unsaved" : "touching up — drag boxes and wire ends, double-click a label"}
        </span>
      </>
    );
  }

  function messages(where: Where) {
    return (
      <>
        {touching === where && problem && (
          <span role="alert" data-testid="drawio-touchup-problem" className="text-red-600 dark:text-red-400">{problem.message}</span>
        )}
        {touching === where && notice && <span role="status" className="text-amber-700 dark:text-amber-300">{notice}</span>}
        {touching === null && problem && <span role="alert" className="text-red-600 dark:text-red-400">Could not start touch-up: {problem.message}</span>}
        {downloadError && <span role="alert" className="text-red-600 dark:text-red-400">Could not download SVG: {downloadError}</span>}
      </>
    );
  }

  if (variant === "reply" && read.status === "failed") {
    return (
      <div ref={blockRef} role="alert" data-testid="drawio-block-missing" className="my-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
        The diagram <code>{path}</code> could not be shown: {read.message}
      </div>
    );
  }

  const frameFallback = fallback ?? <p className="px-3 py-2 text-xs text-zinc-500">The diagram <code>{path}</code> could not be drawn.</p>;
  const controls = (
    <div className={`${DIAGRAM_ACTIONS} ${variant === "reply" ? "order-3" : "shrink-0 px-3 py-1.5"}`}>
      {touching !== "inline" && (
        <button type="button" className={DIAGRAM_ACTION} disabled={text === null || touching !== null} onClick={() => setEnlarged(true)} aria-label="Show diagram at full size">
          ⤢ enlarge
        </button>
      )}
      {touching !== "inline" && downloads("inline")}
      {variant === "reply" && onOpenFile && (
        <button type="button" className={DIAGRAM_ACTION} onClick={() => onOpenFile(path)} title="Open the file in the file viewer">
          ↗ open
        </button>
      )}
      {variant === "viewer" && touchUpControls("inline")}
      {messages("inline")}
    </div>
  );

  return (
    <div
      ref={blockRef}
      data-testid={variant === "reply" ? "drawio-block-reply" : "drawio-block-viewer"}
      className={variant === "reply"
        ? "my-2 flex flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900"
        : "flex h-full flex-col"}
    >
      {variant === "viewer" && controls}
      {start.problem !== null && (
        <p role="alert" data-testid="drawio-block-page-problem" className="px-3 py-1.5 text-xs text-amber-800 dark:text-amber-200">
          The diagram <code>{path}</code> {start.problem}; its first page is shown.
        </p>
      )}
      {text === null || !near ? (
        <div className="h-80 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800/60" data-testid="drawio-block-loading" aria-label={`Loading ${path}`} />
      ) : (
        <DrawioFrame
          ref={inline}
          xml={textFor("inline")!}
          serverUrl={serverUrl}
          title={path}
          fallback={frameFallback}
          editing={touching === "inline"}
          onTouchUpChange={setState}
          onPageLocked={onPageLocked}
          onEscape={onEscape}
          onRendered={setFailure}
          className={variant === "reply" ? "flex h-80 flex-col" : "flex min-h-[24rem] flex-1 flex-col"}
          page={page === undefined ? undefined : start.index}
        />
      )}
      {variant === "reply" && controls}
      <EnlargedView
        label={path}
        testId="drawio-enlarged"
        open={enlarged}
        onClose={closeEnlarged}
        anchorRef={blockRef}
        actions={<>{downloads("enlarged")}{touchUpControls("enlarged")}{messages("enlarged")}</>}
      >
        {text !== null && (
          <div style={{ width: "90vw", height: "75vh" }}>
            <DrawioFrame
              ref={enlargedFrame}
              xml={textFor("enlarged")!}
              serverUrl={serverUrl}
              title={`${path}, full size`}
              fallback={frameFallback}
              editing={touching === "enlarged"}
              onTouchUpChange={setState}
              onPageLocked={onPageLocked}
              onEscape={onEscape}
              className="flex h-full flex-col"
            />
          </div>
        )}
      </EnlargedView>
    </div>
  );
}
