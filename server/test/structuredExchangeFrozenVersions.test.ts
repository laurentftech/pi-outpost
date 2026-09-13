/**
 * Published versions, frozen.
 *
 * A new schema version is added beside the old ones, and the risk it carries is not
 * that the new version is wrong — it is that a published one quietly stops being what
 * it was: a fixture edited to make a new validator pass, a case dropped from the
 * manifest because it was inconvenient, a rule that now fires with a different name.
 * Each of those turns a published contract into a moving one, and the producers who
 * wrote against it would learn that from their own build breaking.
 *
 * So each lock records both halves: the exact bytes of every case it covers, and the
 * verdict the implementation reached on it. The bytes alone would let behaviour drift
 * under an unchanged corpus; the verdicts alone would let the corpus be rewritten to
 * match a new behaviour.
 *
 * Version 1 was frozen before version 2 work began. Version 2 was frozen at v0.25.0,
 * its first release: until then it grew in place, because no producer could have
 * written against it. Adding cases for a later version is expected and touches
 * neither lock — a lock is a floor, not an inventory. Changing or removing a locked
 * case fails here, and should: it is a change to a contract that was published.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { parseSerializedStructuredExchange } from "@pi-outpost/shared/structured-exchange/parse";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUITE = path.resolve(HERE, "../../shared/conformance");

interface LockedCase {
  file: string;
  sha256: string;
  verdict: "valid" | "invalid";
  expectedRule?: string;
}

const index = JSON.parse(readFileSync(path.join(SUITE, "index.json"), "utf8")) as {
  valid: { file: string }[];
  invalid: { file: string; expectedRule: string }[];
};

/**
 * The digest of a case's content, with line endings normalised.
 *
 * Git is free to hand a Windows working tree CRLF, which changed every digest here
 * and reported the whole corpus as altered — a checkout setting reading as "the
 * published contract moved". What the freeze is about is the content; `.gitattributes`
 * is what holds the bytes themselves to LF where they are distributed.
 */
const digest = (file: string) =>
  createHash("sha256").update(readFileSync(path.join(SUITE, file), "utf8").replace(/\r\n/g, "\n")).digest("hex");

/** Each frozen version, the lock that freezes it, and the fewest cases that lock may hold. */
const FROZEN = [
  { version: 1, lockFile: "version-1.lock.json", schema: "urn:structured-exchange:1", floor: 49, covers: "the corpus that existed before the extension" },
  { version: 2, lockFile: "version-2.lock.json", schema: "urn:structured-exchange:2", floor: 21, covers: "the corpus added until version 2 was first released" },
] as const;

for (const frozen of FROZEN) {
  const lock = JSON.parse(readFileSync(path.join(SUITE, frozen.lockFile), "utf8")) as { schema: string; cases: LockedCase[] };

  describe(`the version ${frozen.version} conformance corpus is frozen`, () => {
    test(`the lock covers ${frozen.covers}`, () => {
      assert.equal(lock.schema, frozen.schema);
      assert.ok(lock.cases.length >= frozen.floor, `the lock lost cases: ${lock.cases.length}`);
    });

    for (const locked of lock.cases) {
      test(`${locked.file} is character-for-character what it was`, () => {
        assert.equal(digest(locked.file), locked.sha256);
      });

      test(`${locked.file} is still declared ${locked.verdict} by the manifest`, () => {
        // A case may not leave the suite, and may not swap sides within it: either
        // would let the corpus be edited into agreement with a new implementation.
        const declared =
          index.valid.some((entry) => entry.file === locked.file)
            ? ("valid" as const)
            : index.invalid.some((entry) => entry.file === locked.file)
              ? ("invalid" as const)
              : undefined;
        assert.equal(declared, locked.verdict, `${locked.file} is no longer declared ${locked.verdict}`);
        if (locked.verdict === "invalid") {
          const entry = index.invalid.find((candidate) => candidate.file === locked.file);
          assert.equal(entry?.expectedRule, locked.expectedRule, "the rule this case names has changed");
        }
      });

      test(`${locked.file} still reaches its recorded verdict`, () => {
        const outcome = parseSerializedStructuredExchange(
          readFileSync(path.join(SUITE, locked.file), "utf8"),
          checkStructuredExchangeSchema,
        );
        assert.equal(outcome.valid, locked.verdict === "valid");
        if (!outcome.valid && locked.expectedRule) {
          const rules = outcome.issues.map((issue) => issue.rule);
          assert.ok(rules.includes(locked.expectedRule), `expected ${locked.expectedRule}, got ${rules.join(", ")}`);
        }
      });
    }
  });
}

describe("the frozen versions do not overlap", () => {
  test("no case is locked by two versions", () => {
    const seen = new Map<string, number>();
    for (const frozen of FROZEN) {
      const lock = JSON.parse(readFileSync(path.join(SUITE, frozen.lockFile), "utf8")) as { cases: LockedCase[] };
      for (const locked of lock.cases) {
        assert.equal(seen.get(locked.file), undefined, `${locked.file} is locked by version ${seen.get(locked.file)} and version ${frozen.version}`);
        seen.set(locked.file, frozen.version);
      }
    }
  });
});
