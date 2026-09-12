/**
 * What a validated envelope means for the reader, and where things go on screen.
 *
 * All pure: the components render what these functions decide, so the decisions can
 * be tested without mounting anything. That matters more than usual here — a
 * proposal's rendering is an approval gate, and "what did the reader actually see"
 * has to be answerable.
 *
 * It lives in `shared` rather than beside the components because the same decisions
 * have to be reachable from a process with no browser: a figure produced for the
 * agent must be the picture the reader sees, and the only way to guarantee that is
 * for both to run this code. Nothing here touches a DOM, a stylesheet or a
 * measurement — `dagre` computes positions and runs under Node unchanged.
 *
 * Validation is deliberately absent. Checking a document against its schema needs an
 * implementation the environment chooses, so it stays with the caller.
 */
import dagre from "@dagrejs/dagre";
import {
  readTableRow,
  type StructuredArtifact,
  type StructuredAttributeValue,
  type StructuredContainer,
  type StructuredElement,
  type StructuredEdge,
  type StructuredGraphData,
  type StructuredLocation,
  type StructuredMessage,
  type StructuredSequenceData,
  type StructuredTableCell,
  type StructuredTableData,
  type StructuredTableRowRole,
  type ValidatedStructuredExchange,
} from "./structuredExchange.ts";
import {
  boxHeight,
  boxWidth,
  boxWidthWithChanges,
  changeLines,
  changeText,
  wrapLabel,
} from "./structuredExchangeText.ts";

/**
 * How each part of a proposal should read.
 *
 * - `added` — no reference, so the authority does not hold it yet.
 * - `changed` — a reference *and* something declared beside it.
 * - `context` — a reference and nothing else. Declares no change; it is named so
 *   a relationship can attach to it, and showing it as modified would make every
 *   proposal that adds a relationship look like it rewrites what it touches.
 * - `unchanged` — not a proposal at all; the envelope describes a new artifact.
 */
export type ChangeRole = "added" | "changed" | "context" | "unchanged";

export function elementRole(element: StructuredElement, isProposal: boolean): ChangeRole {
  if (!isProposal) return "unchanged";
  if (element.ref === undefined) return "added";
  return element.set === undefined ? "context" : "changed";
}

/**
 * The same rule for a relationship. Its endpoints are identity and its other
 * declared fields describe it; only `set` states an intention.
 */
export function relationshipRole(relationship: StructuredEdge | StructuredMessage, isProposal: boolean): ChangeRole {
  if (!isProposal) return "unchanged";
  if (relationship.ref === undefined) return "added";
  return relationship.set === undefined ? "context" : "changed";
}

/**
 * What a change does to one field, as a reader needs to see it.
 *
 * The described value is what the thing is called now, so an approval view can
 * finally show `Ledger → General Ledger` rather than asserting "changed" and
 * leaving the reader to wonder what it was. `from` is absent when the producer
 * declared no descriptive value — the change still stands, it just cannot be
 * shown as a before and after.
 */
export interface FieldChange {
  field: string;
  from?: string;
  to: string;
}

export function fieldChanges(subject: StructuredElement | StructuredEdge | StructuredMessage): FieldChange[] {
  const set = subject.set as Record<string, string> | undefined;
  if (set === undefined) return [];
  const described = subject as unknown as Record<string, unknown>;
  return Object.entries(set).map(([field, to]) => {
    const from = described[field];
    return { field, ...(typeof from === "string" ? { from } : {}), to };
  });
}

/** Human wording for a role, used in the approval view and its textual equivalent. */
export const ROLE_LABEL: Record<ChangeRole, string> = {
  added: "added",
  changed: "changed",
  context: "existing",
  unchanged: "",
};

/**
 * The same wording for a table's rows, plus the one a diagram states elsewhere.
 *
 * A graph says "removed" in a list beside the picture, because a removal there is
 * a bare reference with nothing to draw. A removed row carries its own cells, so
 * it is shown in place — and shares the word, so a reader meets one vocabulary.
 */
export const TABLE_ROLE_LABEL: Record<StructuredTableRowRole, string> = {
  added: "added",
  changed: "changed",
  context: "existing",
  removed: "removed",
};

/** The order roles are listed in, wherever they are listed. */
export const TABLE_ROLES: StructuredTableRowRole[] = ["added", "changed", "context", "removed"];

/** Whether any row of this table says anything about a change. */
export function tableDeclaresRoles(data: StructuredTableData): boolean {
  return data.rows.some((row) => readTableRow(row).role !== undefined);
}

/**
 * What a row plays, as the reader should see it.
 *
 * A row that declares nothing is context — but only among rows that declare
 * something. In a table that reports no change at all there is no context to be
 * the exception to, so it has no role, and the table renders as the data it is.
 */
export function tableRowRole(
  row: StructuredTableData["rows"][number],
  declaresRoles: boolean,
): StructuredTableRowRole | undefined {
  if (!declaresRoles) return undefined;
  return readTableRow(row).role ?? "context";
}

/** Which roles this table actually uses, in the order they are always listed. */
export function tableRolesPresent(data: StructuredTableData): StructuredTableRowRole[] {
  if (!tableDeclaresRoles(data)) return [];
  const used = new Set(data.rows.map((row) => tableRowRole(row, true)));
  return TABLE_ROLES.filter((role) => used.has(role));
}

/** Where an element sits, and how big its box is. */
export type PlacedNode = { id: string; x: number; y: number; width: number; height: number };

/** A point on the canvas. */
export type Point = { x: number; y: number };

/**
 * A route for one relationship, as the layout engine drew it.
 *
 * Keyed by the relationship's index in the document, because two relationships
 * between the same pair are two relationships and must not share a route: drawn as
 * straight lines between centres they landed exactly on top of each other, and the
 * diagram showed one line where the document had two.
 */
export type PlacedEdge = { index: number; points: Point[] };

/** A laid-out graph: boxes in a plane, the routes between them, and the extent. */
/**
 * A container's enclosure, as dagre computed it around its members.
 *
 * Geometry only. Membership is declared on the member and stays there; this is
 * where the box ended up once the layout had placed what it holds.
 */
export type PlacedContainer = { id: string; label: string; x: number; y: number; width: number; height: number };

export type GraphLayout = {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  containers: PlacedContainer[];
  width: number;
  height: number;
};

/**
 * The enclosure around a set of member boxes: their extent, plus room to breathe
 * and a strip for the label.
 *
 * Exported because it is computed twice — once by the layout, and again by the
 * view whenever the reader has moved a member. Both must agree on what "inside
 * the container" means, and a second implementation of that is a second answer.
 */
export function encloseMembers(
  members: readonly { x: number; y: number; width: number; height: number }[],
): { x: number; y: number; width: number; height: number } | undefined {
  if (members.length === 0) return undefined;
  const left = Math.min(...members.map((member) => member.x));
  const top = Math.min(...members.map((member) => member.y));
  const right = Math.max(...members.map((member) => member.x + member.width));
  const bottom = Math.max(...members.map((member) => member.y + member.height));
  return {
    x: left - CONTAINER_PAD,
    y: top - CONTAINER_PAD - CONTAINER_LABEL,
    width: right - left + CONTAINER_PAD * 2,
    height: bottom - top + CONTAINER_PAD * 2 + CONTAINER_LABEL,
  };
}

/** Spacing between the boxes, in the same units as the sizes handed in. */
const RANK_GAP = 64;
const NODE_GAP = 24;
const MARGIN = 12;
/** Breathing room inside an enclosure, and the strip its label sits in. */
const CONTAINER_PAD = 10;
const CONTAINER_LABEL = 16;
const CONTAINER_GAP = 16;
/** What an enclosure holding nothing is drawn as — big enough to read as a container. */
const EMPTY_CONTAINER_WIDTH = 160;
const EMPTY_CONTAINER_HEIGHT = 52;

/**
 * A layered layout, delegated to dagre.
 *
 * This used to be hand-rolled: longest-path ranking with a DFS to spot the edges
 * that close a cycle. It was a fraction of Sugiyama and it showed — a seventeen-node
 * architecture with feedback loops drew twenty thousand pixels wide and arrived on
 * screen as a sliver. Ranking is the easy quarter of the problem; ordering within a
 * rank to reduce crossings, and assigning coordinates so long edges stay straight,
 * are the parts that decide whether a diagram can be read, and they are a solved
 * problem worth importing rather than approximating.
 *
 * Deterministic: dagre is a pure function of the graph and the insertion order, and
 * both come from the document. The same document must draw the same way every time —
 * a reader approving a proposal should not have to wonder whether the picture moved
 * for a reason.
 *
 * Geometry still carries no meaning: it is chosen so the thing can be read, and the
 * textual equivalent beside it is what states the relationships.
 *
 * `size` is supplied by the caller because only the view knows its own text metrics,
 * and giving dagre a real size per box is what lets one long label widen its own box
 * instead of every box.
 */
export function layoutGraph(
  data: StructuredGraphData,
  size: (node: StructuredElement) => { width: number; height: number },
): GraphLayout {
  // `compound` so a container can be a node that holds other nodes. Dagre then
  // places the members together and reports the enclosing box it computed, which
  // is the whole of what a container costs this layout: no second engine, and the
  // elements and relationships come out placed exactly as they would ungrouped.
  const graph = new dagre.graphlib.Graph({ compound: true, multigraph: true });
  graph.setGraph({ rankdir: "LR", ranksep: RANK_GAP, nodesep: NODE_GAP, marginx: MARGIN, marginy: MARGIN });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const node of data.nodes) graph.setNode(node.id, size(node));

  // A container is laid out only if it holds something. Dagre gives an empty
  // cluster no extent, so an empty one is placed by hand below — it is declared,
  // so it is drawn.
  const declared = data.containers ?? [];
  const held = new Map<string, string[]>();
  for (const node of data.nodes) {
    if (node.container === undefined) continue;
    if (!declared.some((container) => container.id === node.container)) continue;
    graph.setNode(node.container, { label: node.container });
    graph.setParent(node.id, node.container);
    held.set(node.container, [...(held.get(node.container) ?? []), node.id]);
  }
  // Named by index so two relationships between the same pair stay two edges;
  // collapsed, the second one would silently stop influencing the layout.
  data.edges.forEach((edge, index) => {
    // A self-loop is drawn by hand rather than routed: dagre reserves rank space for
    // one and still returns a degenerate path, which came out as a line of zero
    // length — a relationship the document declared and the picture did not show.
    if (edge.from !== edge.to && graph.hasNode(edge.from) && graph.hasNode(edge.to)) {
      graph.setEdge(edge.from, edge.to, {}, String(index));
    }
  });

  dagre.layout(graph);

  // dagre reports centres; boxes are drawn from their top-left corner.
  const nodes = data.nodes.map((node) => {
    const placed = graph.node(node.id) as { x: number; y: number; width: number; height: number } | undefined;
    const { width, height } = size(node);
    return {
      id: node.id,
      x: (placed?.x ?? MARGIN + width / 2) - width / 2,
      y: (placed?.y ?? MARGIN + height / 2) - height / 2,
      width,
      height,
    };
  });

  const edges: PlacedEdge[] = [];
  data.edges.forEach((edge, index) => {
    if (edge.from === edge.to) return;
    const routed = graph.edge(edge.from, edge.to, String(index)) as { points?: Point[] } | undefined;
    if (routed?.points !== undefined && routed.points.length > 0) {
      edges.push({ index, points: routed.points.map((point) => ({ x: point.x, y: point.y })) });
    }
  });

  // The enclosures, in declared order, measured from where the members actually
  // ended up rather than read back from dagre's cluster. The two agree here — but
  // only here: the reader may drag a box afterwards, and an enclosure that came
  // from the layout would stay behind while its member walked out of it. Deriving
  // it from the members means the view can re-derive it the same way at any time.
  const placedContainers: PlacedContainer[] = [];
  let emptyAt = nodes.reduce((bottom, node) => Math.max(bottom, node.y + node.height), MARGIN) + CONTAINER_GAP;
  const placedById = new Map(nodes.map((node) => [node.id, node]));
  for (const container of declared) {
    const members = (held.get(container.id) ?? []).flatMap((id) => {
      const node = placedById.get(id);
      return node === undefined ? [] : [node];
    });
    const box = encloseMembers(members);
    if (box !== undefined) {
      placedContainers.push({ id: container.id, label: container.label, ...box });
    } else {
      placedContainers.push({
        id: container.id,
        label: container.label,
        x: MARGIN,
        y: emptyAt,
        width: EMPTY_CONTAINER_WIDTH,
        height: EMPTY_CONTAINER_HEIGHT,
      });
      emptyAt += EMPTY_CONTAINER_HEIGHT + CONTAINER_GAP;
    }
  }

  // An enclosure reaches past the members it holds — padding on every side and a
  // strip for its label — so the topmost one lands above where dagre started, at a
  // negative coordinate that the viewport would simply cut off. Shift everything
  // back into view rather than clipping the box that says what the group is.
  const drawn = [
    ...nodes.map((node) => ({ x: node.x, y: node.y, width: node.width, height: node.height })),
    ...placedContainers,
  ];
  const offsetX = Math.min(0, ...drawn.map((item) => item.x)) - MARGIN;
  const offsetY = Math.min(0, ...drawn.map((item) => item.y)) - MARGIN;
  if (offsetX < 0 || offsetY < 0) {
    for (const node of nodes) {
      node.x -= offsetX;
      node.y -= offsetY;
    }
    for (const container of placedContainers) {
      container.x -= offsetX;
      container.y -= offsetY;
    }
    for (const edge of edges) {
      for (const point of edge.points) {
        point.x -= offsetX;
        point.y -= offsetY;
      }
    }
  }

  // dagre's own graph extent ignores nothing, but a node it failed to place would
  // fall outside it, so measure what is actually drawn — enclosures included.
  const extent = [
    ...nodes.map((node) => ({ x: node.x, y: node.y, width: node.width, height: node.height })),
    ...placedContainers,
  ].reduce(
    (box, item) => ({ width: Math.max(box.width, item.x + item.width), height: Math.max(box.height, item.y + item.height) }),
    { width: 0, height: 0 },
  );

  return { nodes, edges, containers: placedContainers, width: extent.width + MARGIN, height: extent.height + MARGIN };
}

/**
 * Everything the picture shows, as facts rather than geometry.
 *
 * One model, two renderings. The text equivalent used to walk the document on its
 * own, and it drifted from the diagram in every way an independent traversal can:
 * it never mentioned an element's type, it preferred `kind` where the diagram
 * preferred `label`, it dropped one of the two when a relationship declared both,
 * and it listed sequence messages without ever listing the participants — so a
 * participant nobody sent a message to was in the picture and absent from the words.
 *
 * A reader on the text equivalent is reading it *because* they cannot see the
 * diagram. Anything only the diagram says is, for them, not said at all.
 */
/**
 * The enrichment an item carries, flattened for a reader and interpreted by nobody.
 *
 * Four separate things that a reader must not confuse, which is why they are four
 * fields rather than one merged map:
 *
 * - `attributes` — what the producer says is true of this item now. Description.
 * - `expectations` — what the producer believes the authority holds, for the
 *   authority to check before applying. A condition, not an established fact.
 * - `assignments` — what the proposal asks to become true. An instruction.
 * - `removedAttributes` — what the proposal asks to unset. Also an instruction, and
 *   separate from `assignments` because `null` is an ordinary value here.
 *
 * Merged, a reader approving a proposal could not tell what they were approving
 * from what was merely shown to them for context.
 */
export type DescribedEnrichment = {
  attributes: [string, StructuredAttributeValue][];
  expectations: [string, StructuredAttributeValue][];
  assignments: [string, StructuredAttributeValue][];
  removedAttributes: string[];
  locations: StructuredLocation[];
  artifacts: StructuredArtifact[];
};

export type DescribedThing = {
  id: string;
  label: string;
  kind?: string;
  role: ChangeRole;
  changes: FieldChange[];
  /** The container it belongs to, by identifier, when it names one. */
  container?: string;
} & DescribedEnrichment;

export type DescribedLink = {
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
  /** What the relationship says of itself, if anything. */
  label?: string;
  kind?: string;
  role: ChangeRole;
  changes: FieldChange[];
  isLoop: boolean;
} & DescribedEnrichment;

/**
 * A row of a table, as a reader meets it.
 *
 * `heading` makes it a chapter rather than data: it spans the table instead of
 * filling its columns, and every representation has to keep it in place, because a
 * requirements document whose sections vanish reads as one long undifferentiated
 * list.
 */
export type DescribedRow = {
  cells: StructuredTableCell[];
  role?: StructuredTableRowRole;
  /** Present on a structural row. Data rows never carry one. */
  heading?: string;
  depth?: number;
  id?: string;
  ref?: string;
  kind?: string;
  changes: FieldChange[];
} & DescribedEnrichment;

/** Traceability between rows, with each end resolved as far as this document can. */
export type DescribedTrace = {
  kind: string;
  label?: string;
  /** The row this end names, when it is one this document declares. */
  fromRow?: string;
  toRow?: string;
  /** The identifier an end carries when it points outside this document. */
  fromRef?: string;
  toRef?: string;
  /** What a reader should see for each end: a row's own text, or the bare reference. */
  fromLabel: string;
  toLabel: string;
};

export type StructureDescription = {
  /** "element" for a graph, "participant" for a sequence. */
  thingNoun: string;
  linkNoun: string;
  things: DescribedThing[];
  links: DescribedLink[];
  columns?: string[];
  rows?: DescribedRow[];
  /** Every declared container, including one no member names. */
  containers: { id: string; label: string }[];
  removals: { type: string; ref: string }[];
  /** The vocabulary that owns this document's kinds and attribute names, if it names one. */
  profile?: string;
  /** What a proposal targets, and the revision it was prepared against. */
  target?: { ref: string; revision?: string };
  /** Artifact links carried by the document itself rather than by one of its items. */
  artifacts: StructuredArtifact[];
  /** Relations between the rows of a table. Empty for every other kind. */
  traces: DescribedTrace[];
};


/** Nothing carried, for an item the enriched contract has no extra word about. */
const NO_ENRICHMENT: DescribedEnrichment = {
  attributes: [],
  expectations: [],
  assignments: [],
  removedAttributes: [],
  locations: [],
  artifacts: [],
};

/**
 * The enrichment an item carries, in the document's own order.
 *
 * Order is the producer's, never sorted: an attribute list a reader compares
 * between two renderings has to come back the same way round, and the producer's
 * order is the only one both sides can agree on without inventing a rule.
 */
function describeEnrichment(item: unknown): DescribedEnrichment {
  if (item === null || typeof item !== "object") return NO_ENRICHMENT;
  const carrier = item as Record<string, unknown>;
  const entriesOf = (value: unknown): [string, StructuredAttributeValue][] =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (Object.entries(value as Record<string, StructuredAttributeValue>))
      : [];
  const set = carrier.set as Record<string, unknown> | undefined;
  const removed = set?.removeAttributes;
  return {
    attributes: entriesOf(carrier.attributes),
    expectations: entriesOf((carrier.expect as Record<string, unknown> | undefined)?.attributes),
    assignments: entriesOf(set?.attributes),
    removedAttributes: Array.isArray(removed) ? removed.filter((name): name is string => typeof name === "string") : [],
    locations: Array.isArray(carrier.locations) ? (carrier.locations as StructuredLocation[]) : [],
    artifacts: Array.isArray(carrier.artifacts) ? (carrier.artifacts as StructuredArtifact[]) : [],
  };
}

/** What a proposal targets. Version 1 states a bare reference; version 2 an object. */
function describeTarget(envelope: ValidatedStructuredExchange): { ref: string; revision?: string } | undefined {
  const target = (envelope as { target?: unknown }).target;
  if (typeof target === "string") return { ref: target };
  if (target === null || typeof target !== "object") return undefined;
  const named = target as { ref?: unknown; revision?: unknown };
  if (typeof named.ref !== "string") return undefined;
  return { ref: named.ref, ...(typeof named.revision === "string" ? { revision: named.revision } : {}) };
}

export function describeStructure(
  envelope: ValidatedStructuredExchange,
  isProposal: boolean,
): StructureDescription {
  const removals = (envelope.removals ?? []).map((removal) => ({ type: removal.type, ref: removal.ref }));
  const profile = (envelope as { profile?: unknown }).profile;
  const documentArtifacts = (envelope as { artifacts?: unknown }).artifacts;
  const shared = {
    ...(typeof profile === "string" ? { profile } : {}),
    ...((): { target?: { ref: string; revision?: string } } => {
      const target = describeTarget(envelope);
      return target === undefined ? {} : { target };
    })(),
    artifacts: Array.isArray(documentArtifacts) ? (documentArtifacts as StructuredArtifact[]) : [],
  };

  if (envelope.kind === "table") {
    const data = envelope.data as StructuredTableData;
    const declaresRoles = tableDeclaresRoles(data);
    const rows: DescribedRow[] = data.rows.map((row) => {
      const role = tableRowRole(row, declaresRoles);
      const { cells, heading } = readTableRow(row);
      const carrier = Array.isArray(row) ? {} : (row as unknown as Record<string, unknown>);
      return {
        cells,
        ...(role === undefined ? {} : { role }),
        ...(heading === undefined ? {} : { heading }),
        ...(typeof carrier.depth === "number" ? { depth: carrier.depth } : {}),
        ...(typeof carrier.id === "string" ? { id: carrier.id } : {}),
        ...(typeof carrier.ref === "string" ? { ref: carrier.ref } : {}),
        ...(typeof carrier.kind === "string" ? { kind: carrier.kind } : {}),
        changes: fieldChanges(carrier as never),
        ...describeEnrichment(row),
      };
    });

    // A row a relation can point at, and the text a reader should see for that end.
    const rowText = new Map<string, string>();
    for (const row of rows) {
      if (row.id === undefined) continue;
      const first = row.cells.find((cell) => typeof cell === "string" && cell !== "");
      rowText.set(row.id, (typeof first === "string" ? first : undefined) ?? row.ref ?? row.id);
    }
    const declaredRelations = (data as { relations?: unknown }).relations;
    const traces: DescribedTrace[] = (Array.isArray(declaredRelations) ? declaredRelations : []).map((relation) => {
      const link = relation as { from?: { id?: string; ref?: string }; to?: { id?: string; ref?: string }; kind?: string; label?: string };
      const end = (side: { id?: string; ref?: string } | undefined) => {
        const id = typeof side?.id === "string" ? side.id : undefined;
        const ref = typeof side?.ref === "string" ? side.ref : undefined;
        // A row's own text when we have it, the bare reference when the end leaves
        // the document — never an invented label for something we cannot see.
        return { id, ref, label: (id !== undefined ? rowText.get(id) : undefined) ?? ref ?? id ?? "" };
      };
      const from = end(link.from);
      const to = end(link.to);
      return {
        kind: link.kind ?? "",
        ...(typeof link.label === "string" ? { label: link.label } : {}),
        ...(from.id === undefined ? {} : { fromRow: from.id }),
        ...(to.id === undefined ? {} : { toRow: to.id }),
        ...(from.ref === undefined ? {} : { fromRef: from.ref }),
        ...(to.ref === undefined ? {} : { toRef: to.ref }),
        fromLabel: from.label,
        toLabel: to.label,
      };
    });

    return {
      thingNoun: "column",
      linkNoun: "row",
      things: [],
      links: [],
      columns: data.columns,
      rows,
      containers: [],
      removals,
      traces,
      ...shared,
    };
  }

  const isGraph = envelope.kind === "graph";
  const source = isGraph
    ? (envelope.data as StructuredGraphData).nodes
    : (envelope.data as StructuredSequenceData).participants;
  const connections: (StructuredEdge | StructuredMessage)[] = isGraph
    ? (envelope.data as StructuredGraphData).edges
    : (envelope.data as StructuredSequenceData).messages;

  const named = new Map(source.map((thing) => [thing.id, displayLabel(thing)]));

  return {
    thingNoun: isGraph ? "element" : "participant",
    linkNoun: isGraph ? "relationship" : "message",
    // Every one of them, including any nothing connects to.
    things: source.map((thing) => ({
      id: thing.id,
      label: displayLabel(thing),
      kind: thing.kind,
      role: elementRole(thing, isProposal),
      changes: fieldChanges(thing),
      container: thing.container,
      ...describeEnrichment(thing),
    })),
    links: connections.map((link) => ({
      from: link.from,
      to: link.to,
      fromLabel: named.get(link.from) ?? link.from,
      toLabel: named.get(link.to) ?? link.to,
      label: link.label,
      // A message has no kind; a relationship may have both a label and a kind, and
      // both are carried rather than one standing in for the other.
      kind: "kind" in link ? link.kind : undefined,
      role: relationshipRole(link, isProposal),
      changes: fieldChanges(link),
      isLoop: link.from === link.to,
      ...describeEnrichment(link),
    })),
    containers: (isGraph
      ? (envelope.data as StructuredGraphData).containers
      : (envelope.data as StructuredSequenceData).containers) ?? [],
    removals,
    traces: [],
    ...shared,
  };
}

/** Label to show for an element: its own when declared, else its reference. */
export function displayLabel(element: StructuredElement): string {
  return element.label ?? element.ref ?? element.id;
}

/**
 * The derived diagram export.
 *
 * Deterministic, and derived only from validated data — diagram syntax is never
 * read back to recover relationships, so this is a one-way door. Offered because
 * being able to get portable syntax *out* is part of why structured data is worth
 * carrying in.
 */
export function toMermaid(envelope: ValidatedStructuredExchange): string | undefined {
  if (envelope.kind === "graph") {
    const data = envelope.data as StructuredGraphData;
    const lines = ["flowchart TD"];
    // Grouped nodes go inside their subgraph, ungrouped ones outside it, and the
    // relationships are declared after all of them — an edge crosses boundaries, so
    // it belongs to no group and is never nested in one.
    const containers = data.containers ?? [];
    const declared = new Set(containers.map((container) => container.id));
    const grouped = (id: string) => data.nodes.filter((node) => node.container === id);
    for (const container of containers) {
      lines.push(`  subgraph ${safeId(container.id)}["${escapeMermaid(container.label)}"]`);
      for (const node of grouped(container.id)) {
        lines.push(`    ${safeId(node.id)}["${escapeMermaid(displayLabel(node))}"]`);
      }
      lines.push("  end");
    }
    for (const node of data.nodes) {
      if (node.container !== undefined && declared.has(node.container)) continue;
      lines.push(`  ${safeId(node.id)}["${escapeMermaid(displayLabel(node))}"]`);
    }
    for (const edge of data.edges) {
      const label = edge.label ?? edge.kind;
      const arrow = label === undefined ? "-->" : `-- "${escapeMermaid(label)}" -->`;
      lines.push(`  ${safeId(edge.from)} ${arrow} ${safeId(edge.to)}`);
    }
    return lines.join("\n");
  }
  if (envelope.kind === "sequence") {
    const data = envelope.data as StructuredSequenceData;
    const lines = ["sequenceDiagram"];
    // `box` groups participants the same way the view does, so the export and the
    // picture say the same thing. Mermaid takes a box's members in the order they
    // are declared inside it, which is the order the view puts them in.
    const containers = data.containers ?? [];
    const declared = new Set(containers.map((container) => container.id));
    const participantLine = (participant: StructuredElement, indent: string) =>
      `${indent}participant ${safeId(participant.id)} as "${escapeMermaid(displayLabel(participant))}"`;
    for (const container of containers) {
      lines.push(`  box ${escapeMermaid(container.label)}`);
      for (const participant of data.participants.filter((candidate) => candidate.container === container.id)) {
        lines.push(participantLine(participant, "    "));
      }
      lines.push("  end");
    }
    for (const participant of data.participants) {
      if (participant.container !== undefined && declared.has(participant.container)) continue;
      lines.push(participantLine(participant, "  "));
    }
    for (const message of data.messages) {
      lines.push(`  ${safeId(message.from)}->>${safeId(message.to)}: ${escapeMermaid(message.label ?? "")}`);
    }
    return lines.join("\n");
  }
  // A table has no diagram form, and inventing one would be a second
  // representation nobody asked for.
  return undefined;
}

/**
 * Producer identifiers are opaque; mermaid's syntax is not. Keep them apart.
 *
 * Producer text is never an identifier. Every id in the export is generated here from
 * the character codes of the local id, so the only tokens that can name a node are
 * ones this function made.
 */
function safeId(id: string): string {
  return `n${[...id].map((character) => character.charCodeAt(0).toString(36)).join("")}`;
}

/**
 * Producer text, rendered so it cannot become syntax.
 *
 * The earlier version escaped quotes and newlines and let everything else through,
 * which was not enough: `;` separates statements in mermaid, so a participant named
 *
 *     A; participant injected as INJECTED
 *
 * declared a second participant that was in no document. The label was data and it
 * arrived as structure.
 *
 * `#` goes first and unconditionally. It opens mermaid's entity syntax, and it is
 * also what the escapes below are written in — escaping it second would let producer
 * text spell `#quot;` itself and reintroduce the quote it was denied.
 */
const MERMAID_ENTITY: Record<string, string> = {
  "#": "#35;",
  '"': "#quot;",
  ";": "#59;",
  "<": "#60;",
  ">": "#62;",
};

function escapeMermaid(text: string): string {
  return (
    text
      // One pass, so no replacement can be fed to another: escaping `#` first and `;`
      // second turned `#` into `#35;` and then into `#35#59;`, which decodes to
      // nothing at all. The escapes are written in the very character they escape.
      .replace(/[#";<>]/g, (character) => MERMAID_ENTITY[character])
      .replace(/[\r\n\t\f\v\u0000-\u001f\u2028\u2029]+/g, " ")
  );
}

/** Which vocabulary a filterable name belongs to. */
export type FilterScope = "element" | "relationship" | "role";

/**
 * A type name qualified by what it is a type of.
 *
 * The two vocabularies are independent and may share a word, so they cannot share a
 * namespace: with a bare name, a graph whose blocks and whose connections both used
 * "power" lost both when the reader hid either.
 */
export function filterKey(of: FilterScope, kind: string): string {
  return `${of}:${kind}`;
}

/**
 * What a reader has hidden, as one value.
 *
 * The set of qualified keys the legend toggles. It was an anonymous
 * `ReadonlySet<string>` in component state, which was enough while the only thing
 * that could build one was the legend itself. It is a named type now because a
 * second caller builds one — the agent, through a tool — and both have to mean the
 * same thing by it or a figure written to disk shows something other than what the
 * same narrowing shows on screen.
 *
 * Empty means the whole document, for a reader and for the agent alike.
 */
export type Narrowing = ReadonlySet<string>;

/** The whole document: what a reader sees before touching anything. */
export const NOTHING_HIDDEN: Narrowing = new Set<string>();

/** Whether this narrowing hides that kind of that thing. */
export function isHidden(narrowing: Narrowing, of: FilterScope, kind: string | undefined): boolean {
  // A thing with no kind cannot be hidden by kind: there is no key that names it,
  // and dropping it would make "hide a kind" quietly mean "hide the untyped too".
  if (kind === undefined || kind === "") return false;
  return narrowing.has(filterKey(of, kind));
}

/**
 * A narrowing from two lists of names, which is how a caller outside the legend says
 * what to hide.
 *
 * Two lists rather than one list of qualified keys, because the qualification is
 * exactly what a caller gets wrong silently: `power` where `relationship:power` was
 * meant hides nothing, draws a perfectly valid figure of the whole document, and
 * looks like it worked.
 */
export function narrowingOf(hidden: {
  elementKinds?: readonly string[];
  relationshipKinds?: readonly string[];
}): Narrowing {
  const keys = new Set<string>();
  for (const kind of hidden.elementKinds ?? []) if (kind !== "") keys.add(filterKey("element", kind));
  for (const kind of hidden.relationshipKinds ?? []) if (kind !== "") keys.add(filterKey("relationship", kind));
  return keys;
}

/* ── Sequence layout ────────────────────────────────────────────────────────── */

const MESSAGE_GAP = 40;
/** The strip a container header sits in, above the participant boxes. */
const CONTAINER_BAND = 22;
export const SELF_LOOP = 26;

export type SequenceBand = { container: StructuredContainer; from: number; to: number };

export type SequenceLayout = {
  /** The columns, in the order they are drawn. */
  columns: StructuredElement[];
  /** Runs of adjacent columns sharing a container — what a header may span. */
  bands: SequenceBand[];
  bandHeight: number;
  lifelineX: number;
  /** How wide a participant box is drawn. */
  boxW: number;
  headerHeight: number;
  messageGap: number;
  width: number;
  height: number;
  /** Where a participant's lifeline stands. */
  xOf: (id: string) => number;
};

/**
 * Where a sequence goes, worked out before anything is drawn.
 *
 * Lived inside the component until a figure had to be producible without one. The
 * arithmetic is unchanged — the same widths from the same character counts — because
 * a figure that is *nearly* the reader's picture is worse than no figure.
 */
export function layoutSequence(data: StructuredSequenceData): SequenceLayout {
  /**
   * The columns, ordered so a container's members are adjacent.
   *
   * A header can only span columns that touch, so a document declaring
   * `battery, ecu, alternator, dash` cannot be drawn with one header per container as
   * written. Rather than break a container into several headers, the layout moves the
   * columns — and moves them by a rule a producer can predict rather than by whatever
   * is convenient: walking the declared order, the first member of a container met
   * brings the rest of that container with it, in their own declared order, and a
   * participant belonging to nothing keeps its place.
   *
   * The cost is real: declared order means something in a sequence. This departs from
   * it as little as grouping allows, and only when containers are declared at all.
   */
  const containers = data.containers ?? [];
  let columns: StructuredElement[];
  if (containers.length === 0) {
    columns = data.participants;
  } else {
    const declared = new Set(containers.map((container) => container.id));
    const placed = new Set<string>();
    columns = [];
    for (const participant of data.participants) {
      if (placed.has(participant.id)) continue;
      const group = participant.container;
      if (group === undefined || !declared.has(group)) {
        columns.push(participant);
        placed.add(participant.id);
        continue;
      }
      for (const member of data.participants) {
        if (member.container !== group || placed.has(member.id)) continue;
        columns.push(member);
        placed.add(member.id);
      }
    }
  }

  const bands: SequenceBand[] = [];
  columns.forEach((participant, index) => {
    const container = containers.find((candidate) => candidate.id === participant.container);
    if (container === undefined) return;
    const last = bands.at(-1);
    if (last !== undefined && last.container.id === container.id && last.to === index - 1) last.to = index;
    else bands.push({ container, from: index, to: index });
  });

  const bandHeight = containers.length > 0 ? CONTAINER_BAND : 0;
  const columnOf = new Map(columns.map((participant, index) => [participant.id, index]));
  const lifelineX = Math.max(
    ...data.participants.map((participant) =>
      boxWidthWithChanges([displayLabel(participant)], fieldChanges(participant), 110, 240),
    ),
    boxWidth(
      data.messages.map((message) => message.label ?? ""),
      110,
      240,
    ) * 0.8,
  );
  const boxW = lifelineX - 14;
  const headerHeight =
    data.participants.reduce(
      (tallest, participant) =>
        Math.max(
          tallest,
          boxHeight(
            wrapLabel(displayLabel(participant), boxW).length,
            changeLines(fieldChanges(participant), boxW).length,
          ),
        ),
      boxHeight(1, 0),
    ) + 8;

  return {
    columns,
    bands,
    bandHeight,
    lifelineX,
    boxW,
    headerHeight,
    messageGap: MESSAGE_GAP,
    width: Math.max(data.participants.length * lifelineX, 240),
    height: bandHeight + headerHeight + (data.messages.length + 1) * MESSAGE_GAP,
    xOf: (id: string) => (columnOf.get(id) ?? 0) * lifelineX + lifelineX / 2,
  };
}

/**
 * Everything about a box in one line, for the hover: the escape hatch for whatever
 * wrapping had to cut, and the only channel that never runs out of room.
 */
export function elementSummary(element: StructuredElement, role: ChangeRole): string {
  const parts = [displayLabel(element)];
  if (role !== "unchanged") parts.push(`(${ROLE_LABEL[role]})`);
  if (element.ref !== undefined) parts.push(`[${element.ref}]`);
  for (const change of fieldChanges(element)) parts.push(changeText(change));
  return parts.join(" ");
}

/* ── Edge geometry ──────────────────────────────────────────────────────────── */

/** How far the reader has moved a box from where the layout put it. */
export type Nudge = { dx: number; dy: number };

/**
 * Where an edge should touch a box: from centre to centre, stopping at the border
 * it crosses. A fixed "right edge to left edge" is only correct when the target
 * sits immediately to the right, and cuts across unrelated boxes when it does not.
 */
export function anchorPoint(
  from: { cx: number; cy: number; w: number; h: number },
  to: { cx: number; cy: number },
): { x: number; y: number } {
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  if (dx === 0 && dy === 0) return { x: from.cx, y: from.cy };
  const scale = Math.min(
    dx === 0 ? Infinity : from.w / 2 / Math.abs(dx),
    dy === 0 ? Infinity : from.h / 2 / Math.abs(dy),
  );
  return { x: from.cx + dx * scale, y: from.cy + dy * scale };
}

export type Box = { x: number; y: number; cx: number; cy: number; w: number; h: number };

/**
 * A path that turns corners instead of cutting them.
 *
 * The layout engine emits waypoints, and joining them with straight segments runs
 * through hard angles that read as kinks rather than as a path going somewhere. Each
 * corner is replaced by a short quadratic through it, with the radius clamped to the
 * shorter of the two segments meeting there so a tight turn bends rather than
 * overshoots into the segment beyond it.
 */
export function roundedPath(points: { x: number; y: number }[], radius: number): string {
  if (points.length < 3) {
    return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  }

  const parts = [`M ${points[0].x} ${points[0].y}`];
  for (let index = 1; index < points.length - 1; index++) {
    const previous = points[index - 1];
    const corner = points[index];
    const next = points[index + 1];

    const toPrevious = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const toNext = Math.hypot(next.x - corner.x, next.y - corner.y);
    if (toPrevious === 0 || toNext === 0) continue;

    // A point that does not turn is not a corner. The layout engine emits collinear
    // waypoints even on a straight run, and rounding those put curve commands into a
    // line that was already straight.
    const turn =
      ((corner.x - previous.x) * (next.y - corner.y) - (corner.y - previous.y) * (next.x - corner.x)) /
      (toPrevious * toNext);
    if (Math.abs(turn) < 0.02) continue;

    const cut = Math.min(radius, toPrevious / 2, toNext / 2);
    const entry = {
      x: corner.x - ((corner.x - previous.x) / toPrevious) * cut,
      y: corner.y - ((corner.y - previous.y) / toPrevious) * cut,
    };
    const exit = {
      x: corner.x + ((next.x - corner.x) / toNext) * cut,
      y: corner.y + ((next.y - corner.y) / toNext) * cut,
    };
    parts.push(`L ${entry.x} ${entry.y}`, `Q ${corner.x} ${corner.y} ${exit.x} ${exit.y}`);
  }
  const last = points[points.length - 1];
  parts.push(`L ${last.x} ${last.y}`);
  return parts.join(" ");
}

/**
 * The shape a relationship is drawn as, and where its label goes.
 *
 * Every relationship gets its own `path`, for three reasons the straight `line` it
 * replaced could not meet. A relationship from something to itself has no direction
 * to draw along, and came out as a line of zero length — declared in the document,
 * invisible in the picture. Two relationships between the same pair were drawn on
 * exactly the same pixels, so a diagram showed one where the document had two. And
 * the layout engine works out routes that go around the boxes in between, which a
 * straight line between centres throws away and draws over.
 */
export function edgePath(
  from: Box,
  to: Box,
  route: { x: number; y: number }[] | undefined,
  /** Which of the relationships between this same pair, in declaration order. */
  rank: number,
  /**
   * How far each end has been moved from where the layout put it.
   *
   * The route was computed for the original positions, so a moved end leaves it
   * connecting nothing. Dropping it was the first answer and a poor one: the route
   * is the only thing that carries the bends, so the moment a reader touched a box
   * every relationship around it snapped from a curve going somewhere to a straight
   * line cutting across whatever it had been avoiding.
   *
   * Instead the route is carried along with its ends. Each waypoint takes a blend of
   * the two nudges by how far along it sits, so the near end follows the box that
   * moved, the far end stays where it was, and the shape in between deforms smoothly
   * rather than disappearing.
   */
  warp?: { from: Nudge; to: Nudge },
): { d: string; labelAt: { x: number; y: number }; span: number } {
  if (from === to) {
    // A loop, drawn by hand: out of the top, around, and back into the right side.
    // Nested by rank so several loops on one element stay countable.
    const reach = 26 + rank * 12;
    const startX = from.cx - from.w / 4;
    const endX = from.cx + from.w / 4;
    const top = from.y;
    return {
      d: `M ${startX} ${top} C ${startX} ${top - reach}, ${endX} ${top - reach}, ${endX} ${top}`,
      labelAt: { x: from.cx, y: top - reach * 0.75 },
      span: reach * 2,
    };
  }

  const start = anchorPoint(from, to);
  const finish = anchorPoint(to, from);
  const span = Math.hypot(finish.x - start.x, finish.y - start.y);

  // Middle points from the layout engine, if it routed this one. The ends are
  // recomputed against the boxes so the arrow still lands on a border.
  const routed = (route ?? []).slice(1, -1);
  const waypoints =
    warp === undefined
      ? routed
      : routed.map((point, index) => {
          const along = routed.length === 1 ? 0.5 : index / (routed.length - 1);
          return {
            x: point.x + warp.from.dx * (1 - along) + warp.to.dx * along,
            y: point.y + warp.from.dy * (1 - along) + warp.to.dy * along,
          };
        });
  if (waypoints.length > 0 && rank === 0) {
    const middle = waypoints[Math.floor((waypoints.length - 1) / 2)];
    return { d: roundedPath([start, ...waypoints, finish], 12), labelAt: middle, span };
  }

  // No route, or one of several between the same pair: bow the line out by a fixed
  // amount per rank, alternating sides so they fan rather than stack.
  const bow = rank === 0 ? 0 : (Math.ceil(rank / 2) * 22 * (rank % 2 === 1 ? 1 : -1));
  const midX = (start.x + finish.x) / 2;
  const midY = (start.y + finish.y) / 2;
  if (bow === 0) {
    return { d: `M ${start.x} ${start.y} L ${finish.x} ${finish.y}`, labelAt: { x: midX, y: midY }, span };
  }
  const nx = span === 0 ? 0 : -(finish.y - start.y) / span;
  const ny = span === 0 ? 0 : (finish.x - start.x) / span;
  const controlX = midX + nx * bow * 2;
  const controlY = midY + ny * bow * 2;
  return {
    d: `M ${start.x} ${start.y} Q ${controlX} ${controlY} ${finish.x} ${finish.y}`,
    // On a quadratic the curve sits halfway between the midpoint and the control
    labelAt: { x: midX + nx * bow, y: midY + ny * bow },
    span,
  };
}

/** Every coordinate a generated path passes through. */
export function pathExtent(d: string): { minX: number; minY: number; maxX: number; maxY: number } | undefined {
  const numbers = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (numbers.length < 2) return undefined;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    minX = Math.min(minX, numbers[index]);
    maxX = Math.max(maxX, numbers[index]);
    minY = Math.min(minY, numbers[index + 1]);
    maxY = Math.max(maxY, numbers[index + 1]);
  }
  return { minX, minY, maxX, maxY };
}

export function messageSummary(
  data: StructuredSequenceData,
  message: StructuredMessage,
  index: number,
  role: ChangeRole,
): string {
  const name = (id: string) => {
    const participant = data.participants.find((candidate) => candidate.id === id);
    return participant === undefined ? id : displayLabel(participant);
  };
  const said = message.label === undefined || message.label === "" ? "" : `: ${message.label}`;
  return [
    `${index + 1}.`,
    `${name(message.from)} → ${name(message.to)}${said}`,
    message.from === message.to ? "(to itself)" : "",
    role === "unchanged" ? "" : `[${ROLE_LABEL[role]}]`,
    fieldChanges(message).map(changeText).join(", "),
  ]
    .filter((part) => part !== "")
    .join(" ");
}

export function edgeSummary(data: StructuredGraphData, edge: StructuredGraphData["edges"][number], role: ChangeRole): string {
  const name = (id: string) => {
    const node = data.nodes.find((candidate) => candidate.id === id);
    return node === undefined ? id : displayLabel(node);
  };
  const described = edge.label ?? edge.kind;
  return [
    `${name(edge.from)} → ${name(edge.to)}`,
    described === undefined ? "" : `(${described})`,
    role === "unchanged" ? "" : `[${ROLE_LABEL[role]}]`,
    fieldChanges(edge).map(changeText).join(", "),
  ]
    .filter((part) => part !== "")
    .join(" ");
}
