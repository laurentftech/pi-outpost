/**
 * The enriched contract loses nothing — checked against the whole frozen corpus.
 *
 * "Version 2 only adds" is easy to say and easy to break in ways no single test
 * would catch: a definition dropped while restructuring, a rule that stops firing
 * because the shape it reads moved, a patch that validates but no longer carries
 * what it patched. So every frozen case is re-expressed under the enriched
 * identifier and put through the whole gate — schema and semantics both — and the
 * parsed result is compared with what version 1 made of it.
 *
 * The exceptions are the interesting part, and they are listed rather than
 * tolerated: each one is a place the contract deliberately moved, and a change
 * that adds a sixteenth exception has to say so here.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { parseStructuredExchange } from "@pi-outpost/shared/structured-exchange/parse";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";
import { STRUCTURED_EXCHANGE_SCHEMA_V2 } from "@pi-outpost/shared/structured-exchange";

const SUITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../shared/conformance");
const index = JSON.parse(readFileSync(path.join(SUITE, "index.json"), "utf8")) as {
  valid: { file: string }[];
  invalid: { file: string; expectedRule: string }[];
};

const read = (file: string) => JSON.parse(readFileSync(path.join(SUITE, file), "utf8")) as Record<string, unknown>;

/**
 * The same document, asking to be judged by the enriched contract.
 *
 * One shape changes with the identifier: a target is an object, so a proposal can
 * name the revision it was prepared against. Nothing else is touched — a
 * re-expression that edited the content would be proving something about the
 * editor rather than about the contract.
 */
function asEnriched(document: Record<string, unknown>): Record<string, unknown> {
  const enriched: Record<string, unknown> = { ...document, schema: STRUCTURED_EXCHANGE_SCHEMA_V2 };
  if (typeof enriched.target === "string") enriched.target = { ref: enriched.target };
  return enriched;
}

const parse = (document: unknown) => parseStructuredExchange(document, checkStructuredExchangeSchema);

/** What a reader would be shown, with the two fields the re-expression itself changed removed. */
function meaning(envelope: Record<string, unknown>): string {
  const { schema: _schema, target: _target, ...rest } = envelope;
  return JSON.stringify(rest);
}

describe("every valid version 1 document is valid, and means the same, under version 2", () => {
  for (const { file } of index.valid) {
    test(file, () => {
      const original = read(file);
      if (original.schema !== "urn:structured-exchange:1") return;

      const before = parse(original);
      const after = parse(asEnriched(original));
      assert.equal(before.valid, true, `the frozen case no longer passes version 1`);
      assert.equal(
        after.valid,
        true,
        after.valid ? "" : `refused under version 2: ${after.issues.map((issue) => `${issue.rule}@${issue.path}`).join(", ")}`,
      );
      if (!before.valid || !after.valid) return;

      // Containers, kinds, removals, patches, row roles: all of it, compared whole
      // rather than field by field, so a construct nobody thought to name here is
      // covered too.
      assert.equal(
        meaning(after.envelope as unknown as Record<string, unknown>),
        meaning(before.envelope as unknown as Record<string, unknown>),
        "the enriched contract changed what the document says",
      );
    });
  }
});

/**
 * Cases the enriched contract deliberately answers differently.
 *
 * Both are the same decision seen from two sides: a row now has an identity, so a
 * table has something for a change to address, so a table may be proposed. Under
 * version 1 its rows are anonymous tuples and it may not.
 */
const DELIBERATE: Record<string, string> = {
  "invalid/table-with-target.json":
    "a table may be proposed under version 2, because its rows can now be addressed",
};

/**
 * Still refused, by a different rule.
 *
 * Both carry removals and name no target. Under version 1 the first objection was
 * that a table cannot be proposed at all, and it never got as far as the second.
 * Version 2 removes the first objection, so the answer is now the one that was
 * always underneath it — a removal needs a target to remove from. The verdict is
 * unchanged; only the sentence explaining it is.
 */
const REASON_MOVED: Record<string, string> = {
  "invalid/table-with-removal.json": "removal-without-target",
  "invalid/table-with-empty-removals.json": "removal-without-target",
};

/**
 * The one case that cannot be re-expressed at all: it exists to show what happens
 * to an identifier this build has no validator for, and rewriting its identifier
 * would be rewriting the question.
 */
const ABOUT_THE_IDENTIFIER = "invalid/unknown-version.json";

describe("every refusal still holds under version 2, except where it was meant to move", () => {
  for (const { file, expectedRule } of index.invalid) {
    test(`${file} → ${expectedRule}`, () => {
      const original = read(file);
      if (file === ABOUT_THE_IDENTIFIER) {
        // Left exactly as it is: re-expressing it would answer a different question.
        const asItStands = parse(original);
        assert.equal(asItStands.valid, false);
        if (asItStands.valid) return;
        assert.ok(asItStands.issues.map((issue) => issue.rule).includes("unsupported-version"));
        return;
      }

      const after = parse(asEnriched(original));
      const deliberate = DELIBERATE[file];
      if (deliberate !== undefined) {
        assert.equal(
          after.valid,
          true,
          after.valid ? "" : `${deliberate}, but version 2 refused it: ${after.issues.map((issue) => issue.rule).join(", ")}`,
        );
        return;
      }

      assert.equal(after.valid, false, `version 2 accepted what version 1 refused: ${file}`);
      if (after.valid) return;
      const rules = after.issues.map((issue) => issue.rule);
      const expected = REASON_MOVED[file] ?? expectedRule;
      assert.ok(
        rules.includes(expected),
        `expected ${expected} under version 2, got ${rules.join(", ") || "nothing"}`,
      );
    });
  }
});

describe("the exceptions are real, not a way around a failing case", () => {
  for (const [file, why] of Object.entries({ ...DELIBERATE, ...REASON_MOVED })) {
    test(`${file}: ${why}`, () => {
      // Still refused under the contract it was written for. An "exception" that
      // also passed version 1 would mean the case had simply stopped working.
      const before = parse(read(file));
      assert.equal(before.valid, false, "the frozen case no longer fails under version 1");
    });
  }
});
