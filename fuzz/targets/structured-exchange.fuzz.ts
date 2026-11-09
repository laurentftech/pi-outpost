/**
 * Fuzz target: a structured exchange document as the model returns it, through the whole gate the
 * tools use (`parseSerializedStructuredExchange` with the real schema): byte bound, JSON, schema,
 * semantics, the claimed version's ceiling.
 *
 * The gate never throws: every input, however broken, is answered with a verdict. So any exception
 * is a finding, as are a hang or a crash. An accepted document must also come with its envelope.
 */
import { parseSerializedStructuredExchange } from "../../shared/src/structuredExchangeParse.ts";
import { checkStructuredExchangeSchema } from "../../shared/src/structuredExchangeSchemaNode.ts";

export function fuzz(data: Buffer): void {
  const verdict = parseSerializedStructuredExchange(data.toString("utf8"), checkStructuredExchangeSchema);
  if (verdict.valid && (verdict.envelope === undefined || verdict.issues.length > 0)) {
    throw new Error("an accepted document came without its envelope, or with issues");
  }
  if (!verdict.valid && verdict.issues.length === 0) {
    throw new Error("a refused document came without a reason");
  }
}
