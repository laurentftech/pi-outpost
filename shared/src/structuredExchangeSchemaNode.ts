/**
 * The Node-side schema check: full diagnostics, no size budget.
 *
 * Used by the server and by the reference command-line interface — the two places
 * where someone is going to have to act on a refusal. The browser gets a smaller
 * check generated from the same schema; see the build step for that one.
 *
 * Carries the whole compiler, so it is Node-only by weight rather than by API —
 * the browser gets a generated check instead.
 */
import { Compile } from "typebox/compile";
// Imported, not read from disk. The runtime has to validate against its committed
// copy wherever it is deployed, and this product ships as a bundle: a path
// relative to this module resolves inside the repository and nowhere else, so a
// filesystem read works in every test and fails on the first real install.
import schemaModuleV1 from "../schemas/structured-exchange-1.json" with { type: "json" };
import schemaModuleV2 from "../schemas/structured-exchange-2.json" with { type: "json" };
import { declaredSchemaOf } from "./structuredExchangeDocument.ts";
import {
  STRUCTURED_EXCHANGE_SCHEMA_V1,
  STRUCTURED_EXCHANGE_SUPPORTED_SCHEMAS,
  supportedSchemaOf,
  type StructuredExchangeSchemaId,
} from "./structuredExchange.ts";
import type { StructuredExchangeSchemaCheck } from "./structuredExchangeParse.ts";
import type { StructuredExchangeIssue } from "./structuredExchangeValidation.ts";

/**
 * The same JSON, whatever loader delivered it.
 *
 * Node and esbuild hand back the object itself. jiti — which is what pi uses to
 * load an extension, and therefore how this module is reached in RPC mode — adds
 * an interop `default` property pointing at *the object itself*. `default` is a
 * real JSON Schema keyword, so the compiler descends into it, finds the whole
 * schema again, and recurses until the stack is gone: every document was refused
 * with "Maximum call stack size exceeded" instead of being validated.
 *
 * Only a self-referential `default` is dropped. A genuine `default` keyword is
 * part of the schema and stays.
 */
export function unwrapSchemaModule(module: unknown): Record<string, unknown> {
  const raw = module as Record<string, unknown>;
  // A schema document announces itself; a namespace wrapping one does not. Asking
  // the object what it is keeps a *legitimate* `default` keyword — a string, say —
  // from being mistaken for the payload and returned in place of the schema.
  const looksLikeSchema = "$id" in raw || "type" in raw;
  const root = (looksLikeSchema ? raw : raw.default) as Record<string, unknown>;
  if (root.default !== root) return root;
  const { default: _interop, ...rest } = root;
  return rest;
}

const schemas: Record<StructuredExchangeSchemaId, Record<string, unknown>> = {
  "urn:structured-exchange:1": unwrapSchemaModule(schemaModuleV1),
  "urn:structured-exchange:2": unwrapSchemaModule(schemaModuleV2),
};

const schema: Record<string, unknown> = schemas[STRUCTURED_EXCHANGE_SCHEMA_V1];

/** The committed schema itself, bundled with the code that validates against it. */
export const STRUCTURED_EXCHANGE_SCHEMA: unknown = schema;

/** Every committed schema, by the identifier a document declares to select it. */
export const STRUCTURED_EXCHANGE_SCHEMAS: Readonly<Record<string, unknown>> = schemas;

/**
 * Compiled once, per version. The compiler is the expensive part; the check it
 * produces is not, and every document pays only for the check — including the
 * cost of a version it never uses, which is why these are compiled on first
 * demand rather than at import.
 */
const compiled = new Map<string, ReturnType<typeof Compile>>();

/**
 * The schema with `data` narrowed to the single variant the document's `kind`
 * declares — or the schema as published, when it declares no kind this contract
 * knows.
 *
 * Used to *explain* a refusal, never to decide one. `data` is a `oneOf` across
 * graph, sequence and table: when one branch fails they all do, and TypeBox
 * reports every branch's complaint, so a table whose cell ran past its ceiling was
 * answered with "must have required properties nodes, edges" — a sentence about a
 * diagram nobody sent.
 *
 * Deciding with it would change answers that are already published. A document
 * whose `kind` disagrees with its `data` passes the published schema (the data
 * does match *a* branch) and is refused afterwards by the semantic rule that
 * exists to name exactly that — `kind-data-mismatch`. Narrowed, the schema would
 * refuse it first, and a producer who had been told one thing for a year would be
 * told another.
 */
function schemaFor(version: StructuredExchangeSchemaId, kind: unknown): Record<string, unknown> {
  const published = schemas[version];
  const variants = ((published.properties as Record<string, { oneOf?: unknown[] }>).data?.oneOf ?? []) as Record<
    string,
    { properties?: Record<string, unknown> }
  >[];
  const required: Record<string, string> = { graph: "nodes", sequence: "participants", table: "columns" };
  const marker = typeof kind === "string" ? required[kind] : undefined;
  const variant =
    marker === undefined
      ? undefined
      : variants.find((candidate) => (candidate.properties as Record<string, unknown> | undefined)?.[marker] !== undefined);
  if (variant === undefined) return published;
  return {
    ...published,
    properties: { ...(published.properties as Record<string, unknown>), data: variant },
  };
}

function validator(version: StructuredExchangeSchemaId, kind: unknown): ReturnType<typeof Compile> {
  const key = `${version}:${typeof kind === "string" ? kind : "*"}`;
  const existing = compiled.get(key);
  if (existing !== undefined) return existing;
  // The committed copy, never fetched: validation must not depend on the network
  // being there or on what is at the other end of it.
  const built = Compile(schemaFor(version, kind));
  compiled.set(key, built);
  return built;
}

/**
 * TypeBox reports `params.limit` for the bound keywords, which is exactly what a
 * refusal has to carry to be actionable — the limit that applied, alongside the
 * value that broke it.
 */
function observedFor(keyword: string, value: unknown): number | undefined {
  if (typeof value === "string" && (keyword === "maxLength" || keyword === "minLength")) return value.length;
  if (Array.isArray(value) && (keyword === "maxItems" || keyword === "minItems")) return value.length;
  return undefined;
}

/** Reads a JSON Pointer out of the document, for the observed value in a diagnostic. */
function at(document: unknown, pointer: string): unknown {
  if (pointer === "") return document;
  let current: unknown = document;
  for (const rawSegment of pointer.slice(1).split("/")) {
    if (current === null || typeof current !== "object") return undefined;
    const segment = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~");
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export const checkStructuredExchangeSchema: StructuredExchangeSchemaCheck = (document) => {
  const declared = declaredSchemaOf(document);
  const version = supportedSchemaOf(declared);
  if (version === undefined && declared !== undefined) {
    // A version of this contract that this build does not have. Refused by name
    // rather than by the oldest schema's `const` keyword failing to match: a
    // producer reading "must be equal to constant" learns that one identifier was
    // expected, while this says which contracts exist here — the question they
    // were actually asking.
    //
    // Only for the contract's own family. Anything else is not a structured
    // exchange at all, and is refused exactly as it was before there was a second
    // version to choose between.
    return [
      {
        rule: "unsupported-version",
        path: "/schema",
        message: `this build validates ${STRUCTURED_EXCHANGE_SUPPORTED_SCHEMAS.join(" and ")}`,
      },
    ];
  }
  const issues: StructuredExchangeIssue[] = [];
  const contract = version ?? STRUCTURED_EXCHANGE_SCHEMA_V1;
  // The verdict is the published schema's, always. Only when it refuses is the
  // narrowed one asked, and only for something better to say about it.
  const published = [...validator(contract, undefined).Errors(document)];
  if (published.length === 0) return issues;
  const kind = (document as { kind?: unknown } | null)?.kind;
  const narrowed = [...validator(contract, kind).Errors(document)];
  // Both lists, not the narrower one: a rule a producer has been keying on since
  // the contract was published must not vanish because a second way of asking the
  // same question phrases it differently. The narrowed errors come first and the
  // published ones add whatever rule and place they name that narrowing did not.
  const seen = new Set(narrowed.map((error) => `${error.keyword}@${error.instancePath}`));
  const combined = [
    ...narrowed,
    ...published.filter((error) => !seen.has(`${error.keyword}@${error.instancePath}`)),
  ];
  for (const error of combined) {
    const keyword = String(error.keyword ?? "schema");
    const limit = (error.params as { limit?: number } | undefined)?.limit;
    issues.push({
      rule: `schema/${keyword}`,
      path: error.instancePath ?? "",
      message: error.message ?? "does not conform to the published schema",
      ...(limit !== undefined ? { limit, level: "ceiling" as const } : {}),
      ...(() => {
        const observed = observedFor(keyword, at(document, error.instancePath ?? ""));
        return observed === undefined ? {} : { observed };
      })(),
    });
  }
  // Most specific first. A row is itself a union — an array of cells, a row that
  // carries an identity, or a heading — so a fault inside one still draws a
  // complaint from each shape it is not. Every one of them is kept, because a
  // validator that decides which of its own reasons to show is a validator that
  // can hide the true one; they are ordered instead, so the deepest path — the one
  // naming the value the producer actually got wrong — is the line they read first.
  return issues.sort((left, right) => right.path.split("/").length - left.path.split("/").length);
};
