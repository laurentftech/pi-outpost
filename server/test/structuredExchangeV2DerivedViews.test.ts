/**
 * What every view derived from a document does with an enriched one.
 *
 * A figure and a data export are not the document: they are readings of it, and
 * each was written when there was one version to read. Left alone, publishing a
 * second one made a valid enriched document undrawable — `write_structure_figure`
 * would refuse the architecture a report embeds, for no reason the producer could
 * act on, and the file viewer would call a valid file an unsupported version.
 *
 * The rule these hold to is narrow and worth stating: a derived view shows the
 * structure, and enrichment it has no place for is *omitted*, never invented and
 * never a reason to refuse. A figure of an enriched graph is the figure of its
 * version 1 equivalent.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { figureForDocument } from "@pi-outpost/shared/structured-exchange/export";
import { readStructuredExchangeDocument } from "@pi-outpost/shared/structured-exchange/document";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";
import { toMermaid } from "@pi-outpost/shared/structured-exchange/model";
import { parseStructuredExchange } from "@pi-outpost/shared/structured-exchange/parse";

const architecture = {
  schema: "urn:structured-exchange:1",
  kind: "graph",
  data: {
    nodes: [
      { id: "battery", label: "Batterie", kind: "source", container: "electrical" },
      { id: "motor", label: "Moteur", kind: "component", container: "electrical" },
    ],
    edges: [{ from: "battery", to: "motor", kind: "power" }],
    containers: [{ id: "electrical", label: "Système électrique" }],
  },
};

/** The same architecture, enriched: a profile, attributes, locations, artifacts. */
const enriched = {
  ...architecture,
  schema: "urn:structured-exchange:2",
  profile: "acme/physical",
  data: {
    ...architecture.data,
    nodes: architecture.data.nodes.map((node) => ({
      ...node,
      attributes: { mass: "12 kg", supplier: { ref: "SUP-3" } },
      locations: [{ uri: "file:///models/vehicle.json" }],
      artifacts: [{ rel: "datasheet", uri: "https://example/ds.pdf", sha256: `sha256:${"c".repeat(64)}` }],
    })),
  },
};

const figure = (document: unknown) => figureForDocument(JSON.stringify(document), checkStructuredExchangeSchema);

/** The identifier appears in the figure's own metadata; the structure is the rest. */
const structureOf = (svg: string) => svg.replace(/urn:structured-exchange:\d+/g, "URN");

describe("a figure draws an enriched document", () => {
  test("it is drawn at all, rather than refused for its version", () => {
    const drawn = figure(enriched);
    assert.notEqual(
      (drawn as { reason?: string }).reason,
      "unsupported-version",
      "the enriched contract cannot be drawn, so a report cannot embed one",
    );
    assert.ok((drawn as { svg?: string }).svg, "no figure was produced");
  });

  test("and it draws the same structure as the version 1 equivalent", () => {
    // Elements, relationships and containers are what a figure is. Enrichment has
    // no place in one, and its absence must not change the picture either.
    const one = figure(architecture) as { svg: string };
    const two = figure(enriched) as { svg: string };
    assert.equal(structureOf(two.svg), structureOf(one.svg));
  });

  test("a version this build does not implement is still refused", () => {
    const future = { ...architecture, schema: "urn:structured-exchange:3" };
    assert.equal((figure(future) as { reason?: string }).reason, "unsupported-version");
  });
});

describe("the file viewer reads an enriched file", () => {
  test("a valid enriched document reads as valid", () => {
    const verdict = readStructuredExchangeDocument(JSON.stringify(enriched), checkStructuredExchangeSchema);
    assert.equal(verdict.status, "valid");
  });

  test("an invalid enriched document is reported as invalid, not as an unknown version", () => {
    // The difference matters to whoever has to fix it: "we do not know this
    // contract" and "you do not satisfy the contract you named" are different jobs.
    const broken = { ...enriched, data: { ...enriched.data, edges: [{ from: "battery", to: "nowhere", kind: "power" }] } };
    const verdict = readStructuredExchangeDocument(JSON.stringify(broken), checkStructuredExchangeSchema);
    assert.equal(verdict.status, "invalid");
  });

  test("a version beyond this build is still an unsupported version", () => {
    const verdict = readStructuredExchangeDocument(
      JSON.stringify({ ...architecture, schema: "urn:structured-exchange:4" }),
      checkStructuredExchangeSchema,
    );
    assert.equal(verdict.status, "unsupported-version");
  });

  test("something that is not ours is still not ours", () => {
    const verdict = readStructuredExchangeDocument(`{"just":"json"}`, checkStructuredExchangeSchema);
    assert.equal(verdict.status, "not-a-document");
  });
});

describe("the derived export carries structure and nothing it invented", () => {
  const mermaidOf = (document: unknown) => {
    const verdict = parseStructuredExchange(document, checkStructuredExchangeSchema);
    assert.equal(verdict.valid, true, verdict.valid ? "" : verdict.issues.map((issue) => issue.rule).join(", "));
    return verdict.valid ? toMermaid(verdict.envelope) : undefined;
  };

  test("an enriched graph exports the same diagram syntax as its equivalent", () => {
    assert.equal(mermaidOf(enriched), mermaidOf(architecture));
  });

  test("attribute text cannot reach the diagram's syntax", () => {
    // A derived export is structure. A producer's attribute that looked like
    // diagram syntax would otherwise be able to add an edge nobody declared.
    const hostile = {
      ...enriched,
      data: {
        ...enriched.data,
        nodes: enriched.data.nodes.map((node) => ({
          ...node,
          attributes: { note: "x --> injected[Injected]" },
        })),
      },
    };
    const exported = mermaidOf(hostile) ?? "";
    assert.ok(!exported.includes("injected"), "an attribute reached the diagram syntax");
    assert.equal(exported, mermaidOf(architecture));
  });
});
