/**
 * The size bounds, at their two levels.
 *
 * The schema's bounds are a **ceiling**: stable for the life of schema version 1,
 * and what any producer may assume is accepted wherever version 1 is supported.
 * A deployment may apply a stricter **operational limit** — so numbers can be
 * calibrated against real traffic, which is where they will actually be learned,
 * without changing the published contract or forcing a version bump.
 *
 * A limit above its ceiling has no effect. The contract is the outer edge; a
 * deployment can only be more careful than it, never less.
 */
import {
  STRUCTURED_EXCHANGE_BYTES_CEILING_2,
  STRUCTURED_EXCHANGE_CEILINGS,
  STRUCTURED_EXCHANGE_CEILINGS_2,
  STRUCTURED_EXCHANGE_SCHEMA_V2,
} from "./structuredExchange.ts";
import type { StructuredExchangeIssue } from "./structuredExchangeValidation.ts";

/**
 * Largest candidate document, in bytes of its serialized form.
 *
 * Checked *before* parsing, which is the only bound that can be: every other
 * check needs the document in memory to be applied at all, and a bound that only
 * fires after materialising the thing it was meant to keep out is not a bound.
 *
 * The ceiling is derived from what the schema already permits — the largest
 * conforming document is bounded by its collection and string ceilings — with
 * room for structure and whitespace on top.
 */
export const STRUCTURED_EXCHANGE_BYTES_CEILING = 4_000_000;

/**
 * The outer edge, across every version this build validates.
 *
 * The pre-parse gate cannot know which contract a document declares — reading that
 * means parsing it, which is the thing the gate exists to avoid doing to something
 * oversized. So it applies the widest ceiling any supported version allows, and the
 * version's own ceiling is applied once the document is in memory and has said what
 * it is. A version 1 document is still held to version 1's four megabytes; what it
 * loses is only the promise that the refusal arrives before the parse.
 */
export const STRUCTURED_EXCHANGE_BYTES_CEILING_ANY = Math.max(
  STRUCTURED_EXCHANGE_BYTES_CEILING,
  STRUCTURED_EXCHANGE_BYTES_CEILING_2,
);

/** The byte ceiling the declared version promises its producers. */
export function bytesCeilingFor(declared: string | undefined): number {
  return declared === STRUCTURED_EXCHANGE_SCHEMA_V2
    ? STRUCTURED_EXCHANGE_BYTES_CEILING_2
    : STRUCTURED_EXCHANGE_BYTES_CEILING;
}

/** Byte length without Node's Buffer: this module runs in the browser too. */
const utf8Bytes = (value: string): number => new TextEncoder().encode(value).length;

/** What a deployment may tighten. Every field is optional; absent means "the ceiling". */
export interface StructuredExchangeLimits {
  bytes?: number;
  nodes?: number;
  edges?: number;
  participants?: number;
  messages?: number;
  columns?: number;
  rows?: number;
  /** Traceability between a table's rows, which only the enriched contract carries. */
  relations?: number;
}

type BoundedCollection = keyof StructuredExchangeLimits;

/** The ceiling for a bound, including the byte bound the schema cannot express. */
export function ceilingFor(bound: BoundedCollection): number {
  if (bound === "bytes") return STRUCTURED_EXCHANGE_BYTES_CEILING_ANY;
  if (bound === "relations") return STRUCTURED_EXCHANGE_CEILINGS_2.relations;
  return STRUCTURED_EXCHANGE_CEILINGS[bound];
}

/**
 * The limit that actually applies, and which level it came from.
 *
 * A configured limit above the ceiling is ignored rather than honoured: a
 * deployment that tries to accept more than the contract promises would make its
 * producers' validation wrong, which is the one failure a published contract
 * exists to prevent.
 */
export function effectiveLimit(
  bound: BoundedCollection,
  limits: StructuredExchangeLimits | undefined,
): { limit: number; level: "ceiling" | "deployment" } {
  const ceiling = ceilingFor(bound);
  const configured = limits?.[bound];
  if (configured === undefined || configured >= ceiling) return { limit: ceiling, level: "ceiling" };
  return { limit: configured, level: "deployment" };
}

/**
 * The byte bound, applied to the serialized document before anything parses it.
 *
 * Returns the issue that refuses it, or undefined to go ahead.
 */
export function checkDocumentBytes(
  serialized: string,
  limits?: StructuredExchangeLimits,
  /** The version's own ceiling, once it is known. Absent before the parse. */
  declared?: string,
): StructuredExchangeIssue | undefined {
  const observed = utf8Bytes(serialized);
  const outer = effectiveLimit("bytes", limits);
  // Before the parse the ceiling is the widest any version allows; after it, the
  // one the document's own version promises. A deployment limit is stricter than
  // either and wins over both.
  const versioned = declared === undefined ? outer.limit : Math.min(outer.limit, bytesCeilingFor(declared));
  const limit = Math.min(outer.limit, versioned);
  const level = limit === outer.limit && outer.level === "deployment" ? "deployment" : outer.level;
  if (observed <= limit) return undefined;
  return {
    rule: "document-too-large",
    path: "",
    message: `document is ${observed} bytes, past the ${limit}-byte ${level === "ceiling" ? "contract ceiling" : "limit this deployment applies"}`,
    limit,
    observed,
    level,
  };
}

/** Which collection each kind bounds, so the deployment check knows where to look. */
const COLLECTIONS_BY_KIND: Record<string, BoundedCollection[]> = {
  graph: ["nodes", "edges"],
  sequence: ["participants", "messages"],
  table: ["columns", "rows", "relations"],
};

/**
 * The deployment's collection limits, applied after the schema has accepted the
 * document against its ceilings. Only ever stricter, so anything reported here is
 * this installation's choice and says so.
 */
export function checkDeploymentLimits(
  envelope: { kind: string; data: unknown },
  limits: StructuredExchangeLimits | undefined,
): StructuredExchangeIssue[] {
  if (limits === undefined) return [];
  const issues: StructuredExchangeIssue[] = [];
  for (const bound of COLLECTIONS_BY_KIND[envelope.kind] ?? []) {
    const value = (envelope.data as Record<string, unknown>)[bound];
    if (!Array.isArray(value)) continue;
    const { limit, level } = effectiveLimit(bound, limits);
    if (level === "deployment" && value.length > limit) {
      issues.push({
        rule: "collection-past-deployment-limit",
        path: `/data/${bound}`,
        message: `${bound} has ${value.length} entries, past the ${limit} this deployment allows`,
        limit,
        observed: value.length,
        level,
      });
    }
  }
  return issues;
}

/**
 * What an accepted document measured. Recorded so an operational limit can be set
 * from evidence — otherwise "calibrate in production" means waiting for the first
 * refusal to learn the order of magnitude, which is learning it from an outage.
 */
export interface StructuredExchangeMeasurement {
  kind: string;
  bytes: number;
  /** Entry counts per bounded collection this kind carries. */
  counts: Record<string, number>;
}

export function measureAccepted(
  envelope: { kind: string; data: unknown },
  serialized: string,
): StructuredExchangeMeasurement {
  const counts: Record<string, number> = {};
  for (const bound of COLLECTIONS_BY_KIND[envelope.kind] ?? []) {
    const value = (envelope.data as Record<string, unknown>)[bound];
    if (Array.isArray(value)) counts[bound] = value.length;
  }
  return { kind: envelope.kind, bytes: utf8Bytes(serialized), counts };
}
