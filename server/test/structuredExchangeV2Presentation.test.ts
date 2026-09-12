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
 * removals). A reader approving a DOORS proposal has to be able to tell what they
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
  profile: "acme/doors",
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
  target: { ref: "DOORS://module/42", revision: "baseline-7" },
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
    assert.equal(described(extraction).profile, "acme/doors");
  });

  test("a proposal carries the artifact it targets and the revision it was read at", () => {
    assert.deepEqual(described(proposal).target, { ref: "DOORS://module/42", revision: "baseline-7" });
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
