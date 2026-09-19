/**
 * The reference validator's profile checks, as a profile author receives them.
 *
 * A profile is built outside this application — exported from a requirements tool, or
 * composed by an agent — so the checks have to run where it is built: the bundle, copied
 * to a directory with no path back to this repository and nothing but Node. The bundle
 * is rebuilt first, always: a stale one would test last week's validator.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { before, describe, test } from "node:test";
import { envWithoutCoverageSink } from "./childEnv.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BUNDLE = path.join(REPO, "shared/dist/validate-structured-exchange.mjs");
const away = mkdtempSync(path.join(tmpdir(), "structured-exchange-profile-cli-"));
const cli = path.join(away, "validate-structured-exchange.mjs");

type Outcome = { code: number; stdout: string };

function run(args: string[]): Outcome {
  try {
    const stdout = execFileSync(process.execPath, [cli, ...args], {
      cwd: away,
      input: "",
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", NODE_V8_COVERAGE: "" },
    });
    return { code: 0, stdout };
  } catch (error) {
    const failure = error as { status: number; stdout: string; stderr: string };
    assert.equal(failure.stderr, "", `the CLI wrote to stderr: ${failure.stderr}`);
    return { code: failure.status, stdout: failure.stdout };
  }
}
const verdictOf = (outcome: Outcome) => JSON.parse(outcome.stdout) as { valid: boolean; subject?: string; issues?: { rule: string; path: string; message: string }[]; profile?: { id: string; applied: boolean; notes?: unknown[] } };

const forty = Array.from({ length: 40 }, (_, index) => `component-${String(index + 1).padStart(2, "0")}`);

const profile = (overrides: Record<string, unknown> = {}) => ({
  schema: "urn:structured-exchange-profile:1",
  id: "acme/requirements",
  label: "ACME requirements",
  description: "Exported from the brake system module.",
  elementKinds: [
    {
      kind: "requirement",
      attributes: [
        { name: "status", type: "enumeration", values: ["draft", "approved", "withdrawn"], closed: true, required: true },
        { name: "priority", type: "enumeration", values: ["must", "should"], closed: false },
        { name: "component", type: "enumeration", values: forty, closed: true },
        { name: "verifiedBy", type: "reference", list: true },
      ],
    },
    { kind: "test" },
  ],
  relationshipKinds: [{ kind: "verifies" }],
  viewpoints: [{ id: "verification", label: "Verification", concern: "What verifies what", elementKinds: ["requirement", "test"] }],
  ...overrides,
});

const table = (attributes: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
  schema: "urn:structured-exchange:2",
  kind: "table",
  profile: "acme/requirements",
  ...over,
  data: { columns: ["id", "requirement"], rows: [{ id: "r1", kind: "requirement", cells: ["REQ-1", "Stop"], attributes }] },
});

const write = (name: string, value: unknown) => {
  writeFileSync(path.join(away, name), typeof value === "string" ? value : JSON.stringify(value, null, 2));
  return name;
};

describe("the reference validator's profile checks, as they ship", () => {
  before(() => {
    execFileSync(process.execPath, [path.join(REPO, "shared/scripts/build-validator.mjs")], { cwd: REPO, stdio: "ignore", env: envWithoutCoverageSink() });
    copyFileSync(BUNDLE, cli);
  });

  test("a usable profile checked on its own is accepted with status 0", () => {
    // ProfileChecksRunWhereTheProducerIs
    const outcome = run(["--check-profile", write("good-profile.json", profile())]);
    assert.equal(outcome.code, 0, outcome.stdout);
    assert.deepEqual(verdictOf(outcome), { valid: true, subject: "profile", id: "acme/requirements" });
  });

  test("a profile repeating an enumeration value is refused with its rule, pointer and a non-zero status", () => {
    // AProfileIsCheckedOnItsOwn
    const broken = profile();
    ((broken.elementKinds as { attributes?: { values?: string[] }[] }[])[0].attributes![0]).values = ["draft", "approved", "draft"];
    const outcome = run(["--check-profile", write("repeated-profile.json", broken)]);
    assert.equal(outcome.code, 4);
    const verdict = verdictOf(outcome);
    assert.equal(verdict.subject, "profile");
    assert.equal(verdict.issues?.[0].rule, "profile-format/repeated-enumeration-value");
    assert.equal(verdict.issues?.[0].path, "/elementKinds/0/attributes/0/values/2");
  });

  test("a document is validated against a profile, reporting the profile's rule and the pointer", () => {
    // ADocumentIsValidatedAgainstAProfile
    const outcome = run(["--profile", write("profile.json", profile()), write("stray.json", table({ status: "in review" }))]);
    assert.equal(outcome.code, 1);
    const verdict = verdictOf(outcome);
    assert.equal(verdict.issues?.[0].rule, "profile/closed-enumeration");
    assert.equal(verdict.issues?.[0].path, "/data/rows/0/attributes/status");
    assert.match(verdict.issues?.[0].message ?? "", /"draft", "approved", "withdrawn"/);
  });

  test("a conforming document passes, with its open-enumeration notes", () => {
    const outcome = run(["--profile", write("profile.json", profile()), write("open.json", table({ status: "approved", priority: "urgent" }))]);
    assert.equal(outcome.code, 0, outcome.stdout);
    const verdict = verdictOf(outcome);
    assert.equal(verdict.profile?.applied, true);
    assert.equal(verdict.profile?.notes?.length, 1);
  });

  test("a document naming no profile is held to the given one, and one naming another is refused", () => {
    const unnamed = table({ priority: "must" }) as Record<string, unknown>;
    delete unnamed.profile;
    const heldToIt = run(["--profile", write("profile.json", profile()), write("unnamed.json", unnamed)]);
    assert.equal(heldToIt.code, 1);
    assert.equal(verdictOf(heldToIt).issues?.[0].rule, "profile/missing-required-attribute");

    const other = run(["--profile", write("profile.json", profile()), write("other.json", table({ status: "approved" }, { profile: "acme/tests" }))]);
    assert.equal(other.code, 1);
    assert.equal(verdictOf(other).issues?.[0].rule, "profile/different-profile");
  });

  test("an unusable profile is distinguished from a stray document", () => {
    // AnUnusableProfileIsDistinguishedFromAStrayDocument
    const document = write("stray.json", table({ status: "in review" }));
    const stray = run(["--profile", write("profile.json", profile()), document]);
    const unusable = run(["--profile", write("unusable-profile.json", profile({ extends: "acme/base" })), document]);
    const notJson = run(["--profile", write("not-json-profile.json", "{ nope"), document]);
    const missing = run(["--profile", "no-such-profile.json", document]);
    assert.equal(stray.code, 1);
    for (const outcome of [unusable, notJson, missing]) {
      assert.equal(outcome.code, 4, outcome.stdout);
      assert.equal(verdictOf(outcome).subject, "profile");
    }
    assert.notEqual(stray.code, unusable.code);
  });

  test("the document's own statuses keep their meaning when a profile is given", () => {
    const profileFile = write("profile.json", profile());
    assert.equal(run(["--profile", profileFile, "no-such-document.json"]).code, 2);
    assert.equal(run(["--profile", profileFile, write("not-json-document.txt", "{ nope")]).code, 3);
  });

  test("lists a profile for review, every enumeration value under its attribute and kind", () => {
    // AProfileIsListedForReview
    const outcome = run(["--describe-profile", write("profile.json", profile())]);
    assert.equal(outcome.code, 0, outcome.stdout);
    const listing = outcome.stdout;
    assert.match(listing, /^Profile acme\/requirements — ACME requirements/);
    assert.match(listing, /status: enumeration, closed, required — 3 values/);
    assert.match(listing, /priority: enumeration, open, optional — 2 values/);
    assert.match(listing, /component: enumeration, closed, optional — 40 values/);
    assert.match(listing, /verifiedBy: list of reference, optional/);
    for (const value of forty) assert.ok(listing.includes(`      - ${value}\n`), `${value} is missing from the listing`);
    // In the author's order, under the right attribute and kind.
    const requirementAt = listing.indexOf("  requirement\n");
    const componentAt = listing.indexOf("    component:");
    const firstValue = listing.indexOf("      - component-01");
    const lastValue = listing.indexOf("      - component-40");
    const testKindAt = listing.indexOf("  test\n");
    assert.ok(requirementAt < componentAt && componentAt < firstValue && firstValue < lastValue && lastValue < testKindAt);
  });

  test("a relationship kind is listed with the element kinds at its ends, or any", () => {
    // DeclaredEndsAreListed
    const withEnds = profile({ relationshipKinds: [{ kind: "verifies", from: ["test"] }] });
    const outcome = run(["--describe-profile", write("profile-ends.json", withEnds)]);
    assert.equal(outcome.code, 0, outcome.stdout);
    assert.ok(
      outcome.stdout.includes("  verifies\n    source: test\n    target: any element kind\n"),
      `the ends are not listed under verifies:\n${outcome.stdout}`,
    );
  });

  test("the profile the documentation shows a profile author passes the shipped check", () => {
    // The example a profile author copies first: it has to be a profile the bundle accepts.
    const docs = readFileSync(path.join(REPO, "docs/structured-exchange.md"), "utf8");
    const examples = [...docs.matchAll(/```json\r?\n([\s\S]*?)```/g)]
      .map((match) => {
        try {
          return JSON.parse(match[1]) as { schema?: string };
        } catch {
          return undefined;
        }
      })
      .filter((example) => example?.schema === "urn:structured-exchange-profile:1");
    assert.equal(examples.length, 1, "the documentation should show exactly one complete profile");
    const outcome = run(["--check-profile", write("documented-profile.json", examples[0])]);
    assert.equal(outcome.code, 0, outcome.stdout);
  });

  test("refuses arguments it cannot act on, with status 2", () => {
    assert.equal(run(["--profile"]).code, 2);
    assert.equal(run(["--check-profile", "a.json", "--describe-profile", "b.json"]).code, 2);
    assert.equal(run(["--check-profile", write("profile.json", profile()), "extra.json"]).code, 2);
  });
});
