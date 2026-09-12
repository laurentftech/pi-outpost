/**
 * The accessible text, for a document the enriched contract fills.
 *
 * The rule this suite exists to hold: the textual equivalent carries *everything*
 * the visual presentation has. A reader using it is using it because they cannot
 * see the panels — so enrichment shown in a detail panel and omitted here is, for
 * them, not in the document at all. That failure is invisible to anyone testing by
 * looking at the screen, which is why it is asserted rather than observed.
 *
 * The second rule is about honesty of framing. An expectation is a condition the
 * producer assumed and the receiving authority must check; rendered beside a
 * description with no distinction, it reads as a fact this application established.
 */
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { StructuredExchangeDocument } from "./StructuredExchangeView";
import { validStructuredExchange } from "./structuredExchange";

const digest = (seed: string) => `sha256:${seed.repeat(64).slice(0, 64)}`;

/** A requirements table using every enrichment the contract allows on a row. */
const enriched = {
  schema: "urn:structured-exchange:2",
  kind: "table",
  profile: "acme/requirements",
  target: { ref: "REQ-DOC-1", revision: "rev-9" },
  removals: [{ type: "row", ref: "REQ-8", label: "Withdrawn" }],
  artifacts: [{ rel: "specification", uri: "https://example.invalid/spec.pdf", sha256: digest("a") }],
  data: {
    columns: ["id", "requirement"],
    rows: [
      { heading: "1. Braking", depth: 1 },
      {
        id: "r1",
        ref: "REQ-1",
        kind: "requirement",
        cells: ["REQ-1", "Stop within 40 m"],
        attributes: { verification: "test", owner: { ref: "ORG-3" }, tags: ["safety", "brakes"] },
        expect: { attributes: { status: "approved" } },
        set: { attributes: { status: "in review" }, removeAttributes: ["waiver"] },
        locations: [{ uri: "file:///specs/brakes.md", range: { startLine: 10, endLine: 12 } }],
        artifacts: [{ rel: "verifies", uri: "https://ci.example.invalid/r.json", sha256: digest("b") }],
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

function textOf(document: unknown): string {
  const serialized = JSON.stringify(document);
  const envelope = validStructuredExchange(serialized);
  expect(envelope, "the fixture itself does not validate").toBeDefined();
  render(<StructuredExchangeDocument envelope={envelope!} source={serialized} />);
  // The equivalent is behind its own control, exactly as a reader reaches it.
  fireEvent.click(screen.getByText(/text equivalent/));
  return screen.getByTestId("structured-text-equivalent").textContent ?? "";
}

describe("the textual equivalent of an enriched document", () => {
  it("says what the document is before what it holds", () => {
    const text = textOf(enriched);
    expect(text).toContain("Profile: acme/requirements");
    expect(text).toContain("REQ-DOC-1");
    expect(text).toContain("rev-9");
  });

  it("names the authority as the one who checks the expectations, not this application", () => {
    expect(textOf(enriched)).toContain("receiving authority checks them");
  });

  it("keeps description, expectation, assignment and removal apart", () => {
    const text = textOf(enriched);
    expect(text).toContain("attribute: verification: test");
    expect(text).toContain("expects: status: approved");
    expect(text).toContain("asks to set: status: in review");
    expect(text).toContain("asks to unset: waiver");
  });

  it("shows a reference as a reference rather than as a label", () => {
    // `owner: <ORG-3>` and `owner: ORG-3` are different claims: one names something
    // an authority holds, the other is a piece of text that happens to look like it.
    expect(textOf(enriched)).toContain("attribute: owner: <ORG-3>");
  });

  it("carries a list attribute whole", () => {
    expect(textOf(enriched)).toContain("tags: safety, brakes");
  });

  it("carries locations and artifacts, digest included", () => {
    const text = textOf(enriched);
    expect(text).toContain("file:///specs/brakes.md");
    expect(text).toContain("lines 10–12");
    expect(text).toContain("verifies: https://ci.example.invalid/r.json");
    // The digest is what an approval is bound to; a reader who cannot tell one is
    // present cannot tell a link that will be verified from one that will not.
    expect(text).toContain("sha256:bbbbbbb");
  });

  it("keeps the chapters, in place and at their depth", () => {
    const text = textOf(enriched);
    expect(text).toContain("# 1. Braking");
    expect(text).toContain("## 1.1 Sensing");
    // In place: the chapter comes before the row it introduces.
    expect(text.indexOf("# 1. Braking")).toBeLessThan(text.indexOf("REQ-1"));
    expect(text.indexOf("## 1.1 Sensing")).toBeLessThan(text.indexOf("REQ-2"));
  });

  it("states each row's type, which is what makes it a requirement rather than a line", () => {
    expect(textOf(enriched)).toContain("[requirement]");
  });

  it("reads traceability in both directions of the document, ends resolved", () => {
    const text = textOf(enriched);
    expect(text).toContain("derives");
    expect(text).toContain("verifiedBy");
    // An end inside the document reads as its row; one outside keeps its reference
    // rather than being given an invented name.
    expect(text).toContain("TEST-9");
  });

  it("omits nothing a version 1 document used to say", () => {
    const plain = {
      schema: "urn:structured-exchange:1",
      kind: "graph",
      data: {
        nodes: [{ id: "a", label: "Alpha", kind: "service" }, { id: "b", label: "Beta" }],
        edges: [{ from: "a", to: "b", kind: "calls" }],
      },
    };
    const text = textOf(plain);
    expect(text).toContain("Alpha");
    expect(text).toContain("calls");
    // And says nothing about enrichment that is not there.
    expect(text).not.toContain("Profile:");
    expect(text).not.toContain("expects:");
  });
});

describe("the visual presentation of an enriched table", () => {
  function renderEnriched() {
    const serialized = JSON.stringify(enriched);
    const envelope = validStructuredExchange(serialized);
    expect(envelope).toBeDefined();
    return render(<StructuredExchangeDocument envelope={envelope!} source={serialized} />);
  }

  it("names the vocabulary without claiming to understand it", () => {
    renderEnriched();
    const profile = screen.getByTestId("structured-profile");
    expect(profile.textContent).toContain("acme/requirements");
    expect(profile.textContent).toMatch(/not resolved here/);
  });

  it("draws a chapter across the table rather than as a row of data", () => {
    const { container } = renderEnriched();
    const headings = [...container.querySelectorAll("tr[data-row-heading]")];
    expect(headings).toHaveLength(2);
    // Spanning, not aligned: a chapter squeezed into the first column reads as a row
    // whose other cells went missing.
    expect(headings[0].querySelector("th")?.getAttribute("colspan")).toBe("2");
    expect(headings[0].textContent).toContain("1. Braking");
    // Depth is carried, so a sub-section is not drawn as a peer of the section.
    expect(headings[0].getAttribute("data-row-heading")).toBe("1");
    expect(headings[1].getAttribute("data-row-heading")).toBe("2");
  });

  it("marks a proposed table's rows from what the proposal proposes", () => {
    // Found in the running widget, not here: the model derived these marks and the
    // table read the *declared* role instead, so a proposal drew three identical
    // rows where one was changed, one added and one only context. The one view
    // whose job is telling them apart was the one that could not.
    const proposal = {
      schema: "urn:structured-exchange:2",
      kind: "table",
      target: { ref: "reqs://module/42", revision: "baseline-7" },
      data: {
        columns: ["id", "requirement"],
        rows: [
          { heading: "1. Braking", depth: 1 },
          { id: "r1", ref: "REQ-1", kind: "requirement", cells: ["REQ-1", "Stop within 40 m"], set: { attributes: { status: "in review" } } },
          { id: "r2", cells: ["", "Warn the driver at 20 m"] },
          { id: "r3", ref: "REQ-3", kind: "requirement", cells: ["REQ-3", "Read wheel speed"] },
        ],
      },
    };
    const serialized = JSON.stringify(proposal);
    const envelope = validStructuredExchange(serialized);
    expect(envelope, "the fixture itself does not validate").toBeDefined();
    const { container } = render(<StructuredExchangeDocument envelope={envelope!} source={serialized} />);
    const roles = [...container.querySelectorAll("tbody tr")].map((row) => row.getAttribute("data-row-role"));
    expect(roles).toEqual([null, "changed", "added", "context"]);
  });

  it("keys and filters a proposal by the roles it derived", () => {
    // The tints were there; the key beside them was not, because the legend and the
    // filter both asked whether a role had been *declared* — which a proposal never
    // does. Colour carrying a meaning with no word attached is the one thing this
    // rendering promises never to do.
    const proposal = {
      schema: "urn:structured-exchange:2",
      kind: "table",
      target: { ref: "reqs://module/42" },
      data: {
        columns: ["id", "requirement"],
        rows: [
          { id: "r1", ref: "REQ-1", cells: ["REQ-1", "Stop within 40 m"], set: { attributes: { status: "in review" } } },
          { id: "r2", cells: ["", "Warn the driver at 20 m"] },
          { id: "r3", ref: "REQ-3", cells: ["REQ-3", "Read wheel speed"] },
        ],
      },
    };
    const serialized = JSON.stringify(proposal);
    const envelope = validStructuredExchange(serialized);
    expect(envelope, "the fixture itself does not validate").toBeDefined();
    const { container } = render(<StructuredExchangeDocument envelope={envelope!} source={serialized} />);

    // Every role on screen has its word in the key.
    for (const word of ["changed", "added", "existing"]) {
      expect(screen.getAllByText(new RegExp(word, "i")).length).toBeGreaterThan(0);
    }

    // And the reader can narrow by one: hiding additions leaves the other two.
    fireEvent.click(screen.getByRole("button", { name: /added/i }));
    const visible = [...container.querySelectorAll("tbody tr")].map((row) => row.getAttribute("data-row-role"));
    expect(visible).not.toContain("added");
    expect(visible).toContain("changed");
  });

  it("keeps a row's type and reference on the row", () => {
    const { container } = renderEnriched();
    const row = container.querySelector('tr[data-row-ref="REQ-1"]');
    expect(row).not.toBeNull();
    expect(row?.getAttribute("data-row-kind")).toBe("requirement");
  });

  it("tells the four kinds of claim apart by word, not only by colour", () => {
    const { container } = renderEnriched();
    const claims = [...container.querySelectorAll("[data-claim]")].map((node) => [
      node.getAttribute("data-claim"),
      node.textContent,
    ]);
    expect(claims).toContainEqual(["attribute", "is"]);
    expect(claims).toContainEqual(["expects", "expects"]);
    expect(claims).toContainEqual(["assigns", "asks to set"]);
    expect(claims).toContainEqual(["removes", "asks to unset"]);
  });

  it("shows a row's relations in both directions, and keys the vocabulary", () => {
    const { container } = renderEnriched();
    const key = screen.getByTestId("structured-relation-key").textContent ?? "";
    expect(key).toContain("derives");
    expect(key).toContain("verifiedBy");
    // And says what it is not claiming.
    expect(key).toMatch(/nothing is inferred about what is missing/);
    // REQ-2 is only ever a relation's destination, and still shows the relation.
    const second = container.querySelector('tr[data-row-ref="REQ-2"]');
    expect(second?.textContent).toContain("derives");
  });

  it("folds the detail without removing it from the document", () => {
    // The reason folding is allowed at all: what is collapsed visually is still
    // whole in the accessible text, so folding is a display choice rather than a
    // quiet removal.
    const { container } = renderEnriched();
    const details = [...container.querySelectorAll("details[data-testid='structured-enrichment']")];
    expect(details.length).toBeGreaterThan(0);
    expect(details.every((node) => !(node as HTMLDetailsElement).open)).toBe(true);

    // Same rendering, its own text equivalent: what the panels fold is still here.
    fireEvent.click(within(container).getByText(/text equivalent/));
    const text = within(container).getByTestId("structured-text-equivalent").textContent ?? "";
    expect(text).toContain("asks to unset: waiver");
    expect(text).toContain("file:///specs/brakes.md");
  });

  it("renders a location and a digest as text, not as anything that acts", () => {
    const { container } = renderEnriched();
    const detail = container.querySelector("details[data-testid='structured-enrichment']");
    expect(detail?.textContent).toContain("file:///specs/brakes.md");
    expect(detail?.textContent).toContain("sha256:bbbbbbb");
    // Nothing producer-controlled becomes a link by resembling one.
    expect(detail?.querySelector("a")).toBeNull();
  });
});
