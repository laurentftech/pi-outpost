/**
 * Two-stage validation, in the order the contract requires: shape first, then the
 * relational rules shape cannot express.
 *
 * The schema check is injected rather than imported. The two environments that
 * need it want different things from it — Node (the server and the reference
 * command-line interface) wants full diagnostics and has no size budget, while
 * the browser wants a yes/no it can afford to ship. Both derive from the same
 * committed schema, so neither can drift from the contract; only their appetite
 * for detail differs.
 */
import type { StructuredExchangeEnvelope, ValidatedStructuredExchange } from "./structuredExchange.ts";
import {
  checkDeploymentLimits,
  checkDocumentBytes,
  measureAccepted,
  type StructuredExchangeLimits,
  type StructuredExchangeMeasurement,
} from "./structuredExchangeBounds.ts";
import {
  validateStructuredExchangeSemantics,
  type StructuredExchangeIssue,
  type StructuredExchangeVerdict,
} from "./structuredExchangeValidation.ts";

export type { StructuredExchangeIssue, StructuredExchangeVerdict } from "./structuredExchangeValidation.ts";

/**
 * Validates a document against the committed schema. Returns the reasons it was
 * refused, empty when it conforms.
 *
 * An implementation that cannot produce reasons returns a single issue saying so
 * rather than an empty array — "no reasons" must never read as "valid".
 */
export type StructuredExchangeSchemaCheck = (document: unknown) => StructuredExchangeIssue[];

/**
 * The whole verdict on one candidate document.
 *
 * Returns either a fully validated envelope or no envelope at all. There is no
 * partial success: a caller cannot accidentally render half a proposal, because
 * half a proposal is never handed to it.
 */
export function parseStructuredExchange(
  document: unknown,
  checkSchema: StructuredExchangeSchemaCheck,
): StructuredExchangeVerdict {
  const schemaIssues = checkSchema(document);
  if (schemaIssues.length > 0) return { valid: false, issues: schemaIssues };

  // Shape is settled, so the document is an envelope as far as its fields go.
  // What is not yet settled is whether those fields agree with one another.
  const envelope = document as StructuredExchangeEnvelope;
  const semanticIssues = validateStructuredExchangeSemantics(envelope);
  if (semanticIssues.length > 0) return { valid: false, issues: semanticIssues };

  return { valid: true, envelope: envelope as ValidatedStructuredExchange, issues: [] };
}

/**
 * The whole gate, from the bytes as they arrived.
 *
 * Order matters and is not an implementation detail: the byte bound runs before
 * `JSON.parse`, because it is the only check that can refuse a document without
 * first building the thing it was meant to keep out. Everything after it needs the
 * document in memory.
 *
 * On acceptance the caller is handed a measurement as well as the envelope, so an
 * operational limit can be calibrated from what really arrives rather than from
 * the first thing that broke.
 */
export function parseSerializedStructuredExchange(
  serialized: string,
  checkSchema: StructuredExchangeSchemaCheck,
  limits?: StructuredExchangeLimits,
):
  | { valid: true; envelope: ValidatedStructuredExchange; measurement: StructuredExchangeMeasurement; issues: [] }
  | { valid: false; issues: StructuredExchangeIssue[] } {
  const tooLarge = checkDocumentBytes(serialized, limits);
  if (tooLarge !== undefined) return { valid: false, issues: [tooLarge] };

  let document: unknown;
  try {
    document = JSON.parse(serialized);
  } catch {
    // Deliberately no recovery pass. Elsewhere in this application a truncated
    // JSON result is worth salvaging for display; here it would mean approving a
    // proposal assembled from the part that happened to arrive.
    return {
      valid: false,
      issues: [{ rule: "not-json", path: "", message: "document is not parseable JSON" }],
    };
  }

  const verdict = parseStructuredExchange(document, checkSchema);
  if (!verdict.valid) return verdict;

  // The document has now said which contract it claims, so the ceiling that
  // contract promises can be applied. The gate above used the widest any version
  // allows, because reading the declaration means parsing — see its comment.
  const pastItsVersion = checkDocumentBytes(serialized, limits, verdict.envelope.schema);
  if (pastItsVersion !== undefined) return { valid: false, issues: [pastItsVersion] };

  const deploymentIssues = checkDeploymentLimits(verdict.envelope, limits);
  if (deploymentIssues.length > 0) return { valid: false, issues: deploymentIssues };

  return {
    valid: true,
    envelope: verdict.envelope,
    measurement: measureAccepted(verdict.envelope, serialized),
    issues: [],
  };
}
