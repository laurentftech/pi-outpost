/**
 * The document a reader judged is the document an integration later fetches.
 *
 * There is deliberately no approval action here and no handover step: approval is a
 * person reading the screen, and carrying their decision into the
 * requirements manager it came from belongs to whatever integrates this. Which is exactly why
 * recovery has to be exact. The reader's "yes" refers to what they were shown, and
 * if the field they weighed is not in what comes back out, their judgement was
 * about a document that no longer exists.
 *
 * Byte identity is not promised and cannot be: the document crosses this process as
 * a parsed value. What is promised is that no field, no order and no value differs —
 * and the enriched contract multiplied the fields that could quietly go missing.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { historyToItems, structuredExchangeField } from "../src/convert.ts";
import { parseStructuredExchange } from "@pi-outpost/shared/structured-exchange/parse";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";

/** Everything the enriched contract added, on one document. */
const proposal = {
  schema: "urn:structured-exchange:2",
  kind: "table",
  profile: "acme/requirements",
  target: { ref: "reqs://module/42", revision: "baseline-7" },
  removals: [{ type: "row", ref: "REQ-9", label: "Withdrawn requirement", kind: "requirement" }],
  artifacts: [{ rel: "extractedFrom", uri: "https://requirements.example/module/42", sha256: `sha256:${"b".repeat(64)}`, label: "Extraction" }],
  data: {
    columns: ["id", "requirement"],
    rows: [
      { heading: "1. Braking", depth: 1 },
      {
        id: "r1",
        ref: "REQ-1",
        kind: "requirement",
        cells: ["REQ-1", "Stop within 40 m", 12, null, true],
        attributes: { status: "approved", margin: 0.25, tags: ["safety", { ref: "EL-7" }], note: null },
        expect: { label: "Stop within 40 m", attributes: { status: "approved" }, revision: "obj-rev-3" },
        set: { attributes: { status: "in review" }, removeAttributes: ["obsoleteNote"] },
        locations: [{ uri: "file:///specs/brakes.md", revision: "9f2c", range: { startLine: 10, startCharacter: 4, endLine: 12, endCharacter: 0 } }],
        artifacts: [{ rel: "verifies", uri: "https://ci/report.json", sha256: `sha256:${"a".repeat(64)}`, mediaType: "application/json" }],
      },
      { heading: "1.1 Sensing", depth: 2 },
      { id: "r2", cells: ["REQ-2", "Read wheel speed at 100 Hz", 3, null, false], kind: "requirement" },
    ],
    relations: [
      { from: { id: "r1" }, to: { id: "r2" }, kind: "derives" },
      { from: { id: "r1" }, to: { ref: "TEST-9" }, kind: "verifiedBy", label: "bench test" },
    ],
  },
};

/** The column widths the table declares are five, so the fixture has to mean it. */
const columns = ["id", "requirement", "weight", "margin", "critical"];
const sound = { ...proposal, data: { ...proposal.data, columns } };

/** What a tool result carries to the browser, and what the browser gets back out of it. */
function acrossTheWire(document: unknown): unknown {
  const carried = structuredExchangeField(document);
  assert.ok(carried.structured !== undefined, "the document did not cross at all");
  return JSON.parse(carried.structured);
}

describe("every enriched field survives the crossing", () => {
  test("the document that arrives is the document that was sent", () => {
    // Deep equality rather than a field-by-field list: a test that names the fields
    // it checks cannot fail for the field somebody adds next.
    assert.deepEqual(acrossTheWire(sound), sound);
  });

  test("and it is still valid on the far side", () => {
    const arrived = acrossTheWire(sound);
    const verdict = parseStructuredExchange(arrived, checkStructuredExchangeSchema);
    assert.equal(verdict.valid, true, verdict.valid ? "" : verdict.issues.map((issue) => issue.rule).join(", "));
  });

  test("key order is the producer's, all the way through", () => {
    // Attribute order is what a reader compares between two renderings; a
    // re-serialisation that sorted keys would make the two disagree.
    const arrived = acrossTheWire(sound) as typeof sound;
    const row = arrived.data.rows[1] as { attributes: Record<string, unknown> };
    assert.deepEqual(Object.keys(row.attributes), ["status", "margin", "tags", "note"]);
  });

  test("a null in a cell or an attribute stays null rather than becoming absent", () => {
    const arrived = acrossTheWire(sound) as typeof sound;
    const row = arrived.data.rows[1] as { cells: unknown[]; attributes: Record<string, unknown> };
    assert.equal(row.cells[3], null);
    assert.ok("note" in row.attributes);
    assert.equal(row.attributes.note, null);
  });
});

describe("restoring the conversation restores the document", () => {
  /** A reopened session: history replayed, exactly as a reconnect replays it. */
  function replayed(document: unknown) {
    const messages = [
      { role: "user", content: "extract the braking module" },
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "call-1", name: "present_structure", arguments: {} }],
      },
      {
        role: "toolResult",
        toolCallId: "call-1",
        content: "presented",
        details: document,
      },
    ];
    const items = historyToItems(messages as never);
    const card = items.find((item) => item.kind === "tool");
    assert.ok(card, "the tool card did not survive the replay");
    return card as Extract<typeof card, { kind: "tool" }>;
  }

  test("a reopened session carries the enriched document, not a summary of it", () => {
    const card = replayed(sound);
    assert.ok(card.structured !== undefined, "the structured document was dropped on replay");
    assert.deepEqual(JSON.parse(card.structured), sound);
  });

  test("the replayed document still validates", () => {
    const card = replayed(sound);
    const verdict = parseStructuredExchange(JSON.parse(card.structured!), checkStructuredExchangeSchema);
    assert.equal(verdict.valid, true, verdict.valid ? "" : verdict.issues.map((issue) => issue.rule).join(", "));
  });

  test("a version 1 document replays exactly as it did before", () => {
    const v1 = {
      schema: "urn:structured-exchange:1",
      kind: "graph",
      target: "architecture-v4",
      data: { nodes: [{ id: "a", ref: "EL-1", label: "A" }], edges: [] },
    };
    assert.deepEqual(JSON.parse(replayed(v1).structured!), v1);
  });

  test("something that is not one of ours is not carried as though it were", () => {
    assert.deepEqual(structuredExchangeField({ some: "other tool result" }), {});
    assert.deepEqual(structuredExchangeField({ schema: "urn:something-else:1" }), {});
  });
});
