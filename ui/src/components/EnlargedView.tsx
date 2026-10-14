import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/**
 * Where an overlay is rendered.
 *
 * `position: fixed` and a z-index are only as absolute as the nearest ancestor
 * that made a stacking context, and a diagram lives deep inside the transcript.
 * The composer and the toolbar are in other branches with contexts of their own,
 * so they painted over an overlay that was nominally above them — leaving
 * controls visible and clickable through a dialog that had claimed the screen.
 * Hence a portal, out to the top of the tree.
 *
 * Which top depends on where the app is mounted. Embedded, it lives in a Shadow
 * DOM whose stylesheet is adopted by the shadow root (embed/src/mount.tsx), and
 * the document body is on the wrong side of that boundary: a node portalled
 * there gets no styling at all. Measured in the widget, the overlay came out
 * `position: static`, `z-index: auto`, transparent, and stacked *below* the
 * widget — half of it off-screen.
 *
 * Far enough out, then, but no further: the app's own root element, not the
 * shadow root above it. Inherited properties cross a shadow boundary — they are
 * not blocked, only overridden by whatever the tree declares for itself — and
 * what the app declares, it declares on that root. An overlay portalled past it
 * is a sibling, so it inherits from the *host element* instead, and a host page
 * that paints `* { color: red }` paints the widget's dialog red. Diagrams hid
 * this for a while: SVG text carries an explicit `fill` and inherits nothing. A
 * table is HTML text, and came out red on every cell.
 *
 * The root element is found by climbing rather than by id, so it is whatever the
 * app was actually mounted into. It creates no containing block, so `fixed`
 * still resolves against the viewport, and it is still above every stacking
 * context inside the app — which is what the portal was for.
 *
 * `anchor` is any element inside the app; the tree it belongs to decides.
 * Answering `undefined` for an anchor that is not mounted matters: the caller
 * remembers the last real answer rather than falling back to the document, and
 * falling back is the bug.
 */
export function overlayHost(anchor: Element | null | undefined): Element | DocumentFragment | undefined {
  if (anchor === null || anchor === undefined) return undefined;
  if (!(anchor.getRootNode() instanceof ShadowRoot)) return globalThis.document.body;
  let element: Element = anchor;
  while (element.parentElement !== null) element = element.parentElement;
  return element;
}

/**
 * Something at its own size, out of the chat column.
 *
 * Its natural size, not the window's: enlarging exists to undo a narrow column,
 * not to magnify a four-box diagram. Escape and the backdrop both close it — an
 * overlay you cannot dismiss without hunting for a control is worse than none.
 */
export function EnlargedView({
  label,
  open,
  onClose,
  children,
  actions,
  containerRef,
  anchorRef,
  testId = "structured-enlarged",
}: {
  label: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Export controls, so a diagram adjusted at full size can be taken away from here. */
  actions?: ReactNode;
  containerRef?: RefObject<HTMLDivElement | null>;
  /**
   * An element of the caller's, still mounted while the overlay is open. It is
   * read only to find which tree — document or shadow root — this app lives in.
   */
  anchorRef?: RefObject<HTMLElement | null>;
  testId?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  /**
   * The last tree the anchor was actually in.
   *
   * Resolved on every render it can be, and kept when it cannot. The anchor is a
   * node of the caller's, and a caller is free to unmount it for a render while
   * this stays open — reading `null` then would silently send the overlay back to
   * the document body, which is the whole bug, only intermittently.
   */
  const host = useRef<Element | DocumentFragment>(undefined);
  host.current = overlayHost(anchorRef?.current) ?? host.current;

  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${label}, full size`}
      data-testid={testId}
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-black/60 p-6"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-full min-w-0 w-auto max-w-[95vw] flex-col overflow-hidden rounded-lg bg-white p-4 shadow-xl dark:bg-zinc-900"
      >
        <div className="mb-2 flex shrink-0 items-center justify-between gap-4">
          <span className="text-xs text-zinc-500">{label}</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded px-2 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              ✕
            </button>
          </div>
        </div>
        <div ref={containerRef} role="region" aria-label={`${label} content`} tabIndex={0}
          className="min-h-0 min-w-0 overflow-auto [&_svg]:!max-w-none">
          {children}
        </div>
        {actions && <div className="mt-2 flex shrink-0 flex-wrap items-center justify-start gap-3">{actions}</div>}
      </div>
    </div>,
    host.current ?? globalThis.document.body,
  );
}
