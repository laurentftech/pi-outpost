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
 * A PDF the viewer renders itself, from the bytes of /files/raw — the text
 * preview protocol answers "binary" for it, as it does for an image.
 */
export function isPdfFile(path: string): boolean {
  return /\.pdf$/i.test(path);
}

/**
 * Workspace formats backed by the always-available path extraction tools.
 *
 * The mail formats are here for the same reason the Office ones are — a tool reads
 * them at a path — and the consequence matters most for `.eml`, which is *text*. A
 * dropped `.eml` under the inline limit would otherwise take the inline-text branch
 * and carry MIME headers, boundary markers and the base64 of every attachment into
 * the prompt in place of the message.
 */
export function hasPathExtractionTool(path: string): boolean {
  return /\.(docx|xlsx|pptx|msg|eml|emlx)$/i.test(path);
}

/**
 * URL of the server's raw-bytes endpoint for a workspace file. `<img>` cannot
 * send headers, so the auth token rides the query string (same trade-off as
 * the WebSocket URL). `serverUrl` is the embed widget's backend origin, "" when
 * same-origin.
 *
 * `workspace` is the id of the project the connection is bound to (the snapshot's
 * `workspace.id`). The path is relative to *that* project's root; a server holding
 * several projects reads it from the one it booted with when it is left out.
 */
export function rawFileUrl(
  serverUrl: string,
  path: string,
  token: string | null,
  revision?: number,
  workspace?: string,
): string {
  const tokenParam = token ? `&token=${encodeURIComponent(token)}` : "";
  const revisionParam = revision === undefined ? "" : `&v=${encodeURIComponent(String(revision))}`;
  const workspaceParam = workspace === undefined ? "" : `&workspace=${encodeURIComponent(workspace)}`;
  return `${serverUrl}/files/raw?path=${encodeURIComponent(path)}${tokenParam}${revisionParam}${workspaceParam}`;
}

/** The id `/files/raw` takes for a project: its `id`, or its `root` from a server that predates ids. */
export function rawFileWorkspace(workspace: { root: string; id?: string } | null | undefined): string | undefined {
  return workspace ? (workspace.id ?? workspace.root) : undefined;
}
