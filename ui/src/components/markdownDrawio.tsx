import type { ComponentProps } from "react";
import type { ExtraProps } from "react-markdown";
import { isDrawioFile, isExternalRef, resolveRelativeHref } from "../util/workspacePath";

/** A local diagram reference, including Markdown's encoded names and URL suffixes. */
export function isWorkspaceDrawio(src: unknown): src is string {
  return typeof src === "string" && src !== "" && !isExternalRef(src) && isDrawioFile(src.split(/[?#]/)[0]);
}

/** Replies resolve from the workspace root; Markdown files resolve from their directory. */
export function workspaceDrawioPath(src: string, currentPath = ""): string {
  const path = resolveRelativeHref(currentPath, src);
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

type MarkdownNode = NonNullable<ExtraProps["node"]>;

function containsDiagram(node: MarkdownNode): boolean {
  return (node.tagName === "img" && isWorkspaceDrawio(node.properties.src))
    || node.children.some((child) => child.type === "element" && containsDiagram(child));
}

/** Diagram controls are blocks, including when the Markdown mixes them with prose or a link. */
export function DrawioMarkdownParagraph({ node, children, ...rest }: ComponentProps<"p"> & ExtraProps) {
  return node && containsDiagram(node)
    ? <div {...rest}>{children}</div>
    : <p {...rest}>{children}</p>;
}
