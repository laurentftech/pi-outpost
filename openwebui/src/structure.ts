/**
 * The gate a shown structure passes: pi-outpost's own, without profiles.
 *
 * `present_structure` judges a document with `parseSerializedStructuredExchange` and the
 * committed schema, then — only in a project that registers profiles — holds it to the
 * project's profile. Open WebUI has no project, which is pi-outpost's "no registry"
 * case: the core contract alone, every kind and every version, proposals included. A
 * document refused here is refused there for the same reason, with the same words.
 *
 * Weak models send the document as an object or as a string holding one. A string goes
 * to the gate as it arrived, so the byte ceiling is applied before anything parses it;
 * an object is serialised first, which is the form the gate measures either way.
 */
import { parseSerializedStructuredExchange, type StructuredExchangeIssue } from "@pi-outpost/shared/structured-exchange/parse";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";
import type { ValidatedStructuredExchange } from "@pi-outpost/shared/structured-exchange";

export type StructureVerdict = { valid: true; envelope: ValidatedStructuredExchange } | { valid: false; issues: StructuredExchangeIssue[] };

export function judgeStructure(document: unknown): StructureVerdict {
  if (document === undefined || document === null) {
    return { valid: false, issues: [{ rule: "document-required", path: "", message: "document is required: the structured-exchange document, as an object or as a JSON string" }] };
  }
  const serialized = typeof document === "string" ? document : JSON.stringify(document);
  const verdict = parseSerializedStructuredExchange(serialized, checkStructuredExchangeSchema);
  return verdict.valid ? { valid: true, envelope: verdict.envelope } : { valid: false, issues: verdict.issues };
}
