import type { ExtraProps } from "react-markdown";
import { isExternalRef, isPosterFile, resolveRelativeHref } from "../util/workspacePath";

/** A local poster reference, including Markdown's encoded names and URL suffixes. */
export function isWorkspacePoster(src: unknown): src is string {
  return typeof src === "string" && src !== "" && !isExternalRef(src) && isPosterFile(src.split(/[?#]/)[0]);
}

/** Replies resolve from the workspace root; Markdown files resolve from their directory. */
export function workspacePosterPath(src: string, currentPath = ""): string {
  const path = resolveRelativeHref(currentPath, src);
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

type MarkdownNode = NonNullable<ExtraProps["node"]>;

/** A paragraph holding a poster picture renders as a block: an iframe is not valid inside a `<p>`. */
export function containsPoster(node: MarkdownNode): boolean {
  return (node.tagName === "img" && isWorkspacePoster(node.properties.src)) || node.children.some((child) => child.type === "element" && containsPoster(child));
}
