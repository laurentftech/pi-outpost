/**
 * A structured-exchange document that arrived as a *file* rather than as a tool
 * result.
 *
 * Recognition is by what the document says about itself, never by its name. A
 * `.json` file is one of these because its `schema` field says so, and a document
 * saved as `.diagram` is one for the same reason. Naming would have been cheaper
 * and would have been wrong twice over: it would render JSON that merely happens
 * to be called the right thing, and it would refuse a document that is exactly
 * what it claims to be.
 *
 * The verdict distinguishes four outcomes the reader must not have conflated:
 * not one of ours (show the file as it is), a version we do not implement (show
 * the file as it is, and say why), a document that declares the schema and fails
 * it (say what failed — this one is the producer's mistake), and too large to
 * consider (a size problem; the document is not at fault).
 */
import type { StructuredExchangeLimits } from "./structuredExchangeBounds.ts";
import { checkDocumentBytes } from "./structuredExchangeBounds.ts";
import { parseStructuredExchange, type StructuredExchangeSchemaCheck } from "./structuredExchangeParse.ts";
import { STRUCTURED_EXCHANGE_SCHEMA_V1, type ValidatedStructuredExchange } from "./structuredExchange.ts";
import type { StructuredExchangeIssue } from "./structuredExchangeValidation.ts";

/**
 * What every version of the contract's schema identifier begins with.
 *
 * The prefix is what makes "a version we do not support" a distinct answer from
 * "not one of ours". Without it, a document declaring `urn:structured-exchange:2`
 * would be indistinguishable from an unrelated JSON file, and a reader would be
 * shown raw text with nothing said about why.
 */
export const STRUCTURED_EXCHANGE_SCHEMA_PREFIX = "urn:structured-exchange:";

/**
 * The schema identifier a candidate declares, if it declares one at all.
 *
 * Undefined means the text is not a structured-exchange document — unparseable,
 * not an object, or carrying no `schema` string in the contract's family.
 */
export function declaredStructuredExchangeSchema(serialized: string): string | undefined {
  let document: unknown;
  try {
    document = JSON.parse(serialized);
  } catch {
    return undefined;
  }
  return declaredSchemaOf(document);
}

/** Same question, for a caller that already parsed. */
export function declaredSchemaOf(document: unknown): string | undefined {
  if (typeof document !== "object" || document === null || Array.isArray(document)) return undefined;
  const schema = (document as { schema?: unknown }).schema;
  if (typeof schema !== "string" || !schema.startsWith(STRUCTURED_EXCHANGE_SCHEMA_PREFIX)) return undefined;
  return schema;
}

/**
 * Why a candidate is not one of ours.
 *
 * Two situations, and the difference matters to anyone editing: text that does not
 * parse is usually a half-finished keystroke, and text that parses but declares
 * nothing is a document missing its `schema`. Telling a reader only "not a
 * structured-exchange document" leaves them to work out which.
 */
export type NotADocument = "unparseable" | "undeclared";

export type StructuredExchangeDocumentVerdict =
  /** Not a structured-exchange document at all. Whatever it is, it is not ours. */
  | { status: "not-a-document"; why: NotADocument }
  /** Declares the family, names a version this build does not implement. */
  | { status: "unsupported-version"; schema: string }
  /** Declares a supported version and does not satisfy it. */
  | { status: "invalid"; issues: StructuredExchangeIssue[] }
  /** Past the byte bound, which runs before anything parses it. */
  | { status: "too-large"; issue: StructuredExchangeIssue }
  | { status: "valid"; envelope: ValidatedStructuredExchange };

/**
 * The whole verdict on one file's content.
 *
 * The byte bound runs first, for the reason it always does: it is the only check
 * that can refuse a document without first building the thing it was meant to
 * keep out. A document refused there is reported as too large and never as
 * invalid — nothing about it has been read, so nothing about it is known to be
 * wrong.
 */
export function readStructuredExchangeDocument(
  serialized: string,
  checkSchema: StructuredExchangeSchemaCheck,
  limits?: StructuredExchangeLimits,
): StructuredExchangeDocumentVerdict {
  const tooLarge = checkDocumentBytes(serialized, limits);
  if (tooLarge !== undefined) return { status: "too-large", issue: tooLarge };

  let document: unknown;
  try {
    document = JSON.parse(serialized);
  } catch {
    return { status: "not-a-document", why: "unparseable" };
  }

  const schema = declaredSchemaOf(document);
  if (schema === undefined) return { status: "not-a-document", why: "undeclared" };
  // A version we do not implement is not validated against the one we do: the
  // issues that would come back describe a contract the document never claimed
  // to satisfy, and reporting them would blame a producer who did nothing wrong.
  if (schema !== STRUCTURED_EXCHANGE_SCHEMA_V1) return { status: "unsupported-version", schema };

  const verdict = parseStructuredExchange(document, checkSchema);
  return verdict.valid ? { status: "valid", envelope: verdict.envelope } : { status: "invalid", issues: verdict.issues };
}
