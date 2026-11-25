/**
 * A `.poster.html` file referenced from a reply, shown in place: read-only, in a frame of its own.
 *
 * Unlike the file viewer's PosterFrame (the full editor, with its save flow), a reply needs only
 * the page: the file is fetched once through `/files/raw`, read as a poster page, and rendered in
 * a sandboxed iframe's `srcDoc` — no scripts (a poster holds none, `checkPoster` refuses them) and
 * an opaque origin, so the page cannot reach the host page. The frame is the paper format's size in
 * CSS pixels, scaled down to fit the reply, as pictures are capped at `max-h-96`.
 *
 * A file that cannot be read or parsed is not left as a broken picture: it offers to open the
 * poster in the file viewer instead.
 */
import { useEffect, useRef, useState } from "react";
import { FORMATS, pageOf, readPage, type PosterPage } from "@pi-outpost/posters/format";
import { rawFileUrl } from "../util/workspacePath";

/** Pictures in a reply are capped at max-h-96; a poster block is capped the same. */
const MAX_HEIGHT = 384;

type State = { status: "loading" } | { status: "loaded"; page: PosterPage } | { status: "failed" };

export function PosterBlock({
  path,
  serverUrl,
  token,
  workspace,
  onOpenFile,
}: {
  path: string;
  serverUrl: string;
  token: string | null;
  workspace?: string;
  onOpenFile?: (path: string) => void;
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let alive = true;
    setState({ status: "loading" });
    fetch(rawFileUrl(serverUrl, path, token, undefined, workspace))
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then((text) => {
        if (alive) setState({ status: "loaded", page: readPage(text) });
      })
      .catch(() => {
        if (alive) setState({ status: "failed" });
      });
    return () => {
      alive = false;
    };
  }, [path, serverUrl, token, workspace]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const page = state.status === "loaded" ? state.page : undefined;
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !page) return;
    const { width, height } = FORMATS[page.format];
    const update = () => setScale(Math.min(1, el.clientWidth / width, MAX_HEIGHT / height));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [page]);

  if (state.status === "failed") {
    return (
      <span data-testid="poster-block-failed">
        The poster could not be shown here (
        <a
          href="#"
          onClick={(event) => {
            event.preventDefault();
            onOpenFile?.(path);
          }}
        >
          open {path} in the viewer
        </a>
        ).
      </span>
    );
  }

  if (!page) return <div data-testid="poster-block-loading" className="my-2 h-24 animate-pulse rounded-lg border border-zinc-200 dark:border-zinc-800" />;

  const { width, height } = FORMATS[page.format];
  return (
    <div
      ref={wrapRef}
      data-testid="poster-block-reply"
      data-poster-path={path}
      className="my-2 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800"
      style={{ height: Math.round(height * scale) }}
    >
      <iframe
        title={page.title}
        sandbox=""
        srcDoc={pageOf(page.title, { html: page.html, css: page.css, format: page.format })}
        width={width}
        height={height}
        style={{ border: 0, transform: `scale(${scale})`, transformOrigin: "top left" }}
      />
    </div>
  );
}
