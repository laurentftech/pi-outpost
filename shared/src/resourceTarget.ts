/**
 * What a reader may be taken to, from a URI a producer wrote.
 *
 * One decision, in one place, for every surface that offers to follow something a
 * producer put in a document — a Work Plan resource, a structured exchange's
 * location, an artifact link. A second copy of this rule is the failure mode worth
 * designing against: the copies drift, and the one that drifts *open* is a
 * navigation the safety policy never sanctioned.
 *
 * Two shapes are offered, and nothing else is:
 *
 * - a path inside the workspace, which the confined file surface already governs;
 * - an `http(s)` address, which leaves through the browser's own external-link path.
 *
 * Everything else — `file:`, `reqs:`, `javascript:`, a Windows absolute path, a
 * path climbing out with `..` — resolves to no target at all. That is not the same
 * as hiding it: the caller still shows the URI and lets the reader copy it. A
 * producer's link that this application cannot safely open is information the
 * reader may still need, and a scheme does not become trusted by appearing in a
 * document that validated.
 */

export type ResourceTarget =
  | { kind: "workspace-file"; path: string }
  | { kind: "external-url"; url: string };

/**
 * The workspace-relative path a URI names, or null.
 *
 * `workspace:` states the intent explicitly; a bare relative path is accepted
 * because that is what a producer writes when it means "beside this document".
 * An absolute path, a drive letter and a `..` segment are all refused here rather
 * than left for the file surface to refuse later — this function's answer is what
 * decides whether a control is drawn at all, so it has to be the conservative one.
 */
function workspaceRelativePath(uri: string): string | null {
  const candidate = uri.startsWith("workspace:")
    ? uri.slice("workspace:".length)
    : !/^[a-z][a-z0-9+.-]*:/i.test(uri)
      ? uri
      : null;
  if (candidate === null || candidate === "" || /^(?:[\\/]|[a-z]:[\\/])/i.test(candidate)) return null;
  const normalized = candidate.replaceAll("\\", "/");
  if (normalized.split("/").includes("..")) return null;
  return normalized;
}

/** Where this URI may take a reader, or undefined when nowhere safe. */
export function resourceTargetFor(uri: string): ResourceTarget | undefined {
  const path = workspaceRelativePath(uri);
  if (path !== null) return { kind: "workspace-file", path };
  if (/^https?:\/\//i.test(uri)) return { kind: "external-url", url: uri };
  return undefined;
}
