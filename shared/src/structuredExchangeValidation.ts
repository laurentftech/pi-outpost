/**
 * The relational half of validation.
 *
 * JSON Schema decides shape; these are the rules it cannot express — that
 * identifiers are unique, that an endpoint resolves to something declared, that a
 * row matches its columns, that the declared kind agrees with the data, and that
 * a proposal does not state two intentions about the same thing at once.
 *
 * Pure and deterministic on purpose: the same code answers for the application,
 * for the reference command-line interface, and for anything else that needs the
 * verdict. Neither stage may repair, complete, or guess — a document that fails
 * yields no structured result, and the diagnostics say why so the producer can
 * fix it and try again.
 */
import {
  proposableKinds,
  readTableRow,
  STRUCTURED_EXCHANGE_CEILINGS,
  type StructuredContainer,
  type StructuredElement,
  type StructuredExchangeEnvelope,
  type StructuredGraphData,
  type StructuredSequenceData,
  type StructuredTableData,
  type ValidatedStructuredExchange,
} from "./structuredExchange.ts";

/**
 * One reason a document was refused.
 *
 * `path` is a JSON Pointer into the document, so a producer can be told where to
 * look rather than what we think it meant. `limit`/`observed` are populated when a
 * bound was exceeded, because "too large" without both numbers is not something an
 * operator can act on.
 */
export interface StructuredExchangeIssue {
  /** Stable machine-readable identifier for the rule that was broken. */
  rule: string;
  /** JSON Pointer to the offending value. */
  path: string;
  message: string;
  limit?: number;
  observed?: number;
  /** Which bound refused it: the schema's ceiling, or this deployment's own. */
  level?: "ceiling" | "deployment";
}

export type StructuredExchangeVerdict =
  | { valid: true; envelope: ValidatedStructuredExchange; issues: [] }
  | { valid: false; issues: StructuredExchangeIssue[] };

/** The data variant each kind must carry. */
function dataMatchesKind(envelope: StructuredExchangeEnvelope): boolean {
  const data = envelope.data as unknown as Record<string, unknown>;
  if (envelope.kind === "graph") return Array.isArray(data.nodes) && Array.isArray(data.edges);
  if (envelope.kind === "sequence") return Array.isArray(data.participants) && Array.isArray(data.messages);
  return Array.isArray(data.columns) && Array.isArray(data.rows);
}

/** The elements of a graph or a sequence, whichever this is. */
function elementsOf(envelope: StructuredExchangeEnvelope): StructuredElement[] {
  if (envelope.kind === "graph") return (envelope.data as StructuredGraphData).nodes;
  if (envelope.kind === "sequence") return (envelope.data as StructuredSequenceData).participants;
  return [];
}

/** The relationships of a graph or a sequence, as endpoint pairs with their refs. */
function relationshipsOf(envelope: StructuredExchangeEnvelope): { from: string; to: string; ref?: string; set?: object }[] {
  if (envelope.kind === "graph") return (envelope.data as StructuredGraphData).edges;
  if (envelope.kind === "sequence") return (envelope.data as StructuredSequenceData).messages;
  return [];
}

/** The containers of a graph or a sequence. Absent everywhere else. */
function containersOf(envelope: StructuredExchangeEnvelope): StructuredContainer[] {
  if (envelope.kind === "graph") return (envelope.data as StructuredGraphData).containers ?? [];
  if (envelope.kind === "sequence") return (envelope.data as StructuredSequenceData).containers ?? [];
  return [];
}

/** Where the elements live in the document, for pointing at them. */
function elementsPointer(envelope: StructuredExchangeEnvelope): string {
  return envelope.kind === "graph" ? "/data/nodes" : "/data/participants";
}

function relationshipsPointer(envelope: StructuredExchangeEnvelope): string {
  return envelope.kind === "graph" ? "/data/edges" : "/data/messages";
}

/**
 * Every relational rule, in one pass per rule so a document that breaks several
 * is told about all of them. A producer fixing one issue at a time and being
 * refused again for the next is a producer that gives up.
 */


/**
 * Everything in this envelope that can carry enrichment, with the pointer naming it.
 *
 * The enriched contract hangs the same five things — attributes, a patch, an
 * expectation, locations, artifact links — off items that were unrelated in
 * version 1: an element, a relationship, a row, a relation between rows. Walking
 * them through one list is what keeps a rule from applying to three of the four
 * because the fourth was added later.
 */
interface EnrichedItem {
  at: string;
  ref?: string;
  set?: { attributes?: Record<string, unknown>; removeAttributes?: unknown };
  expect?: unknown;
  locations?: unknown;
}

function enrichedItemsOf(envelope: StructuredExchangeEnvelope): EnrichedItem[] {
  const data = envelope.data as unknown as Record<string, unknown>;
  const items: EnrichedItem[] = [];
  for (const collection of ["nodes", "edges", "participants", "messages", "rows", "relations"]) {
    const held = data[collection];
    if (!Array.isArray(held)) continue;
    held.forEach((entry, index) => {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return;
      const item = entry as Record<string, unknown>;
      items.push({
        at: `/data/${collection}/${index}`,
        ref: typeof item.ref === "string" ? item.ref : undefined,
        set: item.set as EnrichedItem["set"],
        expect: item.expect,
        locations: item.locations,
      });
    });
  }
  return items;
}

/**
 * The rows of a table, as things a proposal can address.
 *
 * Version 2 made a table proposable and gave its rows a `ref` and a `set`. Every
 * rule about addressing — one intention per thing, a change needs something to
 * change, a change needs a target — was built from `elementsOf` and
 * `relationshipsOf`, both of which answer `[]` for a table. So the one item type
 * this contract exists to make patchable was the one nothing checked.
 */
function addressableRowsOf(envelope: StructuredExchangeEnvelope): { at: string; ref?: string; set?: object }[] {
  if (envelope.kind !== "table") return [];
  const rows = (envelope.data as StructuredTableData).rows as unknown[];
  const addressable: { at: string; ref?: string; set?: object }[] = [];
  rows.forEach((row, index) => {
    if (row === null || typeof row !== "object" || Array.isArray(row)) return;
    const item = row as { ref?: unknown; set?: unknown };
    if (item.ref === undefined && item.set === undefined) return;
    addressable.push({
      at: `/data/rows/${index}`,
      ...(typeof item.ref === "string" ? { ref: item.ref } : {}),
      ...(item.set !== undefined ? { set: item.set as object } : {}),
    });
  });
  return addressable;
}

/** The rows of a table that carry an identity, and can therefore be pointed at. */
function identifiedRowsOf(envelope: StructuredExchangeEnvelope): { id: string; at: string }[] {
  if (envelope.kind !== "table") return [];
  const rows = (envelope.data as StructuredTableData).rows as unknown[];
  const identified: { id: string; at: string }[] = [];
  rows.forEach((row, index) => {
    if (row === null || typeof row !== "object" || Array.isArray(row)) return;
    const id = (row as { id?: unknown }).id;
    if (typeof id === "string") identified.push({ id, at: `/data/rows/${index}` });
  });
  return identified;
}

/** The relations a table declares between its rows. */
function rowRelationsOf(envelope: StructuredExchangeEnvelope): { from?: unknown; to?: unknown }[] {
  if (envelope.kind !== "table") return [];
  const relations = (envelope.data as { relations?: unknown }).relations;
  return Array.isArray(relations) ? (relations as { from?: unknown; to?: unknown }[]) : [];
}

export function validateStructuredExchangeSemantics(envelope: StructuredExchangeEnvelope): StructuredExchangeIssue[] {
  const issues: StructuredExchangeIssue[] = [];

  if (!dataMatchesKind(envelope)) {
    issues.push({
      rule: "kind-data-mismatch",
      path: "/data",
      message: `data does not carry what kind "${envelope.kind}" declares`,
    });
    // Every rule below reads the data through its kind; with the two disagreeing
    // there is nothing further that can be said honestly.
    return issues;
  }

  const proposable = proposableKinds(envelope.schema).includes(envelope.kind);
  if (envelope.target !== undefined && !proposable) {
    issues.push({
      rule: "kind-not-proposable",
      path: "/target",
      message: `a ${envelope.kind} is a projection and cannot be proposed, so it carries no target`,
    });
  }
  // Presence is the assertion, not length. An empty `removals` on a projection still
  // claims the document is a proposal, and a producer that sends one has misunderstood
  // the contract in a way worth telling them about rather than quietly tolerating.
  if (envelope.removals !== undefined) {
    if (!proposable) {
      issues.push({
        rule: "kind-not-proposable",
        path: "/removals",
        message: `a ${envelope.kind} is a projection and cannot be proposed, so it declares no removals`,
      });
    } else if (envelope.target === undefined) {
      issues.push({
        rule: "removal-without-target",
        path: "/removals",
        message: "removals need a target: an artifact that does not exist yet has nothing to remove",
      });
    }
  }

  const elements = elementsOf(envelope);
  const elementsAt = elementsPointer(envelope);

  // Unique envelope-scoped identifiers. Duplicates would make an endpoint
  // ambiguous, and picking one of them is exactly the kind of guess that is
  // forbidden here.
  const seenIds = new Map<string, number>();
  elements.forEach((element, index) => {
    const first = seenIds.get(element.id);
    if (first === undefined) seenIds.set(element.id, index);
    else {
      issues.push({
        rule: "duplicate-identifier",
        path: `${elementsAt}/${index}/id`,
        message: `identifier "${element.id}" is already declared at ${elementsAt}/${first}`,
      });
    }
  });

  // Container identifiers are unique too, and for the same reason: a membership
  // naming a duplicated container names two groups at once, and choosing one of
  // them is the guess this stage exists to refuse.
  const seenContainers = new Map<string, number>();
  containersOf(envelope).forEach((container, index) => {
    const first = seenContainers.get(container.id);
    if (first === undefined) seenContainers.set(container.id, index);
    else {
      issues.push({
        rule: "duplicate-container-identifier",
        path: `/data/containers/${index}/id`,
        message: `container "${container.id}" is already declared at /data/containers/${first}`,
      });
    }
  });

  // Every membership names a container this envelope declares. Dropping an
  // unresolved one instead would render the element ungrouped, which states
  // something about the system that the document does not.
  elements.forEach((element, index) => {
    for (const [field, named] of [["container", element.container], ["set/container", element.set?.container]] as const) {
      if (named !== undefined && !seenContainers.has(named)) {
        issues.push({
          rule: "unresolved-container",
          path: `${elementsAt}/${index}/${field}`,
          message: `"${named}" is not a container declared in /data/containers`,
        });
      }
    }
  });

  // Endpoints resolve to something declared in this envelope — never to a ref,
  // which belongs to the external authority and means nothing locally.
  const relationshipsAt = relationshipsPointer(envelope);
  relationshipsOf(envelope).forEach((relationship, index) => {
    for (const side of ["from", "to"] as const) {
      const endpoint = relationship[side];
      if (!seenIds.has(endpoint)) {
        issues.push({
          rule: "unresolved-endpoint",
          path: `${relationshipsAt}/${index}/${side}`,
          message: `"${endpoint}" is not an identifier declared in ${elementsAt}`,
        });
      }
    }
  });

  // One intention per thing. Local identifiers are unique, but two elements may
  // still carry the *same* reference — two instructions about one thing in the
  // authority, with no way to say which wins. Removals count: a reference that is
  // both changed and removed is the same ambiguity spelled differently, and is
  // refused here rather than resolved by precedence.
  const claimed = new Map<string, string>();
  const claim = (type: "element" | "relationship" | "row", ref: string | undefined, at: string) => {
    if (ref === undefined) return;
    const key = `${type}:${ref}`;
    const first = claimed.get(key);
    if (first === undefined) claimed.set(key, at);
    else {
      issues.push({
        rule: "duplicate-reference",
        path: at,
        message: `${type} "${ref}" is already addressed at ${first}; a proposal states one intention per thing`,
      });
    }
  };
  elements.forEach((element, index) => claim("element", element.ref, `${elementsAt}/${index}`));
  relationshipsOf(envelope).forEach((relationship, index) => claim("relationship", relationship.ref, `${relationshipsAt}/${index}`));
  addressableRowsOf(envelope).forEach((row) => claim("row", row.ref, row.at));
  (envelope.removals ?? []).forEach((removal, index) => claim(removal.type, removal.ref, `/removals/${index}`));

  // A change has to have something to change. `set` without a `ref` names no
  // element the authority holds, and would be a creation wearing a patch's
  // clothes — refused rather than read as one or the other.
  const changeables: { at: string; ref?: string; set?: object }[] = [
    ...elements.map((element, index) => ({ at: `${elementsAt}/${index}`, ref: element.ref, set: element.set })),
    ...relationshipsOf(envelope).map((relationship, index) => ({
      at: `${relationshipsPointer(envelope)}/${index}`,
      ref: relationship.ref,
      set: relationship.set,
    })),
    ...addressableRowsOf(envelope),
  ];
  for (const candidate of changeables) {
    if (candidate.set === undefined) continue;
    if (candidate.ref === undefined) {
      issues.push({
        rule: "change-without-reference",
        path: `${candidate.at}/set`,
        message: "a change names a reference to change; without one this is a new thing, and its fields are its values",
      });
    } else if (!proposable) {
      issues.push({
        rule: "kind-not-proposable",
        path: `${candidate.at}/set`,
        message: `a ${envelope.kind} is a projection and cannot be proposed, so nothing in it declares a change`,
      });
    } else if (envelope.target === undefined) {
      // `target` is the whole of what makes a document a proposal, and the reader's
      // rendering keys every "added"/"changed" mark off it. A `set` without one asks
      // an authority to mutate something while the envelope claims to describe a new
      // artifact, and it draws as an unremarkable box: a mutation nobody was shown.
      issues.push({
        rule: "change-without-target",
        path: `${candidate.at}/set`,
        message:
          "a change needs a target: naming what is being changed is what makes this a proposal rather than a new artifact",
      });
    }
  }

  /**
   * Distinct types, per vocabulary, counted independently.
   *
   * The ceiling is what a reader can be shown apart, not what fits in memory: types
   * are distinguished by a colour and a pattern, sixty-four combinations, and past
   * that two of them are drawn alike. A document a reader cannot check is not one to
   * accept quietly.
   */
  const countKinds = (things: { kind?: string }[]): Set<string> => {
    const seen = new Set<string>();
    for (const thing of things) if (thing.kind !== undefined && thing.kind !== "") seen.add(thing.kind);
    return seen;
  };
  const vocabularies: [string, string, Set<string>][] = [
    [envelope.kind === "sequence" ? "participant" : "element", elementsAt, countKinds(elements)],
    [
      envelope.kind === "sequence" ? "message" : "relationship",
      relationshipsPointer(envelope),
      countKinds(relationshipsOf(envelope) as { kind?: string }[]),
    ],
  ];
  for (const [noun, at, kinds] of vocabularies) {
    if (kinds.size > STRUCTURED_EXCHANGE_CEILINGS.kindsPerVocabulary) {
      issues.push({
        rule: "too-many-kinds",
        path: at,
        message: `${kinds.size} distinct ${noun} types, and no more than ${STRUCTURED_EXCHANGE_CEILINGS.kindsPerVocabulary} can be told apart in a rendering`,
        observed: kinds.size,
        limit: STRUCTURED_EXCHANGE_CEILINGS.kindsPerVocabulary,
      });
    }
  }

  // Rows align to the columns they declare. A short row is not padded and a long
  // one is not trimmed; either would invent data the producer did not send.
  if (envelope.kind === "table") {
    const { columns, rows } = envelope.data as StructuredTableData;
    rows.forEach((row, index) => {
      // Through the reader, not off the row: a row carrying a role is an object,
      // and `.length` on one is `undefined`, which compares unequal to every
      // column count and refused every role-carrying table ever written.
      const { cells, heading } = readTableRow(row);
      // A heading is not a row of data: it spans the table, so it has nothing to
      // align to its columns. Exempting it here is what lets a table carry the
      // chapters of a document without every one of them being refused.
      if (heading !== undefined) return;
      if (cells.length !== columns.length) {
        issues.push({
          rule: "row-column-mismatch",
          path: `/data/rows/${index}`,
          message: `row has ${cells.length} values but ${columns.length} columns are declared`,
          observed: cells.length,
          limit: columns.length,
        });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // The enriched contract's own rules
  // ---------------------------------------------------------------------------

  for (const item of enrichedItemsOf(envelope)) {
    // An expectation is a claim about what the authority holds right now, for it to
    // check before applying. With no target there is no authority to check it, and
    // with no reference there is nothing there to compare it against — in both cases
    // the producer has written a condition nobody can evaluate.
    if (item.expect !== undefined) {
      if (envelope.target === undefined) {
        issues.push({
          rule: "expectation-without-target",
          path: `${item.at}/expect`,
          message:
            "an expectation is checked by the authority a proposal targets; a document that targets nothing has nobody to check it",
        });
      } else if (item.ref === undefined) {
        issues.push({
          rule: "expectation-without-reference",
          path: `${item.at}/expect`,
          message: "an expectation describes something that already exists, and this item carries no reference to one",
        });
      }
    }

    const removals = item.set?.removeAttributes;
    if (Array.isArray(removals)) {
      const assigned = item.set?.attributes ?? {};
      const seen = new Map<string, number>();
      removals.forEach((name, index) => {
        if (typeof name !== "string") return;
        const first = seen.get(name);
        if (first === undefined) seen.set(name, index);
        else {
          issues.push({
            rule: "duplicate-attribute-removal",
            path: `${item.at}/set/removeAttributes/${index}`,
            message: `"${name}" is already removed at ${item.at}/set/removeAttributes/${first}`,
          });
        }
        // Assigned and removed at once states two intentions about one property, and
        // resolving it by precedence would be this stage guessing.
        if (Object.prototype.hasOwnProperty.call(assigned, name)) {
          issues.push({
            rule: "attribute-set-and-removed",
            path: `${item.at}/set/removeAttributes/${index}`,
            message: `"${name}" is both assigned and removed; a proposal states one intention per property`,
          });
        }
      });
    }

    // A range that ends before it starts points at nothing. JSON Schema can bound
    // each position and cannot compare two of them, which is why this is here.
    if (Array.isArray(item.locations)) {
      item.locations.forEach((location, index) => {
        if (location === null || typeof location !== "object") return;
        const range = (location as { range?: Record<string, number> }).range;
        if (range === undefined) return;
        const startsAfter =
          range.endLine < range.startLine ||
          (range.endLine === range.startLine &&
            range.endCharacter !== undefined &&
            range.startCharacter !== undefined &&
            range.endCharacter < range.startCharacter);
        if (startsAfter) {
          issues.push({
            rule: "location-range-reversed",
            path: `${item.at}/locations/${index}/range`,
            message: "a range ends before it begins, so it selects nothing a reader could be taken to",
          });
        }
      });
    }
  }

  // A row reports or it asks, never both.
  //
  // `role` says what the producer observed in the authority it projected: a record,
  // which nothing here acts on. `set` says what the producer wants done: an
  // instruction, which an authority will apply. On one row the two can disagree —
  // "I saw this unchanged" beside "change it" — and deciding which wins would be
  // this stage inventing a precedence nobody published. In a proposal the role is
  // a consequence anyway: a reference with a patch is a change, one without a
  // reference is an addition, and a removal is named in `removals`.
  if (envelope.kind === "table") {
    const rows = (envelope.data as StructuredTableData).rows as unknown[];
    rows.forEach((entry, index) => {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return;
      const rowItem = entry as { role?: unknown; set?: unknown };
      if (rowItem.role !== undefined && rowItem.set !== undefined) {
        issues.push({
          rule: "role-with-change",
          path: `/data/rows/${index}/role`,
          message:
            "a row states what it observed or what it asks for, not both: a declared role beside a change is a report and an instruction at once",
        });
      }
    });
  }

  // A row that carries an identity is addressable, and two rows sharing one make
  // every relation that names it ambiguous — the same reason elements are unique.
  const rowIds = new Map<string, string>();
  for (const row of identifiedRowsOf(envelope)) {
    const first = rowIds.get(row.id);
    if (first === undefined) rowIds.set(row.id, row.at);
    else {
      issues.push({
        rule: "duplicate-identifier",
        path: `${row.at}/id`,
        message: `identifier "${row.id}" is already declared at ${first}`,
      });
    }
  }

  // Traceability resolves, or says plainly that it does not. An end naming a row of
  // this document must find it; an end naming a `ref` belongs to another authority
  // and is accepted unresolved, because the test that verifies a requirement
  // usually lives somewhere this document cannot see.
  rowRelationsOf(envelope).forEach((relation, index) => {
    for (const side of ["from", "to"] as const) {
      const endpoint = relation[side];
      if (endpoint === null || typeof endpoint !== "object") continue;
      const named = (endpoint as { id?: unknown }).id;
      if (typeof named !== "string") continue;
      if (!rowIds.has(named)) {
        issues.push({
          rule: "unresolved-endpoint",
          path: `/data/relations/${index}/${side}`,
          message: `"${named}" is not the identifier of any row this document declares`,
        });
      }
    }
  });

  return issues;
}
