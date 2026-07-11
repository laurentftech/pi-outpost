import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { normalizeMathDelimiters } from "../markdownMath";
import type { OpenFile } from "../useAgent";
import { CodeHighlight } from "./CodeHighlight";
import { CopyButton } from "./CopyButton";

interface FileViewerProps {
  file: OpenFile;
  /** Writable zone; see SessionSnapshot.writableRoot (undefined = everything, null = nothing). */
  writableRoot?: string | null;
  /** The viewer covers the chat: surface agent activity so a running reply isn't invisible. */
  isStreaming: boolean;
  onClose: () => void;
  /** Refetch the file from disk (discards the edit baseline). */
  onReload: (path: string) => void;
  onSave: (path: string, content: string, expectedMtimeMs: number, force?: boolean) => void;
}

function isMarkdown(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

/** Client-side hint only — the server re-checks every write against the sandbox. */
function isWritable(path: string, writableRoot: string | null | undefined): boolean {
  if (writableRoot === undefined) return true;
  if (writableRoot === null) return false;
  return writableRoot === "" || path === writableRoot || path.startsWith(`${writableRoot}/`);
}

/**
 * Resolve a markdown-relative href against the open file's directory, into a
 * browser-root-relative path ("/x" hrefs are treated as root-relative). ".."
 * clamps at the root — the server rejects escapes anyway.
 */
function resolveRelativeHref(currentPath: string, href: string): string {
  const clean = href.split(/[?#]/)[0];
  const segments = clean.startsWith("/")
    ? clean.split("/")
    : [...currentPath.split("/").slice(0, -1), ...clean.split("/")];
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") out.pop();
    else out.push(segment);
  }
  return out.join("/");
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
export function FileViewer({ file, writableRoot, isStreaming, onClose, onReload, onSave }: FileViewerProps) {
  const [showRaw, setShowRaw] = useState(false);
  const [edit, setEdit] = useState<EditState | null>(null);
  // "done" = a reply finished while this viewer was covering the chat
  const [agentActivity, setAgentActivity] = useState<"idle" | "streaming" | "done">("idle");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Content of the last submitted save — the rebase effect below matches on it, not on
  // the live draft, so typing during the save round-trip can't wedge a false conflict
  const lastSubmitted = useRef<string | null>(null);

  const loaded = file.status === "loaded" ? file : null;
  const markdown = loaded !== null && isMarkdown(file.path);
  const writable = isWritable(file.path, writableRoot);
  const dirty = edit !== null && edit.draft !== edit.baseContent;
  const saving = loaded?.pendingSave !== undefined;
  // The reducer refetches on file_changed, so a foreign write shows up as a new mtime
  const changedOnDisk = edit !== null && loaded !== null && loaded.mtimeMs !== edit.baseMtimeMs;
  const conflict = loaded?.saveError?.conflict === true || changedOnDisk;

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
      if (event.key === "Escape") requestClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    if (isStreaming) setAgentActivity("streaming");
    else setAgentActivity((current) => (current === "streaming" ? "done" : current));
  }, [isStreaming]);

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-white dark:bg-zinc-950">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        {markdown && edit === null && (
          <button
            type="button"
            onClick={() => setShowRaw(!showRaw)}
            title={showRaw ? "Show rendered" : "Show source"}
            className="shrink-0 rounded px-1.5 py-0.5 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            {showRaw ? "⚏ rendered" : "⌗ source"}
          </button>
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-500 dark:text-zinc-400" title={file.path}>
          {file.path}
          {dirty && <span className="ml-1 text-amber-500">●</span>}
        </span>
        {loaded && edit === null && <CopyButton text={loaded.content} />}
        {loaded && edit === null && writable && (
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
              onClick={() => (dirty ? window.confirm("Discard unsaved changes?") && setEdit(null) : setEdit(null))}
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
          className="shrink-0 px-1 text-sm text-zinc-400 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-300"
        >
          ✕
        </button>
      </div>

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
        {file.status === "loading" && edit === null && (
          <div className="p-4 text-sm text-zinc-400 dark:text-zinc-600">loading…</div>
        )}
        {file.status === "error" && <div className="p-4 text-sm text-red-600 dark:text-red-400">{file.message}</div>}
        {/* Keyed on `edit`, not `loaded`: the post-save file_changed refetch flips the file
            to "loading" for a moment and must not unmount the textarea (focus/caret loss) */}
        {edit !== null && (
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
            className="h-full w-full resize-none bg-transparent p-4 font-mono text-[13px] leading-relaxed text-zinc-800 outline-none dark:text-zinc-200"
          />
        )}
        {loaded && edit === null && markdown && !showRaw && (
          <div className="prose-chat mx-auto max-w-3xl p-4 text-zinc-700 dark:text-zinc-300">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={{
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
              }}
            >
              {normalizeMathDelimiters(loaded.content)}
            </ReactMarkdown>
          </div>
        )}
        {loaded && edit === null && (!markdown || showRaw) && (
          <div className="p-4">
            <CodeHighlight code={loaded.content} path={file.path} />
          </div>
        )}
      </div>

      {agentActivity !== "idle" && (
        <button
          type="button"
          onClick={requestClose}
          className="flex items-center gap-2 border-t border-zinc-200 px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
        >
          {agentActivity === "streaming" ? (
            <>
              <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
              <span className="text-amber-700 dark:text-amber-400">π is replying…</span>
            </>
          ) : (
            <>
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span className="text-emerald-700 dark:text-emerald-400">π replied</span>
            </>
          )}
          <span className="ml-auto text-xs text-zinc-400 dark:text-zinc-500">show conversation →</span>
        </button>
      )}
    </div>
  );
}
