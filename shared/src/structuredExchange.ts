/**
 * The structured-exchange envelope: structured data travelling between a tool and
 * this application, in either direction.
 *
 * The normative contract is `shared/schemas/structured-exchange-1.json`, not this
 * file. These types are derived from it for the convenience of code that has
 * already validated a document; they are not the interchange contract, and an
 * independent producer validates against the schema rather than against them.
 *
 * Two identities live on every element and must not be conflated:
 *   - `id`  is scoped to this envelope. Relationships refer to it, and it means
 *           nothing outside the document it appears in.
 *   - `ref` is the join to something the receiving authority already holds.
 *           Absent means "does not exist there yet".
 */

/** Version-1 schema identifier; the `schema` field must equal this exactly. */
export const STRUCTURED_EXCHANGE_SCHEMA_V1 = "urn:structured-exchange:1";

/** Which presentations exist. Only `graph` and `sequence` may be proposed. */
export type StructuredExchangeKind = "graph" | "sequence" | "table";

/** Kinds a proposal may target: a table is a projection and cannot be applied. */
export const PROPOSABLE_KINDS: readonly StructuredExchangeKind[] = ["graph", "sequence"];

/**
 * What may be proposed, per version.
 *
 * Version 1 calls a table a projection: its rows are anonymous tuples, so there is
 * nothing in one for a change to address, and a producer asking to change "the
 * third row" would be asking about a position rather than a thing. The enriched
 * contract gives a row the two identities every other addressable item has, and a
 * requirements table whose rows can be patched is the reason it does — so under
 * version 2 a table is proposable like anything else.
 *
 * Version 1 documents are unaffected: a version 1 table carrying a target is
 * refused exactly as it was.
 */
export function proposableKinds(schema: string): readonly StructuredExchangeKind[] {
  return schema === STRUCTURED_EXCHANGE_SCHEMA_V2 ? ["graph", "sequence", "table"] : PROPOSABLE_KINDS;
}

/**
 * An element of a graph or a sequence.
 *
 * On an element carrying a `ref`, the declared fields **describe what already
 * exists** — they are there so a reader can recognise it, and applying them
 * changes nothing. A change is stated separately, in `set`.
 *
 * The default runs that way round on purpose. A producer here may be a language
 * model, and it will sometimes forget the ceremony; the question is what that
 * costs. Under the opposite default — declaring a field means setting it — a
 * forgotten marker turns twenty elements included for context into twenty
 * renames the reader approves and the authority applies. Under this one, a
 * forgotten `set` changes nothing and somebody says "it didn't work".
 *
 * An element with no `ref` is new: there is nothing to describe yet, so `label`
 * is simply its value.
 */
export interface StructuredElement {
  id: string;
  ref?: string;
  label?: string;
  kind?: string;
  /**
   * The container this element belongs to, by its envelope-scoped identifier.
   *
   * Membership lives here rather than as a list on the container: an element
   * belongs to one group or to none, which this makes true by construction, and
   * moving it between groups is then an ordinary `set` like any other change.
   */
  container?: string;
  set?: { label?: string; kind?: string; container?: string };
}

/**
 * A named group of elements or participants.
 *
 * Grouping only. Relationships connect elements and cross container boundaries
 * freely; a container has no endpoints of its own, and removing every container
 * from a document leaves the same elements connected the same way.
 *
 * Declared once per envelope and named by its members. It carries no `ref` and
 * no `set`: a container is view structure the producer restates each time, not
 * an artifact the receiving authority holds and a proposal patches.
 *
 * Containers do not nest in version 1 — a member names a container, never a
 * chain of them.
 */
export interface StructuredContainer {
  id: string;
  label: string;
  kind?: string;
}

/**
 * A directed relationship in a graph.
 *
 * `from`/`to` are envelope-scoped element ids and are always present: a
 * relationship's endpoints are its identity, not its state, so they are declared
 * even on a patch and are never read as a request to move it. Re-attaching is a
 * removal plus a creation.
 *
 * `kind` is the producer's own type for the thing — the same opaque field an
 * element carries. The renderer may show it, may tell two otherwise identical
 * relationships apart by it, and may colour by it; it never interprets the value,
 * and the schema never enumerates the possibilities. That vocabulary belongs to
 * the domain, and a consumer is free to map it back onto its own type system.
 */
export interface StructuredEdge {
  from: string;
  to: string;
  kind?: string;
  ref?: string;
  label?: string;
  set?: { kind?: string; label?: string };
}

/** One message of a sequence. Endpoints are identity, as for a relationship. */
export interface StructuredMessage {
  from: string;
  to: string;
  ref?: string;
  label?: string;
  set?: { label?: string };
}

export interface StructuredGraphData {
  nodes: StructuredElement[];
  edges: StructuredEdge[];
  containers?: StructuredContainer[];
}

export interface StructuredSequenceData {
  participants: StructuredElement[];
  messages: StructuredMessage[];
  containers?: StructuredContainer[];
}

export type StructuredTableCell = string | number | boolean | null;

/**
 * What a row plays in the change the table projects.
 *
 * Declared rather than derived, unlike an element's: a table has no identity per
 * row to join against a target, so there is nothing to derive it from. It is an
 * observation the producer made about the authority it read, and nothing in this
 * application acts on it.
 */
export type StructuredTableRowRole = "added" | "changed" | "context" | "removed";

/**
 * A row, in either of the two forms version 1 accepts.
 *
 * The bare array is what every document written before roles existed carries, and
 * it stays valid for the life of this version. Read one through `readTableRow`
 * rather than by testing which form it is.
 */
export type StructuredTableRow =
  | StructuredTableCell[]
  | { cells: StructuredTableCell[]; role?: StructuredTableRowRole };

export interface StructuredTableData {
  columns: string[];
  rows: StructuredTableRow[];
}

/**
 * The one place the two row forms are told apart.
 *
 * Validation, rendering, the textual equivalent and the export all read a row
 * through this, so the union costs one function rather than a test at every use —
 * and a row whose cells were read as `undefined` cannot reach a length check.
 */
export function readTableRow(row: StructuredTableRow): {
  cells: StructuredTableCell[];
  role?: StructuredTableRowRole;
  /** A heading that organises the table. It spans the columns rather than filling them. */
  heading?: string;
} {
  if (Array.isArray(row)) return { cells: row };
  // A structural row carries a heading and no cells at all. Reading it as a row of
  // zero values would refuse it against every table that declares a column, which
  // is the alignment rule punishing a row it was never about.
  const heading = (row as { heading?: unknown }).heading;
  if (typeof heading === "string") return { cells: [], role: row.role, heading };
  return { cells: row.cells, role: row.role };
}

export type StructuredExchangeData = StructuredGraphData | StructuredSequenceData | StructuredTableData;

/**
 * A declared removal. A reference alone does not say what it names — the same
 * string may identify an element in one collection and a relationship in another —
 * so a removal always says which.
 */
export interface StructuredRemoval {
  type: "element" | "relationship";
  ref: string;
  /**
   * What is being removed, described so a reader can recognise it.
   *
   * `ref` identifies; these describe, and nothing here is interpreted — the same
   * split the rest of the contract uses. They matter because this application holds
   * one document and not the authority's model, so it cannot look up what a
   * reference stood for. Without them the approval gate shows "relationship: MSG-9"
   * and asks a reader to approve deleting something they cannot see.
   */
  label?: string;
  kind?: string;
  from?: string;
  to?: string;
}

/**
 * The envelope.
 *
 * `target` decides what the document is: present makes it a patch of that
 * artifact, absent makes it a complete new one. Never inferred from whether
 * references happen to appear — a proposal that only adds elements carries none,
 * and reading that as "start over" would misread the most ordinary proposal there
 * is.
 */
export interface StructuredExchangeEnvelope {
  schema: typeof STRUCTURED_EXCHANGE_SCHEMA_V1;
  kind: StructuredExchangeKind;
  target?: string;
  removals?: StructuredRemoval[];
  data: StructuredExchangeData;
}

/** A validated envelope, narrowed to the data variant its kind declares. */
export type ValidatedStructuredExchange =
  | (StructuredExchangeEnvelope & { kind: "graph"; data: StructuredGraphData })
  | (StructuredExchangeEnvelope & { kind: "sequence"; data: StructuredSequenceData })
  | (StructuredExchangeEnvelope & { kind: "table"; data: StructuredTableData });

/** True when the envelope proposes a change to something that already exists. */
export function isProposal(envelope: StructuredExchangeEnvelope): boolean {
  return envelope.target !== undefined;
}

/**
 * The bounds the schema enforces. Mirrored here so code can report a limit
 * without re-reading the schema, and asserted against it by test so the two
 * cannot drift.
 *
 * These are *ceilings*: stable for the life of schema version 1, and what any
 * producer may assume is accepted wherever version 1 is supported. A deployment
 * may apply a stricter operational limit; it may never raise one.
 */
export const STRUCTURED_EXCHANGE_CEILINGS = {
  nodes: 500,
  edges: 2000,
  participants: 100,
  messages: 1000,
  columns: 50,
  rows: 5000,
  removals: 500,
  ref: 200,
  localId: 200,
  label: 500,
  kind: 100,
  /**
   * Distinct types per vocabulary, counted independently for elements and for
   * relationships.
   *
   * Not a storage bound — it is what a reader can be shown. A rendering tells types
   * apart by a colour and a pattern, which yields sixty-four distinguishable
   * presentations; past that two types are drawn alike, and a rendering that cannot
   * distinguish what a document declares is not an approval gate. Bounding it in the
   * contract is the alternative to letting documents through that no reader could
   * check.
   */
  kindsPerVocabulary: 64,
  columnName: 200,
  cell: 1000,
} as const;

/** The enriched contract's identifier. Version 1 documents keep theirs untouched. */
export const STRUCTURED_EXCHANGE_SCHEMA_V2 = "urn:structured-exchange:2";

/**
 * What the enriched contract adds to the ceilings above.
 *
 * Version 1's ceilings carry over unchanged — the enriched contract only adds, so
 * a bound that already exists keeps the number producers were told. Everything
 * here bounds something version 1 had no word for.
 *
 * The values are not new judgements where an old one fits: an opaque identifier is
 * bounded like `ref`, a name like `localId`, a free string like `cell`, a type like
 * `kind`, a heading like `label`. A reader learns one set of magnitudes, not two.
 */
export const STRUCTURED_EXCHANGE_CEILINGS_2 = {
  /** The vocabulary's opaque identifier, bounded like any other opaque reference. */
  profile: 200,
  /** Attributes one addressable item may carry, and one may propose to remove. */
  attributesPerItem: 50,
  removeAttributesPerItem: 50,
  attributeName: 200,
  /** A string attribute value, bounded like a table cell. */
  attributeString: 1000,
  /** A list attribute holds scalars or references, and never another list. */
  attributeListItems: 50,
  /** The revision a target names, and the one a location may pin — opaque both. */
  revision: 200,
  /** Locations are navigation hints; a handful per item is a hint, fifty is a file listing. */
  locationsPerItem: 10,
  uri: 2000,
  /**
   * A zero-based position inside a resource. Bounded so a range is a number rather
   * than an assertion about a file nobody has opened — a million lines is past any
   * source file a reader is going to navigate into.
   */
  position: 1_000_000,
  artifactsPerItem: 20,
  artifactsPerDocument: 50,
  /** What the link is to the item, in the profile's words: bounded like a kind. */
  artifactRel: 100,
  artifactMediaType: 100,
  artifactLabel: 500,
  /** `sha256:` and sixty-four hexadecimal characters. Fixed, not a maximum. */
  artifactDigest: 71,
  /** Relations between the rows of one table, bounded like a graph's relationships. */
  relations: 2000,
  /** A structural row's heading, bounded like a label, and how deep they may nest. */
  heading: 500,
  headingDepth: 6,
  /**
   * Named readings a graph may declare. Generous for choices a reader makes from a
   * control; a document past it is using viewpoints as data. The kinds one viewpoint
   * retains are bounded by `kindsPerVocabulary`, since it cannot retain more kinds than
   * a vocabulary can hold apart, and its label by `label`.
   */
  viewpoints: 20,
  /** What a viewpoint is for, stated inside every figure drawn for it. */
  viewpointConcern: 500,
} as const;

/**
 * Largest enriched document, in bytes of its serialized form.
 *
 * Twice version 1's, because enrichment is per item: a table at the row ceiling
 * whose rows carry an identity, a kind and a few attributes passes every
 * collection ceiling the schema declares and lands past four megabytes. A schema
 * that calls such a document legal while the gate in front of it refuses to read
 * one is not one contract but two that disagree.
 *
 * It remains the binding constraint, and the only one applied before parsing —
 * which is the whole reason it exists.
 */
export const STRUCTURED_EXCHANGE_BYTES_CEILING_2 = 8_000_000;

// ---------------------------------------------------------------------------
// The enriched contract's shapes
//
// Mirrored from `shared/schemas/structured-exchange-2.json`, which is normative,
// the way version 1's shapes above are mirrored from its own schema — and held to
// it by the same drift tests. A generator would be the other way to keep these in
// step; it would add a build step this repository does not have, to produce
// declarations no wider than these, and the drift test is what actually does the
// proving either way.
// ---------------------------------------------------------------------------

/** Something owned elsewhere, named by the identifier its authority knows. Never parsed. */
export interface StructuredReference {
  ref: string;
}

export type StructuredAttributeScalar = string | number | boolean | null;

/** A scalar, an opaque reference, or one flat list of those. Lists never nest. */
export type StructuredAttributeValue =
  | StructuredAttributeScalar
  | StructuredReference
  | (StructuredAttributeScalar | StructuredReference)[];

/** Domain-owned properties. The names belong to the profile's vocabulary, not to this contract. */
export type StructuredAttributes = Record<string, StructuredAttributeValue>;

/** A zero-based range inside a resource. Ordering is checked after the schema. */
export interface StructuredRange {
  startLine: number;
  startCharacter?: number;
  endLine: number;
  endCharacter?: number;
}

/** Where an item can be found — a hint for a reader, never an identity. */
export interface StructuredLocation {
  uri: string;
  revision?: string;
  range?: StructuredRange;
}

/** A related artifact, named rather than carried, and bound to the bytes it was approved against. */
export interface StructuredArtifact {
  rel: string;
  uri: string;
  /** `sha256:` and sixty-four hexadecimal characters. */
  sha256: string;
  mediaType?: string;
  label?: string;
}

/** What the producer believes is true right now, for the receiving authority to check. */
export interface StructuredExpectation {
  label?: string;
  kind?: string;
  container?: string;
  revision?: string;
  attributes?: StructuredAttributes;
}

/** The enrichment every addressable item may carry. */
export interface StructuredEnrichment {
  attributes?: StructuredAttributes;
  expect?: StructuredExpectation;
  locations?: StructuredLocation[];
  artifacts?: StructuredArtifact[];
}

/** The artifact a proposal changes, and the revision it was prepared against. */
export interface StructuredTarget {
  ref: string;
  revision?: string;
}

/**
 * One end of a relation: a row of this document, or something outside it.
 *
 * Stated explicitly rather than as a bare string, so an endpoint naming a row that
 * does not exist is an error rather than silently reread as a reference to
 * somewhere else.
 */
export type StructuredEndpoint = { id: string; ref?: never } | { ref: string; id?: never };

/** Traceability between rows: the same relationship vocabulary, allowed to leave the document. */
export interface StructuredRelation {
  from: StructuredEndpoint;
  to: StructuredEndpoint;
  kind: string;
  ref?: string;
  label?: string;
  attributes?: StructuredAttributes;
}

/** A row of data, which may carry an identity of its own and everything that follows from one. */
export interface StructuredDataRow extends StructuredEnrichment {
  cells: StructuredTableCell[];
  role?: StructuredTableRowRole;
  id?: string;
  ref?: string;
  kind?: string;
  label?: string;
  set?: Record<string, unknown>;
}

/** A heading that organises the table — a chapter — rather than a row of data. */
export interface StructuredStructuralRow {
  heading: string;
  depth?: number;
  role?: StructuredTableRowRole;
  id?: string;
  ref?: string;
}

export type StructuredEnrichedTableRow = StructuredTableCell[] | StructuredDataRow | StructuredStructuralRow;

/**
 * A named reading of a graph: the concern it frames, and the kinds that address it.
 *
 * An inclusion rather than a list of things to hide, so a kind added to the model
 * later is not shown in it unannounced. A vocabulary it names no kinds for is left
 * whole — a viewpoint retaining only element kinds still shows the relationships
 * among what it shows.
 */
export interface StructuredViewpoint {
  id: string;
  label: string;
  concern: string;
  elementKinds?: string[];
  relationshipKinds?: string[];
}

/** True for the row variant that is a heading rather than data. */
export function isStructuralRow(row: StructuredEnrichedTableRow): row is StructuredStructuralRow {
  return !Array.isArray(row) && typeof (row as StructuredStructuralRow).heading === "string";
}

/** Every version of the contract this build validates against, newest last. */
export const STRUCTURED_EXCHANGE_SUPPORTED_SCHEMAS = [
  STRUCTURED_EXCHANGE_SCHEMA_V1,
  STRUCTURED_EXCHANGE_SCHEMA_V2,
] as const;

export type StructuredExchangeSchemaId = (typeof STRUCTURED_EXCHANGE_SUPPORTED_SCHEMAS)[number];

/**
 * Which contract a document asks to be judged by — its own declaration, and
 * nothing else.
 *
 * Not the shape it appears to have: a document carrying `relations` is not
 * thereby version 2, and one carrying none is not thereby version 1. Inferring
 * the version from the content would make the identifier decorative and would
 * let a document be accepted under a contract its producer never claimed.
 */
export function supportedSchemaOf(declared: string | undefined): StructuredExchangeSchemaId | undefined {
  return STRUCTURED_EXCHANGE_SUPPORTED_SCHEMAS.find((supported) => supported === declared);
}
