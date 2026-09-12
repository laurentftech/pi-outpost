/**
 * The enriched contract's relational rules — the ones shape cannot express.
 *
 * Each exists because the alternative is the application guessing. A property
 * assigned and removed in the same breath has no precedence order worth inventing.
 * A range that ends before it starts selects nothing, and JSON Schema can bound
 * each position without being able to compare two of them. A relation whose end
 * names a row that is not there would otherwise be drawn pointing at nothing, or
 * quietly dropped — and a traceability view that silently loses a link is worse
 * than one that refuses the document.
 *
 * The rule that is deliberately *not* here: a relation naming a `ref` this document
 * does not carry is accepted. The test that verifies a requirement normally lives in
 * another authority, and refusing that would make traceability stop at the document
 * boundary, which is the one place it most needs to cross.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { describeStructure } from "@pi-outpost/shared/structured-exchange/model";
import { parseStructuredExchange } from "@pi-outpost/shared/structured-exchange/parse";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";
import { STRUCTURED_EXCHANGE_SCHEMA_V2 as V2 } from "@pi-outpost/shared/structured-exchange";

/** A requirements table, with whatever the case under test needs laid over it. */
const table = (data: Record<string, unknown>, envelope: Record<string, unknown> = {}) => ({
  schema: V2,
  kind: "table",
  ...envelope,
  data: { columns: ["id", "requirement"], ...data },
});

const row = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  ref: "REQ-1",
  kind: "requirement",
  cells: ["REQ-1", "Stop within 40 m"],
  ...over,
});

function verdict(document: unknown) {
  const outcome = parseStructuredExchange(document, checkStructuredExchangeSchema);
  return {
    valid: outcome.valid,
    rules: outcome.valid ? [] : outcome.issues.map((issue) => issue.rule),
    issues: outcome.valid ? [] : outcome.issues,
    envelope: outcome.valid ? outcome.envelope : undefined,
  };
}

describe("expectations are conditions for an authority, so they need one", () => {
  test("an expectation in a document that targets nothing is refused", () => {
    const outcome = verdict(table({ rows: [row({ expect: { label: "Stop within 40 m" } })] }));
    assert.deepEqual(outcome.rules, ["expectation-without-target"]);
  });

  test("an expectation on an item that references nothing is refused", () => {
    const { ref: _ref, ...unreferenced } = row();
    const outcome = verdict(
      table({ rows: [{ ...unreferenced, expect: { label: "x" } }] }, { target: { ref: "DOC-1" } }),
    );
    assert.deepEqual(outcome.rules, ["expectation-without-reference"]);
  });

  test("a referenced item in a proposal may expect what the authority holds", () => {
    const outcome = verdict(
      table({ rows: [row({ expect: { label: "Stop within 40 m", attributes: { status: "approved" } } })] },
        { target: { ref: "DOC-1", revision: "9f2c" } }),
    );
    assert.equal(outcome.valid, true, outcome.rules.join(", "));
  });
});

describe("a patch states one intention per property", () => {
  const proposing = (set: Record<string, unknown>) =>
    verdict(table({ rows: [row({ set })] }, { target: { ref: "DOC-1" } }));

  test("assigning and removing the same attribute is refused", () => {
    const outcome = proposing({ attributes: { status: "approved" }, removeAttributes: ["status"] });
    assert.deepEqual(outcome.rules, ["attribute-set-and-removed"]);
    assert.equal(outcome.issues[0].path, "/data/rows/0/set/removeAttributes/0");
  });

  test("removing the same attribute twice is refused", () => {
    const outcome = proposing({ removeAttributes: ["status", "status"] });
    assert.deepEqual(outcome.rules, ["duplicate-attribute-removal"]);
  });

  test("assigning some properties and removing others is the ordinary case", () => {
    const outcome = proposing({ attributes: { status: "approved" }, removeAttributes: ["obsoleteNote"] });
    assert.equal(outcome.valid, true, outcome.rules.join(", "));
  });

  test("null is a value, not a deletion", () => {
    // The reason deletion is a list of names rather than a null: a domain may mean
    // "known to be nothing" and needs to be able to say it.
    const outcome = proposing({ attributes: { margin: null } });
    assert.equal(outcome.valid, true, outcome.rules.join(", "));
  });
});

describe("a location points somewhere or is refused", () => {
  const located = (range: Record<string, number>) => verdict(table({ rows: [row({ locations: [{ uri: "file:///s.md", range }] })] }));

  test("a range that ends before it begins is refused", () => {
    assert.deepEqual(located({ startLine: 40, endLine: 12 }).rules, ["location-range-reversed"]);
  });

  test("so is one that ends before it begins within a line", () => {
    assert.deepEqual(
      located({ startLine: 3, startCharacter: 20, endLine: 3, endCharacter: 4 }).rules,
      ["location-range-reversed"],
    );
  });

  test("an ordinary range, and a single point, pass", () => {
    assert.equal(located({ startLine: 10, endLine: 12 }).valid, true);
    assert.equal(located({ startLine: 10, startCharacter: 2, endLine: 10, endCharacter: 2 }).valid, true);
  });
});

describe("rows are addressable, so their identifiers are unique", () => {
  test("two rows sharing an identifier are refused", () => {
    const outcome = verdict(table({ rows: [row(), row({ ref: "REQ-2", cells: ["REQ-2", "other"] })] }));
    assert.deepEqual(outcome.rules, ["duplicate-identifier"]);
    assert.equal(outcome.issues[0].path, "/data/rows/1/id");
  });

  test("rows without identifiers are not compared", () => {
    const outcome = verdict(table({ rows: [["REQ-1", "a"], ["REQ-2", "b"], { cells: ["REQ-3", "c"] }] }));
    assert.equal(outcome.valid, true, outcome.rules.join(", "));
  });
});

describe("traceability resolves inside the document and may leave it", () => {
  const related = (relations: unknown[], rows: unknown[] = [row(), row({ id: "r2", ref: "REQ-2", cells: ["REQ-2", "Read wheel speed"] })]) =>
    verdict(table({ rows, relations }));

  test("a relation between two declared rows is accepted", () => {
    const outcome = related([{ from: { id: "r1" }, to: { id: "r2" }, kind: "derives" }]);
    assert.equal(outcome.valid, true, outcome.rules.join(", "));
  });

  test("an end naming a row that does not exist is refused, and says which end", () => {
    const outcome = related([{ from: { id: "r1" }, to: { id: "r9" }, kind: "derives" }]);
    assert.deepEqual(outcome.rules, ["unresolved-endpoint"]);
    assert.equal(outcome.issues[0].path, "/data/relations/0/to");
    assert.match(outcome.issues[0].message, /r9/);
  });

  test("an end naming something outside the document is accepted", () => {
    // A requirement is verified by a test that lives in another tool. Refusing this
    // would confine traceability to one document, which is where it is least useful.
    const outcome = related([{ from: { id: "r1" }, to: { ref: "TEST-9" }, kind: "verifiedBy" }]);
    assert.equal(outcome.valid, true, outcome.rules.join(", "));
  });

  test("both ends may leave the document", () => {
    const outcome = related([{ from: { ref: "REQ-A" }, to: { ref: "TEST-9" }, kind: "verifiedBy" }]);
    assert.equal(outcome.valid, true, outcome.rules.join(", "));
  });
});

describe("a chapter is not a row of data", () => {
  test("a heading needs no cells and is not held to the columns", () => {
    const outcome = verdict(
      table({ rows: [{ heading: "1. Braking", depth: 1 }, row(), { heading: "2. Sensing" }] }),
    );
    assert.equal(outcome.valid, true, outcome.rules.join(", "));
  });

  test("a data row is still held to them", () => {
    const outcome = verdict(table({ rows: [{ cells: ["only one"] }] }));
    assert.deepEqual(outcome.rules, ["row-column-mismatch"]);
  });
});

describe("a table becomes proposable when its rows have identity", () => {
  // The reason version 1 refuses a proposed table is that its rows are anonymous
  // tuples: a change would have to address "the third row", which is a position and
  // not a thing. Rows that carry an identity remove that objection — and nothing
  // about version 1 changes, because its rows still do not.
  test("an enriched table may be proposed and its rows patched", () => {
    const outcome = verdict(
      table(
        { rows: [row({ set: { cells: ["REQ-1", "Stop within 35 m"] } })] },
        { target: { ref: "DOC-1" } },
      ),
    );
    assert.deepEqual(outcome.rules, []);
    assert.equal(outcome.valid, true);
  });

  test("a version 1 table carrying a target is refused exactly as before", () => {
    const outcome = verdict({
      schema: "urn:structured-exchange:1",
      kind: "table",
      target: "DOC-1",
      data: { columns: ["id"], rows: [["REQ-1"]] },
    });
    assert.ok(outcome.rules.includes("kind-not-proposable"), `got ${outcome.rules.join(", ")}`);
  });

  test("a removal may name a row, and still cannot in version 1", () => {
    const enriched = verdict(
      table({ rows: [row()] }, { target: { ref: "DOC-1" }, removals: [{ type: "row", ref: "REQ-9", label: "Withdrawn" }] }),
    );
    assert.deepEqual(enriched.rules, []);

    const legacy = verdict({
      schema: "urn:structured-exchange:1",
      kind: "table",
      target: "DOC-1",
      removals: [{ type: "row", ref: "REQ-9" }],
      data: { columns: ["id"], rows: [["REQ-1"]] },
    });
    assert.equal(legacy.valid, false);
  });
});

describe("a row reports or it asks, never both", () => {
  // The DOORS round trip this contract is for: an extraction states what is there,
  // a proposal states what should change, and the reader is shown which of the two
  // they are approving. A row carrying a declared role beside a patch is both at
  // once, and the mark a reader sees would not be derived from what would be applied.
  const proposal = (rowOver: Record<string, unknown>) =>
    verdict(table({ rows: [row(rowOver)] }, { target: { ref: "DOC-1", revision: "baseline-7" } }));

  test("a declared role beside a change is refused", () => {
    const outcome = proposal({ role: "changed", set: { attributes: { status: "approved" } } });
    assert.deepEqual(outcome.rules, ["role-with-change"]);
    assert.equal(outcome.issues[0].path, "/data/rows/0/role");
  });

  test("a change alone is the proposal, and its role follows from it", () => {
    assert.equal(proposal({ set: { attributes: { status: "approved" } } }).valid, true);
  });

  test("a role alone is the report, and asks for nothing", () => {
    const outcome = verdict(table({ rows: [row({ role: "changed" })] }));
    assert.equal(outcome.valid, true, outcome.rules.join(", "));
  });
});

describe("version 1 tables are untouched by any of this", () => {
  test("a version 1 table carrying a target is still refused", () => {
    // The reversal is version 2's alone. A producer who wrote against version 1 was
    // told a table cannot be proposed, and that has to stay true for them.
    const outcome = verdict({
      schema: "urn:structured-exchange:1",
      kind: "table",
      target: "DOC-1",
      data: { columns: ["a"], rows: [["x"]] },
    });
    assert.ok(outcome.rules.includes("kind-not-proposable"), outcome.rules.join(", "));
  });

  test("a version 2 table carrying a target is accepted", () => {
    const outcome = verdict(table({ rows: [row()] }, { target: { ref: "DOC-1", revision: "baseline-7" } }));
    assert.equal(outcome.valid, true, outcome.rules.join(", "));
  });
});

describe("what the contract deliberately does not do", () => {
  // Written while building the scenario-coverage matrix: each of these was a
  // scenario the delta declares and nothing asserted. They are the rules that are
  // easiest to lose, because each one is about something *not* happening.

  test("an attribute the patch does not mention is not touched", () => {
    // The rule every other patch rule leans on. A `set` naming one attribute must
    // not read as a statement about the rest, or a producer correcting a status
    // would silently clear everything else the authority holds.
    const outcome = verdict(
      table(
        { rows: [row({ attributes: { status: "approved", owner: "braking", margin: 0.2 }, set: { attributes: { status: "in review" } } })] },
        { target: { ref: "DOC-1" } },
      ),
    );
    assert.equal(outcome.valid, true, outcome.rules.join(", "));
    const described = describeStructure(outcome.envelope!, true);
    assert.deepEqual(described.rows?.[0].assignments, [["status", "in review"]]);
    assert.deepEqual(described.rows?.[0].removedAttributes, []);
    // The others are still described, and are not proposed for anything.
    assert.deepEqual(
      described.rows?.[0].attributes.map(([name]) => name),
      ["status", "owner", "margin"],
    );
  });

  test("a target is what makes a proposal, and a revision alone is not one", () => {
    // The revision rides inside the target, so it cannot be stated without one —
    // the discriminator stays the presence of `target` and nothing else.
    const loose = verdict(table({ rows: [row()] }, { revision: "baseline-7" }));
    assert.equal(loose.valid, false, "a revision outside a target was accepted");

    const proposal = verdict(table({ rows: [row()] }, { target: { ref: "DOC-1", revision: "baseline-7" } }));
    assert.equal(proposal.valid, true, proposal.rules.join(", "));
    const plain = verdict(table({ rows: [row()] }, { target: { ref: "DOC-1" } }));
    assert.equal(plain.valid, true, "a proposal must not need a revision to be one");
  });

  test("attributes need no profile to be carried", () => {
    const outcome = verdict(table({ rows: [row({ attributes: { status: "approved" } })] }));
    assert.equal(outcome.valid, true, outcome.rules.join(", "));
    const described = describeStructure(outcome.envelope!, false);
    assert.equal(described.profile, undefined, "a profile was invented for a document that named none");
    assert.deepEqual(described.rows?.[0].attributes, [["status", "approved"]]);
  });

  test("a location takes no part in identity", () => {
    // Two different requirements may well be documented in the same file. If a
    // location were an identity, one of them would be read as the other.
    const here = [{ uri: "file:///specs/brakes.md", range: { startLine: 1, endLine: 2 } }];
    const outcome = verdict(
      table({
        rows: [
          row({ id: "r1", ref: "REQ-1", locations: here }),
          row({ id: "r2", ref: "REQ-2", cells: ["REQ-2", "Read wheel speed"], locations: here }),
        ],
      }),
    );
    assert.equal(outcome.valid, true, outcome.rules.join(", "));
  });

  test("a location whose revision has moved on changes nothing about the reference", () => {
    // A hint going stale is not a change of identity: the row still names REQ-1 in
    // the authority, whatever the file did since.
    const outcome = verdict(
      table({ rows: [row({ locations: [{ uri: "file:///specs/brakes.md", revision: "an-old-commit" }] })] }),
    );
    assert.equal(outcome.valid, true, outcome.rules.join(", "));
    assert.equal(describeStructure(outcome.envelope!, false).rows?.[0].ref, "REQ-1");
  });

  test("a row's kind is never inferred from what a column says", () => {
    // A producer's "type" column is data. Reading it as the contract's `kind` would
    // make a spreadsheet's vocabulary silently become this application's.
    const outcome = verdict(
      table({
        columns: ["id", "type"],
        rows: [{ cells: ["REQ-1", "requirement"] }, { cells: ["REQ-2", "heading"] }],
      }),
    );
    assert.equal(outcome.valid, true, outcome.rules.join(", "));
    const described = describeStructure(outcome.envelope!, false);
    assert.deepEqual(described.rows?.map((entry) => entry.kind), [undefined, undefined]);
    assert.deepEqual(described.rows?.map((entry) => entry.heading), [undefined, undefined]);
  });

  test("a row in no relation is accepted, and nothing is said about its coverage", () => {
    // Whether a requirement ought to be verified is the authority's judgement. This
    // application reports the relations a document declares and infers no gap.
    const outcome = verdict(
      table({
        rows: [row(), row({ id: "r2", ref: "REQ-2", cells: ["REQ-2", "Read wheel speed"] })],
        relations: [{ from: { id: "r1" }, to: { ref: "TEST-9" }, kind: "verifiedBy" }],
      }),
    );
    assert.equal(outcome.valid, true, outcome.rules.join(", "));
    const described = describeStructure(outcome.envelope!, false);
    assert.equal(described.traces.length, 1);
    // The unrelated row is described exactly like the related one.
    assert.equal(described.rows?.[1].ref, "REQ-2");
  });
});

describe("the rules a proposal is held to reach its rows", () => {
  // Found by review, and all of one shape: every rule about *addressing* something
  // was built from the elements and relationships of a graph, both of which answer
  // empty for a table. Version 2 made a table proposable and gave rows a `ref` and
  // a `set` — so the one item type this contract exists to make patchable was the
  // one nothing checked.
  const proposing = (over: Record<string, unknown>, envelope: Record<string, unknown> = {}) =>
    verdict({ schema: "urn:structured-exchange:2", kind: "table", ...envelope, data: { columns: ["id"], ...over } });

  test("two rows addressing the same reference are refused", () => {
    // One intention per thing. Two patches on one requirement leave an authority
    // with no way to say which wins, and picking one is the guess this stage refuses.
    const outcome = proposing(
      { rows: [{ cells: ["R-1"], ref: "REQ-1", set: { label: "a" } }, { cells: ["R-2"], ref: "REQ-1", set: { label: "b" } }] },
      { target: { ref: "DOC-1" } },
    );
    assert.ok(outcome.rules.includes("duplicate-reference"), outcome.rules.join(", "));
  });

  test("a row changed and removed at once is refused", () => {
    const outcome = proposing(
      { rows: [{ cells: ["R-1"], ref: "REQ-1", set: { label: "renamed" } }] },
      { target: { ref: "DOC-1" }, removals: [{ type: "row", ref: "REQ-1" }] },
    );
    assert.ok(outcome.rules.includes("duplicate-reference"), outcome.rules.join(", "));
  });

  test("a row that changes nothing it names is refused", () => {
    const outcome = proposing({ rows: [{ cells: ["R-1"], set: { label: "a" } }] }, { target: { ref: "DOC-1" } });
    assert.ok(outcome.rules.includes("change-without-reference"), outcome.rules.join(", "));
  });

  test("a row patched in a document that targets nothing is refused", () => {
    const outcome = proposing({ rows: [{ cells: ["R-1"], ref: "REQ-1", set: { label: "a" } }] });
    assert.ok(outcome.rules.includes("change-without-target"), outcome.rules.join(", "));
  });

  test("an honest proposal and an honest extraction still pass", () => {
    assert.equal(
      proposing(
        { rows: [{ cells: ["R-1"], ref: "REQ-1", set: { attributes: { status: "x" } } }, { cells: ["R-2"] }] },
        { target: { ref: "DOC-1" }, removals: [{ type: "row", ref: "REQ-9" }] },
      ).valid,
      true,
    );
    assert.equal(proposing({ rows: [{ cells: ["R-1"], ref: "REQ-1" }, { cells: ["R-2"], ref: "REQ-2" }] }).valid, true);
  });
});
