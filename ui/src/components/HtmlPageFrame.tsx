/**
 * A workspace HTML page, drawn as a browser draws it, where it cannot act as the
 * application.
 *
 * The frame is sandboxed without `allow-same-origin`: the page gets an opaque origin, so
 * its scripts — which run, a generated report needs them — reach neither this document,
 * its storage, nor the server as the user. Its relative resources are written into it
 * beforehand (`preparePage`), so it holds no URL carrying the access token. Popups may
 * escape the sandbox: an absolute link opens a normal tab, not a crippled one.
 */
import { useEffect, useRef, useState } from "react";
import { OPEN_MESSAGE, preparePage, type LoadFile } from "../util/htmlPage";
import { resolveRelativeHref } from "../util/workspacePath";

export const PAGE_SANDBOX = "allow-scripts allow-popups allow-popups-to-escape-sandbox";

export function HtmlPageFrame({ source, path, load, onOpen }: { source: string; path: string; load: LoadFile; onOpen: (path: string) => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [page, setPage] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    preparePage(source, path, load).then(
      (prepared) => {
        if (current) setPage(prepared);
      },
      () => {
        // A page that cannot be prepared is still drawn, without its relative resources.
        if (current) setPage(source);
      },
    );
    return () => {
      current = false;
    };
  }, [source, path, load]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // Only this frame's page: any other window could post the same shape.
      if (frame.current === null || event.source !== frame.current.contentWindow) return;
      const data = event.data as { type?: unknown; href?: unknown } | null;
      if (data === null || typeof data !== "object" || data.type !== OPEN_MESSAGE || typeof data.href !== "string") return;
      onOpen(resolveRelativeHref(path, data.href));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [path, onOpen]);

  if (page === null) return <div className="p-4 text-sm text-zinc-500" data-testid="html-page-loading">Loading…</div>;
  return (
    <iframe
      ref={frame}
      title={path}
      data-testid="html-page"
      sandbox={PAGE_SANDBOX}
      srcDoc={page}
      className="h-full min-h-[24rem] w-full border-0 bg-white"
    />
  );
}
