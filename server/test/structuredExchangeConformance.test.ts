/**
 * The conformance suite, run against both callers.
 *
 * The suite exists so a producer built elsewhere can check itself without reading
 * our source. That promise is only worth something if the suite is accurate here
 * first — and if the command-line interface and the application parser agree on
 * every case, since a producer validating with one and being refused by the other
 * would have been better off with no contract at all.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { parseSerializedStructuredExchange } from "@pi-outpost/shared/structured-exchange/parse";
import {
  checkStructuredExchangeSchema,
  STRUCTURED_EXCHANGE_SCHEMA,
  unwrapSchemaModule,
} from "@pi-outpost/shared/structured-exchange/schema-node";
import { envWithoutCoverageSink } from "./childEnv.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUITE = path.resolve(HERE, "../../shared/conformance");
const CLI = path.resolve(HERE, "../../shared/bin/validate-structured-exchange.mjs");
const index = JSON.parse(readFileSync(path.join(SUITE, "index.json"), "utf8")) as {
  valid: { file: string }[];
  invalid: { file: string; expectedRule: string }[];
};

const read = (file: string) => readFileSync(path.join(SUITE, file), "utf8");

/** The command-line interface's verdict, and the status it exited with. */
function cliVerdict(file: string): { status: number; body: { valid: boolean; issues?: { rule: string }[] } } {
  try {
    const stdout = execFileSync(process.execPath, ["--import", "tsx/esm", CLI, path.join(SUITE, file)], {
      encoding: "utf8",
      env: envWithoutCoverageSink(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, body: JSON.parse(stdout) };
  } catch (error) {
    const failure = error as { status: number; stdout: string };
    return { status: failure.status, body: JSON.parse(failure.stdout) };
  }
}

const parse = (file: string) => parseSerializedStructuredExchange(read(file), checkStructuredExchangeSchema);

describe("structured-exchange conformance suite", () => {
  test("the suite is not empty in either direction", () => {
    assert.ok(index.valid.length > 0);
    assert.ok(index.invalid.length > 0);
  });

  describe("documents the contract accepts", () => {
    for (const { file } of index.valid) {
      test(file, () => {
        const verdict = parse(file);
        assert.equal(
          verdict.valid,
          true,
          verdict.valid ? "" : `refused: ${verdict.issues.map((issue) => `${issue.rule}@${issue.path}`).join(", ")}`,
        );
      });
    }
  });

  describe("documents the contract refuses, for the stated reason", () => {
    for (const { file, expectedRule } of index.invalid) {
      test(`${file} → ${expectedRule}`, () => {
        const verdict = parse(file);
        assert.equal(verdict.valid, false, "expected this document to be refused");
        if (verdict.valid) return;
        const rules = verdict.issues.map((issue) => issue.rule);
        assert.ok(rules.includes(expectedRule), `expected ${expectedRule}, got ${rules.join(", ")}`);
      });
    }
  });

  describe("the command-line interface agrees with the parser", () => {
    for (const { file } of index.valid) {
      test(`accepts ${file} and exits zero`, () => {
        const { status, body } = cliVerdict(file);
        assert.equal(status, 0);
        assert.equal(body.valid, true);
      });
    }

    for (const { file, expectedRule } of index.invalid) {
      test(`refuses ${file} with ${expectedRule} and exits non-zero`, () => {
        const { status, body } = cliVerdict(file);
        assert.equal(status, 1);
        assert.equal(body.valid, false);
        assert.ok(
          body.issues?.some((issue) => issue.rule === expectedRule),
          `expected ${expectedRule}, got ${body.issues?.map((issue) => issue.rule).join(", ")}`,
        );
      });
    }
  });

  test("an unreadable input is distinguished from an invalid one", () => {
    // Exit 2, not 1: a producer's build should not report a missing file as a
    // contract violation and send someone looking at their schema.
    try {
      execFileSync(process.execPath, ["--import", "tsx/esm", CLI, path.join(SUITE, "does-not-exist.json")], {
        encoding: "utf8",
        env: envWithoutCoverageSink(),
        stdio: ["ignore", "pipe", "pipe"],
      });
      assert.fail("expected a non-zero exit");
    } catch (error) {
      const failure = error as { status: number; stdout: string };
      assert.equal(failure.status, 2);
      assert.equal(JSON.parse(failure.stdout).issues[0].rule, "unreadable-input");
    }
  });
});

/**
 * How the schema JSON arrives depends on who loaded this module, and one loader
 * that matters is not Node's.
 *
 * pi loads an extension through jiti, which is how `present_structure` reaches an
 * RPC child. jiti's interop adds a `default` property pointing back at the object
 * it decorates. `default` is a JSON Schema keyword, so the compiler descends into
 * it, meets the whole schema again, and dies of stack exhaustion — every document
 * refused with "Maximum call stack size exceeded" and nothing wrong with any of
 * them. Found by driving a real `pi --mode rpc` child, not by any unit test.
 */
describe("schema module interop", () => {
  test("drops a self-referential default the loader added", () => {
    const decorated: Record<string, unknown> = { $id: "urn:test", type: "object" };
    decorated.default = decorated;
    const unwrapped = unwrapSchemaModule(decorated);
    assert.equal("default" in unwrapped, false);
    assert.equal(unwrapped.$id, "urn:test");
  });

  test("unwraps a namespace whose default holds the document", () => {
    const document = { $id: "urn:test" };
    assert.deepEqual(unwrapSchemaModule({ default: document }), document);
  });

  test("keeps a genuine default keyword, which is part of the schema", () => {
    assert.deepEqual(unwrapSchemaModule({ type: "string", default: "hello" }), { type: "string", default: "hello" });
  });

  test("the schema actually compiled against carries no self-reference", () => {
    const schema = STRUCTURED_EXCHANGE_SCHEMA as Record<string, unknown>;
    assert.notEqual(schema.default, schema);
    // And it still validates, which is what the recursion took away.
    assert.deepEqual(
      checkStructuredExchangeSchema({
        schema: "urn:structured-exchange:1",
        kind: "graph",
        data: { nodes: [{ id: "a", label: "A" }], edges: [] },
      }),
      [],
    );
  });
});
