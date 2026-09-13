/**
 * The reference validator, as an external producer receives it.
 *
 * Everything else in this suite exercises the rules through the repository's own
 * modules. This runs the built bundle, from a directory with no access to the
 * repository, the way an MCP server or a producer's build would — which is the only
 * way the two failures this has already had could have been caught: a schema read
 * from a path that only resolves inside the checkout, and a duplicated shebang that
 * made the bundle a syntax error while every in-repo test stayed green.
 */
import assert from "node:assert/strict";
import { execFileSync, execFileSync as run } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { before, describe, test } from "node:test";
import { envWithoutCoverageSink } from "./childEnv.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BUNDLE = path.join(REPO, "shared/dist/validate-structured-exchange.mjs");

/** Somewhere with no node_modules, no package.json, and no path back to the repo. */
const away = mkdtempSync(path.join(tmpdir(), "structured-exchange-cli-"));
const cli = path.join(away, "validate-structured-exchange.mjs");

const graph = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    schema: "urn:structured-exchange:1",
    kind: "graph",
    data: { nodes: [{ id: "a", label: "A" }], edges: [] },
    ...over,
  });

/** Runs the CLI and reports what a caller driving it from a build would see. */
function validate(args: string[], input?: string): { code: number; verdict: Record<string, unknown> } {
  try {
    const stdout = run(process.execPath, [cli, ...args], {
      cwd: away,
      input: input ?? "",
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", NODE_V8_COVERAGE: "" },
    });
    return { code: 0, verdict: JSON.parse(stdout) };
  } catch (error) {
    const failure = error as { status: number; stdout: string; stderr: string };
    assert.equal(failure.stderr, "", `the CLI wrote to stderr: ${failure.stderr}`);
    return { code: failure.status, verdict: JSON.parse(failure.stdout) };
  }
}

/**
 * A requirements table of the shape the enriched contract exists for: typed rows,
 * a chapter, and traceability leaving the document.
 */
const enriched = (attributes?: Record<string, unknown>, relations?: unknown[]) =>
  JSON.stringify({
    schema: "urn:structured-exchange:2",
    kind: "table",
    profile: "acme/requirements",
    data: {
      columns: ["id", "requirement"],
      rows: [
        { heading: "1. Braking", depth: 1 },
        {
          id: "r1",
          ref: "REQ-1",
          kind: "requirement",
          cells: ["REQ-1", "Stop within 40 m"],
          ...(attributes ? { attributes } : {}),
        },
      ],
      relations: relations ?? [{ from: { id: "r1" }, to: { ref: "TEST-9" }, kind: "verifiedBy" }],
    },
  });

describe("the reference validator as it ships", () => {
  before(() => {
    if (!existsSync(BUNDLE)) {
      execFileSync(process.execPath, [path.join(REPO, "shared/scripts/build-validator.mjs")], {
        cwd: REPO,
        stdio: "ignore",
        env: envWithoutCoverageSink(),
      });
    }
    copyFileSync(BUNDLE, cli);
    writeFileSync(path.join(away, "good.json"), graph());
    writeFileSync(path.join(away, "not-json.txt"), "{ this is not json");
    writeFileSync(
      path.join(away, "unconforming.json"),
      graph({ data: { nodes: [{ id: "a", ref: "R", set: { label: "New" } }], edges: [] } }),
    );
    writeFileSync(path.join(away, "enriched.json"), enriched());
    writeFileSync(
      path.join(away, "enriched-bad-attribute.json"),
      enriched({ attributes: { owner: { name: "someone" } } }),
    );
    writeFileSync(
      path.join(away, "enriched-dangling-relation.json"),
      enriched(undefined, [{ from: { id: "nobody" }, to: { ref: "TEST-9" }, kind: "verifiedBy" }]),
    );
    writeFileSync(path.join(away, "future.json"), enriched().replace("exchange:2", "exchange:3"));
  });

  test("runs at all, outside the repository, with nothing installed", () => {
    // A path resolved relative to the module, or a stray shebang, fails only here.
    const { code, verdict } = validate(["good.json"]);
    assert.equal(code, 0);
    assert.equal(verdict.valid, true);
  });

  test("reads standard input when given no file", () => {
    const { code, verdict } = validate([], graph());
    assert.equal(code, 0);
    assert.equal(verdict.valid, true);
  });

  test("reports what the document is, not merely that it passed", () => {
    const { verdict } = validate(["good.json"]);
    assert.equal(verdict.kind, "graph");
    assert.ok(verdict.measurement, "a producer sizing its output needs the measurement back");
  });

  // The exit codes are the interface for anything driving this from a build, and
  // three different problems must not arrive as one.
  test("exits 1 for a document that was read and does not conform", () => {
    const { code, verdict } = validate(["unconforming.json"]);
    assert.equal(code, 1);
    assert.equal(verdict.valid, false);
    assert.deepEqual((verdict.issues as { rule: string }[]).map((issue) => issue.rule), ["change-without-target"]);
  });

  test("exits 2 when the input cannot be read, rather than blaming the schema", () => {
    const { code, verdict } = validate(["absent.json"]);
    assert.equal(code, 2);
    assert.equal((verdict.issues as { rule: string }[])[0].rule, "unreadable-input");
  });

  test("exits 3 when the input is not JSON", () => {
    const { code, verdict } = validate(["not-json.txt"]);
    assert.equal(code, 3);
    assert.equal((verdict.issues as { rule: string }[])[0].rule, "not-json");
  });

  // The enriched contract, through the artifact a producer actually runs. The
  // application validating version 2 is worth nothing to them if the thing they
  // were handed still only knows version 1.
  describe("the enriched contract", () => {
    test("validates from a file, and reports what it measured", () => {
      const { code, verdict } = validate(["enriched.json"]);
      assert.equal(code, 0, `refused: ${JSON.stringify(verdict.issues)}`);
      assert.equal(verdict.valid, true);
      assert.equal(verdict.kind, "table");
      const counts = (verdict.measurement as { counts: Record<string, number> }).counts;
      assert.equal(counts.relations, 1, "a producer sizing its traceability needs it counted");
    });

    test("validates from standard input on the same terms", () => {
      const { code, verdict } = validate([], enriched());
      assert.equal(code, 0);
      assert.equal(verdict.valid, true);
    });

    test("refuses a bad value where the value is, not where the reader is not looking", () => {
      const { code, verdict } = validate(["enriched-bad-attribute.json"]);
      assert.equal(code, 1);
      const [issue] = verdict.issues as { rule: string; path: string }[];
      assert.equal(issue.path, "/data/rows/1/attributes");
    });

    test("applies the semantic rules too, not only the schema", () => {
      // A relation pointing at a row that is not there: shape alone cannot see it.
      const { code, verdict } = validate(["enriched-dangling-relation.json"]);
      assert.equal(code, 1);
      const [issue] = verdict.issues as { rule: string; path: string }[];
      assert.equal(issue.rule, "unresolved-endpoint");
      assert.equal(issue.path, "/data/relations/0/from");
    });

    test("names a version it does not have rather than judging it by the wrong one", () => {
      const { code, verdict } = validate(["future.json"]);
      assert.equal(code, 1);
      const [issue] = verdict.issues as { rule: string; message: string }[];
      assert.equal(issue.rule, "unsupported-version");
      assert.match(issue.message, /urn:structured-exchange:1 and urn:structured-exchange:2/);
    });
  });

  test("says how to use it, and documents its exit codes where a caller will look", () => {
    const help = run(process.execPath, [cli, "--help"], { cwd: away, encoding: "utf8" });
    // Plain substring checks. These were regular expressions built from strings that
    // then had to be escaped — an escape that only handled colons, which is both a
    // sharp edge and a question this assertion never needed to ask.
    for (const stated of ["0", "1", "2", "3", "standard input"]) {
      assert.ok(help.includes(stated), `the help text does not mention ${stated}`);
    }
    // And which contracts it actually knows, since that is the first thing a
    // producer writing against it has to decide.
    for (const version of ["urn:structured-exchange:1", "urn:structured-exchange:2"]) {
      assert.ok(help.includes(version), `the help text does not name ${version}`);
    }
  });

  test("agrees with the application on every conformance case", () => {
    // Two implementations of one contract that disagree are two contracts.
    const suite = path.join(REPO, "shared/conformance");
    const index = JSON.parse(readFileSync(path.join(suite, "index.json"), "utf8"));

    for (const entry of index.valid as { file: string }[]) {
      const { code } = validate([path.join(suite, entry.file)]);
      assert.equal(code, 0, `${entry.file} should be accepted`);
    }
    for (const entry of index.invalid as { file: string; expectedRule?: string }[]) {
      const { code, verdict } = validate([path.join(suite, entry.file)]);
      assert.ok(code === 1 || code === 3, `${entry.file} should be refused, got exit ${code}`);
      if (entry.expectedRule !== undefined) {
        const rules = (verdict.issues as { rule: string }[]).map((issue) => issue.rule);
        assert.ok(rules.includes(entry.expectedRule), `${entry.file}: expected ${entry.expectedRule}, got ${rules.join(", ")}`);
      }
    }
  });
});
