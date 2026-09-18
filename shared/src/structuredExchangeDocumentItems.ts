/**
 * What a document holds, read the way the checks that judge it need: every item with the
 * kind and attributes it will have, and every relationship with its two ends.
 *
 * Shared by the profile check, which judges a relationship's ends by their kinds, and by
 * rule evaluation, which judges them by their attributes. One reading, so a proposal that
 * changes an item's kind is the same item to both, and a batch line's subjects are the
 * same subjects.
 */
import { readTableRow, type StructuredTableRow } from "./structuredExchange.ts";

export interface DocumentItem {
  id?: string;
  kind?: string;
  attributes: Record<string, unknown>;
  path: string;
}

export interface DocumentRelationship {
  kind?: string;
  from: { id?: string; ref?: string };
  to: { id?: string; ref?: string };
  ref?: string;
  path: string;
}

/**
 * The attributes an item will have. A proposal's `set` changes them and its
 * `removeAttributes` takes some away; a rule is about the result, not about the value
 * being replaced.
 */
function effective(raw: Record<string, unknown>, path: string): DocumentItem {
  const set = (raw.set ?? undefined) as Record<string, unknown> | undefined;
  const attributes: Record<string, unknown> = { ...((raw.attributes ?? {}) as Record<string, unknown>) };
  Object.assign(attributes, (set?.attributes ?? {}) as Record<string, unknown>);
  for (const name of (set?.removeAttributes ?? []) as string[]) delete attributes[name];
  const kind = typeof set?.kind === "string" ? set.kind : typeof raw.kind === "string" ? raw.kind : undefined;
  return { ...(typeof raw.id === "string" ? { id: raw.id } : {}), ...(kind === undefined ? {} : { kind }), attributes, path };
}

export function itemsAndRelationships(envelope: unknown): { items: DocumentItem[]; relationships: DocumentRelationship[] } {
  const document = envelope as { kind?: unknown; data?: Record<string, unknown> };
  const data = document.data ?? {};
  const items: DocumentItem[] = [];
  const relationships: DocumentRelationship[] = [];
  if (document.kind === "graph") {
    ((data.nodes ?? []) as Record<string, unknown>[]).forEach((node, index) => items.push(effective(node, `/data/nodes/${index}`)));
    ((data.edges ?? []) as Record<string, unknown>[]).forEach((edge, index) => {
      const set = (edge.set ?? undefined) as Record<string, unknown> | undefined;
      const kind = typeof set?.kind === "string" ? set.kind : (edge.kind as string | undefined);
      relationships.push({
        ...(kind === undefined ? {} : { kind }),
        from: { id: String(edge.from) },
        to: { id: String(edge.to) },
        ...(typeof edge.ref === "string" ? { ref: edge.ref } : {}),
        path: `/data/edges/${index}`,
      });
    });
  } else if (document.kind === "table") {
    ((data.rows ?? []) as StructuredTableRow[]).forEach((row, index) => {
      if (readTableRow(row).heading !== undefined || Array.isArray(row)) return;
      items.push(effective(row as unknown as Record<string, unknown>, `/data/rows/${index}`));
    });
    ((data.relations ?? []) as Record<string, unknown>[]).forEach((relation, index) => {
      relationships.push({
        kind: relation.kind as string,
        from: relation.from as { id?: string; ref?: string },
        to: relation.to as { id?: string; ref?: string },
        ...(typeof relation.ref === "string" ? { ref: relation.ref } : {}),
        path: `/data/relations/${index}`,
      });
    });
  }
  return { items, relationships };
}

/** How an end is named to a reader: its local identifier, else its reference. */
export const endName = (end: { id?: string; ref?: string }): string => end.id ?? end.ref ?? "?";

/**
 * A document's items and relationships, with what to look an end up by and who the
 * document is about. `subjects` absent: every item is a subject.
 */
export function readDocument(envelope: unknown, subjects?: ReadonlySet<string>) {
  const { items, relationships } = itemsAndRelationships(envelope);
  const byId = new Map(items.filter((item) => item.id !== undefined).map((item) => [item.id as string, item]));
  const isSubject = (item: DocumentItem): boolean => (subjects === undefined ? true : item.id !== undefined && subjects.has(item.id));
  /** An end's item in this document, or undefined when the end is a reference to something it does not carry. */
  const endItem = (end: { id?: string; ref?: string }): DocumentItem | undefined => (end.id === undefined ? undefined : byId.get(end.id));
  /** Whether a relationship concerns the document's subjects: one of its ends at least is one. */
  const concernsSubjects = (relationship: DocumentRelationship): boolean => {
    const from = endItem(relationship.from);
    const to = endItem(relationship.to);
    return (from !== undefined && isSubject(from)) || (to !== undefined && isSubject(to));
  };
  return { items, relationships, byId, isSubject, endItem, concernsSubjects };
}
