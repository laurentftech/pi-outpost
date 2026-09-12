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

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** The fenced JSON blocks of a document, paired with where they start. */
function envelopes(file: string): { at: number; document: Record<string, unknown> }[] {
  const text = readFileSync(path.join(REPO, file), "utf8");
  const found: { at: number; document: Record<string, unknown> }[] = [];
  for (const match of text.matchAll(/```json\n([\s\S]*?)```/g)) {
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
      test(`the envelope at line ${at} (${String(document.schema).slice(-1)}) validates`, () => {
        const verdict = parseStructuredExchange(document, checkStructuredExchangeSchema);
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
