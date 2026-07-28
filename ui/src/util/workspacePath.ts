/**
 * Workspace-relative reference handling shared by the FileViewer (links inside
 * a viewed markdown file) and AssistantMessage (links/images in chat replies).
 */

/** Anything with a scheme or protocol-relative form is external, not a workspace path. */
export function isExternalRef(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//");
}

/**
 * Resolve a markdown-relative href against `currentPath`'s directory, into a
 * browser-root-relative path ("/x" hrefs are treated as root-relative). ".."
 * clamps at the root — the server rejects escapes anyway. Pass "" as
 * `currentPath` to resolve against the workspace root (chat messages).
 */
export function resolveRelativeHref(currentPath: string, href: string): string {
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

/** Extensions the server serves with an image content type (see /files/raw). */
export function isImageFile(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(path);
}

/**
 * URL of the server's raw-bytes endpoint for a workspace file. `<img>` cannot
 * send headers, so the auth token rides the query string (same trade-off as
 * the WebSocket URL). `serverUrl` is the embed widget's backend origin, "" when
 * same-origin.
 */
export function rawFileUrl(serverUrl: string, path: string, token: string | null): string {
  const tokenParam = token ? `&token=${encodeURIComponent(token)}` : "";
  return `${serverUrl}/files/raw?path=${encodeURIComponent(path)}${tokenParam}`;
}
