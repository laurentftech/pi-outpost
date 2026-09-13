/**
 * Every envelope in the producer documentation, put through the real gate.
 *
 * These examples are the contract as most producers meet it: someone writing an
 * integration copies the one closest to what they need and edits it. An example
 * that no longer validates does not fail loudly anywhere — it fails in their
 * build, against a document they have every reason to believe was correct, and the
 * first thing they will doubt is their own reading rather than our page.
 *
 * The skill bundled with the product is checked on the same terms, because the
 * agent reads that one and cannot ask whether it is current.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { parseStructuredExchange } from "@pi-outpost/shared/structured-exchange/parse";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";
import { validateProfile, validateRegistry } from "@pi-outpost/shared/structured-exchange/profile-validation";

/**
 * Each example judged by the format it declares. A profile or a registry shown in the
 * documentation is copied by a profile author exactly as an envelope is copied by a
 * producer, so it is held to its own format rather than skipped — and rather than
 * refused as a document it never claimed to be.
 */
function verdictFor(document: Record<string, unknown>): { valid: boolean; issues: { rule: string; path: string }[] } {
  const schema = String(document.schema);
  if (schema.startsWith("urn:structured-exchange-profile-registry:")) return validateRegistry(document);
  if (schema.startsWith("urn:structured-exchange-profile:")) return validateProfile(document);
  return parseStructuredExchange(document, checkStructuredExchangeSchema);
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** The fenced JSON blocks of a document, paired with where they start. */
function envelopes(file: string): { at: number; document: Record<string, unknown> }[] {
  const text = readFileSync(path.join(REPO, file), "utf8");
  const found: { at: number; document: Record<string, unknown> }[] = [];
  // `\r?` because a Windows checkout ends these lines with CRLF, and a fence regex
  // that misses every block does not fail loudly — it reports a document with no
  // examples, which is why the suite refuses to pass by finding none.
  for (const match of text.matchAll(/```json\r?\n([\s\S]*?)```/g)) {
    let document: unknown;
    try {
      document = JSON.parse(match[1]);
    } catch {
      // A fragment illustrating one field rather than a whole envelope. Those are
      // not documents and are not claimed to be.
      continue;
    }
    if (typeof (document as { schema?: unknown })?.schema !== "string") continue;
    const at = text.slice(0, match.index).split("\n").length;
    found.push({ at, document: document as Record<string, unknown> });
  }
  return found;
}

for (const file of ["docs/structured-exchange.md", "skills/structured-exchange/SKILL.md"]) {
  describe(`${file} shows documents that validate`, () => {
    const found = envelopes(file);

    test("has examples at all, so this suite cannot pass by finding none", () => {
      assert.ok(found.length > 0, `no complete envelope found in ${file}`);
    });

    for (const { at, document } of found) {
      test(`the example at line ${at} (${String(document.schema)}) validates`, () => {
        const verdict = verdictFor(document);
        assert.equal(
          verdict.valid,
          true,
          verdict.valid
            ? ""
            : `documented example is refused: ${verdict.issues.map((issue) => `${issue.rule}@${issue.path}`).join(", ")}`,
        );
      });
    }
  });
}
