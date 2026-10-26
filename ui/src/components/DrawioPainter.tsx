/**
 * Draws a draw.io page as an SVG, for a poster's diagram frame (poster-drawio-pictures,
 * design 1): the same viewer, in the same opaque frame, that shows `.drawio` files
 * (`DrawioFrame`), mounted off screen for one page at a time and asked for its export.
 *
 * The server cannot do this: the viewer lays labels out by measuring them in a browser.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { DrawioFrame, type DrawioFrameHandle } from "./DrawioFrame";

export interface DrawioPainterHandle {
  /** `xml`, a draw.io file of one page, as a standalone SVG document. Rejects with the viewer's reason. */
  draw(xml: string): Promise<string>;
}

/** How long one page may take to draw before it is called lost: the viewer is 4.5 MB to load the first time. */
const DRAW_TIMEOUT_MS = 30_000;

interface Waiting {
  id: number;
  resolve: (svg: string) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export const DrawioPainter = forwardRef<DrawioPainterHandle, { serverUrl: string }>(function DrawioPainter({ serverUrl }, ref) {
  const [job, setJob] = useState<{ id: number; xml: string } | null>(null);
  const waiting = useRef<Waiting | null>(null);
  // One page at a time: the frame shows one diagram, and its export is of the page it shows.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const frame = useRef<DrawioFrameHandle>(null);
  const next = useRef(0);

  function finish(id: number, outcome: string | Error) {
    const current = waiting.current;
    if (current === null || current.id !== id) return;
    clearTimeout(current.timer);
    waiting.current = null;
    setJob(null);
    if (outcome instanceof Error) current.reject(outcome);
    else current.resolve(outcome);
  }

  useImperativeHandle(ref, () => ({
    draw(xml: string) {
      const run = () =>
        new Promise<string>((resolve, reject) => {
          const id = ++next.current;
          const timer = setTimeout(() => finish(id, new Error("the draw.io viewer did not answer")), DRAW_TIMEOUT_MS);
          waiting.current = { id, resolve, reject, timer };
          setJob({ id, xml });
        });
      const drawn = queue.current.then(run, run);
      queue.current = drawn.catch(() => undefined);
      return drawn;
    },
  }), []);

  // Gone with the poster: a page still drawing is answered, never left waiting.
  useEffect(
    () => () => {
      const current = waiting.current;
      if (current === null) return;
      clearTimeout(current.timer);
      waiting.current = null;
      current.reject(new Error("the poster was closed"));
    },
    [],
  );

  if (job === null) return null;
  const { id } = job;
  return (
    // Off screen, not hidden: the viewer measures its labels, which needs a laid-out box.
    <div aria-hidden="true" data-testid="drawio-painter" style={{ position: "fixed", left: -20000, top: 0, width: 1200, height: 900, pointerEvents: "none" }}>
      <DrawioFrame
        key={id}
        ref={frame}
        xml={job.xml}
        serverUrl={serverUrl}
        title="draw.io diagram for a poster"
        className="flex h-full flex-col"
        onRendered={(failure) => {
          if (failure !== null) return finish(id, new Error(failure));
          frame.current?.exportSvg().then(
            ({ svg }) => finish(id, svg),
            (error: unknown) => finish(id, error instanceof Error ? error : new Error(String(error))),
          );
        }}
      />
    </div>
  );
});
