import { useRef, useState } from "react";

/**
 * The affordance that takes a document away as Word.
 *
 * The writer, KaTeX and mermaid are large and none of them is loaded until this is
 * pressed: the import is inside the handler, so a session that never exports never
 * fetches a document writer. This mirrors how the workbook export in
 * `tableExport.ts` earns its own chunk.
 *
 * Independent of the writable zone — this produces a download, not a workspace
 * write — so a read-only file offers it exactly as a writable one does.
 */
export function DocxExportButton({ text, path }: { text: string; path: string }) {
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");
  const [reason, setReason] = useState<string | null>(null);
  /**
   * A second press that belongs to the same intention is ignored.
   *
   * Two guards, because one is not enough. The in-flight flag stops a press
   * landing while a long export is still running — two of those race for
   * mermaid's global configuration. But a short document exports in a few
   * milliseconds, so the two halves of an ordinary double-click both complete and
   * the reader finds two identical files in their downloads folder. People
   * double-click buttons; the second half of one is not a second request.
   *
   * Refs rather than state: both have to be true immediately, and state does not
   * settle until the next render — which is far too late to stop the next click.
   */
  const busy = useRef(false);
  const lastStarted = useRef(0);

  /** Long enough to swallow a double-click, short enough to be invisible. */
  const SAME_INTENTION_MS = 750;

  async function exportDocx() {
    if (busy.current || Date.now() - lastStarted.current < SAME_INTENTION_MS) return;
    busy.current = true;
    lastStarted.current = Date.now();
    setState("working");
    setReason(null);
    try {
      const { downloadDocx } = await import("../export/docxExport");
      await downloadDocx(text, path);
      setState("idle");
    } catch (cause) {
      // Said out loud rather than swallowed: a download that silently does nothing
      // looks exactly like one the browser is still preparing.
      setState("failed");
      setReason(cause instanceof Error ? cause.message : String(cause));
    } finally {
      busy.current = false;
    }
  }

  return (
    <button
      type="button"
      onClick={() => void exportDocx()}
      disabled={state === "working"}
      title={state === "failed" ? `Could not export: ${reason ?? "unknown reason"}` : "Download as a Word document"}
      aria-label="Download as a Word document"
      className="shrink-0 rounded px-1.5 py-0.5 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
    >
      {state === "working" ? "… exporting" : state === "failed" ? "⚠ export failed" : "⤓ word"}
    </button>
  );
}
