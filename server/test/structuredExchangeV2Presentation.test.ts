/**
 * What a reader is handed, before anything draws it.
 *
 * `describeStructure` is the one model behind both the rendering and its textual
 * equivalent, so anything missing here is missing from both — and the reader who
 * cannot see the diagram is the one who loses it silently.
 *
 * The distinction the enriched contract turns on, and the reason these are four
 * fields rather than one merged map: what is *described* (attributes), what is
 * *believed* of the authority (expectations), what is *asked for* (assignments and
 * removals). A reader approving a proposal has to be able to tell what they
 * are approving from what was shown for context — and a merge would make the two
 * indistinguishable at exactly the moment it matters.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { describeStructure } from "@pi-outpost/shared/structured-exchange/model";
import { parseStructuredExchange } from "@pi-outpost/shared/structured-exchange/parse";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";
import type { ValidatedStructuredExchange } from "@pi-outpost/shared/structured-exchange";

/** Validated first: the model only ever describes a document the contract accepted. */
function described(document: unknown) {
  const verdict = parseStructuredExchange(document, checkStructuredExchangeSchema);
  assert.equal(verdict.valid, true, verdict.valid ? "" : verdict.issues.map((issue) => `${issue.rule}@${issue.path}`).join(", "));
  if (!verdict.valid) throw new Error("unreachable");
  const envelope = verdict.envelope as ValidatedStructuredExchange;
  return describeStructure(envelope, (envelope as { target?: unknown }).target !== undefined);
}

/** The shape this change exists for: a specification extracted from an external authority. */
const extraction = {
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
        attributes: { status: "approved", verification: "test" },
        locations: [{ uri: "file:///specs/brakes.md", range: { startLine: 10, endLine: 12 } }],
        artifacts: [{ rel: "verifies", uri: "https://ci/report", sha256: `sha256:${"a".repeat(64)}` }],
      },
      { heading: "1.1 Sensing", depth: 2 },
      { id: "r2", ref: "REQ-2", kind: "requirement", cells: ["REQ-2", "Read wheel speed at 100 Hz"] },
    ],
    relations: [
      { from: { id: "r1" }, to: { id: "r2" }, kind: "derives" },
      { from: { id: "r1" }, to: { ref: "TEST-9" }, kind: "verifiedBy" },
    ],
  },
};

/** The same specification, amended: what the agent proposes writing back. */
const proposal = {
  ...extraction,
  target: { ref: "reqs://module/42", revision: "baseline-7" },
  removals: [{ type: "row", ref: "REQ-9", label: "Withdrawn requirement" }],
  data: {
    ...extraction.data,
    rows: [
      extraction.data.rows[0],
      {
        ...extraction.data.rows[1],
        expect: { attributes: { status: "approved" } },
        set: { attributes: { status: "in review" }, removeAttributes: ["obsoleteNote"] },
      },
      extraction.data.rows[2],
      extraction.data.rows[3],
    ],
  },
};

describe("the document says what it is and what it came from", () => {
  test("the profile reaches the reader, unread", () => {
    assert.equal(described(extraction).profile, "acme/requirements");
  });

  test("a proposal carries the artifact it targets and the revision it was read at", () => {
    assert.deepEqual(described(proposal).target, { ref: "reqs://module/42", revision: "baseline-7" });
  });

  test("an extraction targets nothing, and says so by carrying no target", () => {
    assert.equal(described(extraction).target, undefined);
  });

  test("a version 1 proposal's bare reference still reads as a target", () => {
    const v1 = {
      schema: "urn:structured-exchange:1",
      kind: "graph",
      target: "architecture-v4",
      data: { nodes: [{ id: "a", ref: "EL-1", label: "A" }], edges: [] },
    };
    assert.deepEqual(described(v1).target, { ref: "architecture-v4" });
  });
});

describe("a row keeps what it is, not only what it shows", () => {
  test("identity and type survive into the model", () => {
    const row = described(extraction).rows?.[1];
    assert.equal(row?.id, "r1");
    assert.equal(row?.ref, "REQ-1");
    assert.equal(row?.kind, "requirement");
    assert.deepEqual(row?.cells, ["REQ-1", "Stop within 40 m"]);
  });

  test("a chapter is a row that carries a heading and no cells", () => {
    const rows = described(extraction).rows ?? [];
    assert.equal(rows[0].heading, "1. Braking");
    assert.equal(rows[0].depth, 1);
    assert.deepEqual(rows[0].cells, []);
    assert.equal(rows[2].heading, "1.1 Sensing");
    assert.equal(rows[2].depth, 2);
    // And its position among the rows it introduces is the document's own.
    assert.deepEqual(rows.map((entry) => entry.heading ?? entry.id), ["1. Braking", "r1", "1.1 Sensing", "r2"]);
  });

  test("a data row is never given a heading it did not declare", () => {
    assert.equal(described(extraction).rows?.[1].heading, undefined);
  });
});

describe("described, expected, and asked for are kept apart", () => {
  const row = () => described(proposal).rows?.[1];

  test("what the producer says is true now", () => {
    assert.deepEqual(row()?.attributes, [
      ["status", "approved"],
      ["verification", "test"],
    ]);
  });

  test("what it believes the authority holds, which the authority must check", () => {
    assert.deepEqual(row()?.expectations, [["status", "approved"]]);
  });

  test("what it asks to become true", () => {
    assert.deepEqual(row()?.assignments, [["status", "in review"]]);
  });

  test("and what it asks to unset, which is not an assignment of null", () => {
    assert.deepEqual(row()?.removedAttributes, ["obsoleteNote"]);
  });

  test("an extraction asks for nothing at all", () => {
    // `extraction` carries no target, no removals and no `set` on any row — which
    // the contract now enforces rather than merely expects: a `set` in a document
    // that targets nothing is refused.
    const described_ = described(extraction).rows?.[1];
    assert.deepEqual(described_?.assignments, []);
    assert.deepEqual(described_?.removedAttributes, []);
    assert.deepEqual(described_?.expectations, []);
    // While still describing what it read.
    assert.equal(described_?.attributes.length, 2);
  });

  test("attributes keep the producer's order rather than being sorted", () => {
    // Two renderings of one document have to agree, and the producer's order is the
    // only one both sides can reach without inventing a rule.
    assert.deepEqual(
      described(extraction).rows?.[1].attributes.map(([name]) => name),
      ["status", "verification"],
    );
  });
});

describe("locations and artifacts arrive whole and inert", () => {
  test("a location keeps its uri and range", () => {
    const location = described(extraction).rows?.[1].locations[0];
    assert.equal(location?.uri, "file:///specs/brakes.md");
    assert.deepEqual(location?.range, { startLine: 10, endLine: 12 });
  });

  test("an artifact keeps the digest its approval is bound to", () => {
    const artifact = described(extraction).rows?.[1].artifacts[0];
    assert.equal(artifact?.rel, "verifies");
    assert.equal(artifact?.sha256, `sha256:${"a".repeat(64)}`);
  });

  test("nothing is fetched to describe either of them", () => {
    // Stated as the absence of any resolved content: the model carries the link,
    // never anything read from the other end of it.
    const artifact = described(extraction).rows?.[1].artifacts[0] as Record<string, unknown>;
    assert.deepEqual(Object.keys(artifact).sort(), ["rel", "sha256", "uri"]);
  });
});

describe("traceability is resolved as far as the document can, and no further", () => {
  test("a relation between two rows names both, with the text a reader sees", () => {
    const trace = described(extraction).traces[0];
    assert.equal(trace.kind, "derives");
    assert.equal(trace.fromRow, "r1");
    assert.equal(trace.toRow, "r2");
    assert.equal(trace.fromLabel, "REQ-1");
    assert.equal(trace.toLabel, "REQ-2");
  });

  test("an end that leaves the document keeps its reference and is not invented a label", () => {
    const trace = described(extraction).traces[1];
    assert.equal(trace.kind, "verifiedBy");
    assert.equal(trace.toRow, undefined);
    assert.equal(trace.toRef, "TEST-9");
    assert.equal(trace.toLabel, "TEST-9");
  });

  test("every other kind describes no traces rather than omitting the field", () => {
    const graph = {
      schema: "urn:structured-exchange:2",
      kind: "graph",
      data: { nodes: [{ id: "a", label: "A" }], edges: [] },
    };
    assert.deepEqual(described(graph).traces, []);
  });
});

describe("a graph carries the same enrichment, through the same fields", () => {
  test("an element's attributes and a relationship's reach the model", () => {
    const graph = {
      schema: "urn:structured-exchange:2",
      kind: "graph",
      profile: "acme/physical",
      data: {
        nodes: [
          { id: "battery", label: "Batterie", kind: "source", attributes: { capacity: "60 kWh" } },
          { id: "motor", label: "Moteur", kind: "component" },
        ],
        edges: [{ from: "battery", to: "motor", kind: "power", attributes: { nominal: 400 } }],
      },
    };
    const structure = described(graph);
    assert.deepEqual(structure.things[0].attributes, [["capacity", "60 kWh"]]);
    assert.deepEqual(structure.links[0].attributes, [["nominal", 400]]);
    assert.deepEqual(structure.things[1].attributes, []);
  });
});

describe("a proposed table marks itself from what it proposes", () => {
  // Approval here is a person reading the screen — the contract states there is no
  // approval action and no handover step, and that is deliberate. So the whole of
  // this application's job is that what the reader sees is derived from what would
  // actually be applied, and that the document they judged is the one an
  // integration later fetches.
  const rows = [
    { heading: "1. Braking", depth: 1 },
    { id: "r1", ref: "REQ-1", cells: ["REQ-1", "Stop within 40 m"], set: { attributes: { status: "in review" } } },
    { id: "r2", cells: ["REQ-2", "Warn the driver at 20 m"] },
    { id: "r3", ref: "REQ-3", cells: ["REQ-3", "Read wheel speed"] },
  ];
  const proposed = {
    schema: "urn:structured-exchange:2",
    kind: "table",
    target: { ref: "reqs://module/42", revision: "baseline-7" },
    removals: [{ type: "row", ref: "REQ-9", label: "Withdrawn requirement" }],
    data: { columns: ["id", "requirement"], rows },
  };

  test("a referenced row carrying a change reads as changed", () => {
    assert.equal(described(proposed).rows?.[1].role, "changed");
  });

  test("a row with no reference reads as an addition", () => {
    // The authority does not hold it yet, which is the whole of what "added" means.
    assert.equal(described(proposed).rows?.[2].role, "added");
  });

  test("a referenced row with no change reads as context, not as a rewrite", () => {
    // Every requirement of a module comes back in the extraction. Marking them all
    // as changed would make a two-line amendment look like a rewritten specification.
    assert.equal(described(proposed).rows?.[3].role, "context");
  });

  test("a chapter is not marked as proposed", () => {
    // It organises the rows around it. Marking every heading of an extracted
    // specification as an addition would drown the rows that really are new.
    assert.equal(described(proposed).rows?.[0].role, undefined);
  });

  test("what is withdrawn is named with enough to recognise it", () => {
    // The reader holds this document and not the authority's model, so a removal
    // that is only an identifier asks them to approve deleting something unseen.
    assert.deepEqual(described(proposed).removals, [{ type: "row", ref: "REQ-9" }]);
  });

  test("an extraction marks nothing at all", () => {
    // Stripping the target is not enough to make a proposal an extraction: the rows
    // keep their patches, and a patch without a target is refused. What an
    // extraction is, is a document that asks for nothing.
    const { target: _target, removals: _removals, ...extracted } = proposed;
    const asExtracted = {
      ...extracted,
      data: {
        ...extracted.data,
        rows: (extracted.data.rows as Record<string, unknown>[]).map(({ set: _set, expect: _expect, ...row }) => row),
      },
    };
    const structure = described(asExtracted);
    assert.deepEqual(structure.rows?.map((row) => row.role), [undefined, undefined, undefined, undefined]);
  });

  test("a declared role still wins, for the table that reports rather than asks", () => {
    const reporting = {
      schema: "urn:structured-exchange:2",
      kind: "table",
      data: { columns: ["id"], rows: [{ role: "removed", cells: ["REQ-3"] }, { cells: ["REQ-1"] }] },
    };
    assert.deepEqual(described(reporting).rows?.map((row) => row.role), ["removed", "context"]);
  });
});

describe("a declared role does not disarm the derived ones", () => {
  test("one row reporting a role leaves the rest marked by what they propose", () => {
    // Found by review: `tableRowRole` reads *any* undeclared row as context once any
    // row declares one, so asking it first turned every derived mark in a proposal
    // back into context — a change shown as unchanged, in the view whose only job is
    // telling those apart. The contract allows the mix: it refuses a role and a
    // change on the same row, not in the same table.
    const mixed = {
      schema: "urn:structured-exchange:2",
      kind: "table",
      target: { ref: "DOC-1" },
      data: {
        columns: ["id", "text"],
        rows: [
          { cells: ["REQ-0", "reported"], role: "context" },
          { cells: ["REQ-1", "amended"], ref: "REQ-1", set: { attributes: { status: "in review" } } },
          { cells: ["REQ-2", "new"] },
        ],
      },
    };
    assert.deepEqual(described(mixed).rows?.map((row) => row.role), ["context", "changed", "added"]);
  });

  test("a table that proposes nothing still reads an undeclared row as context", () => {
    // The version 1 reading, untouched: among rows that declare a role, one that
    // declares none is context rather than an ordinary row of data.
    const report = {
      schema: "urn:structured-exchange:1",
      kind: "table",
      data: { columns: ["id"], rows: [{ cells: ["A"], role: "added" }, { cells: ["B"] }] },
    };
    assert.deepEqual(described(report).rows?.map((row) => row.role), ["added", "context"]);
  });
});

describe("a patch's attributes do not leak into the picture", () => {
  test("a figure shows the fields it can draw, and not the maps it cannot", () => {
    // `attributes: [object Object]` was going into the element box of a diagram
    // someone was about to approve, and `removeAttributes: draft` read as setting a
    // field by that name. Both belong to the detail panel, which renders them
    // properly; a picture of structure shows neither.
    const graph = {
      schema: "urn:structured-exchange:2",
      kind: "graph",
      target: { ref: "architecture-v4" },
      data: {
        nodes: [{ id: "a", ref: "EL-1", label: "Ledger", set: { label: "General Ledger", attributes: { status: "approved" }, removeAttributes: ["draft"] } }],
        edges: [],
      },
    };
    const thing = described(graph).things[0];
    assert.deepEqual(thing.changes, [{ field: "label", from: "Ledger", to: "General Ledger" }]);
    // Not dropped — moved to where a reader can read them.
    assert.deepEqual(thing.assignments, [["status", "approved"]]);
    assert.deepEqual(thing.removedAttributes, ["draft"]);
  });
});
