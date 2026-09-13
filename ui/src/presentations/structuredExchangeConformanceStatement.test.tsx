/**
 * What a reader is told about a document and its project's profile.
 *
 * The server establishes the statement; this page only says it. So what is left to
 * hold here is the reader's half: that a statement present is shown on the page and
 * in the textual equivalent alike, in words that match what is true, that no
 * statement means nothing is claimed — and that showing it never touches the
 * document a reader is judging.
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ChatItem, StructuredConformance } from "@pi-outpost/shared";
import { structuredExchangePresentation } from "./StructuredExchangeView";

type ToolItem = Extract<ChatItem, { kind: "tool" }>;

const document = {
  schema: "urn:structured-exchange:2",
  kind: "table",
  profile: "acme/requirements",
  data: {
    columns: ["id", "requirement"],
    rows: [{ id: "r1", kind: "requirement", cells: ["REQ-1", "Stop within 40 m"], attributes: { status: "approved" } }],
  },
};
const serialized = JSON.stringify(document);

const toolItem = (conformance?: StructuredConformance): ToolItem => ({
  kind: "tool",
  toolCallId: "t1",
  toolName: "present_structure",
  args: {},
  output: "presented",
  structured: serialized,
  ...(conformance === undefined ? {} : { structuredConformance: conformance }),
});

const renderItem = (item: ToolItem) => render(<structuredExchangePresentation.Expanded item={item} dispatch={vi.fn()} />);

/** The textual equivalent, reached through its own control as a reader reaches it. */
function textEquivalent(): string {
  fireEvent.click(screen.getByText(/text equivalent/));
  return screen.getByTestId("structured-text-equivalent").textContent ?? "";
}

describe("the conformance statement", () => {
  it("says a conforming document conforms, on the page and in the text", () => {
    // AConformingDocumentSaysSo
    renderItem(toolItem({ profile: "acme/requirements", state: "conforms", openValues: 0 }));
    const statement = screen.getByTestId("structured-conformance");
    expect(statement.textContent).toBe('Conforms to this project\'s profile "acme/requirements".');
    expect(statement.getAttribute("data-state")).toBe("conforms");
    expect(textEquivalent()).toContain('Conformance: Conforms to this project\'s profile "acme/requirements".');
  });

  it("counts the values outside open enumerations", () => {
    // OpenEnumerationValuesAreCounted
    renderItem(toolItem({ profile: "acme/requirements", state: "conforms", openValues: 2 }));
    expect(screen.getByTestId("structured-conformance").textContent).toBe(
      'Conforms to this project\'s profile "acme/requirements", with 2 values outside its open enumerations.',
    );
    expect(textEquivalent()).toContain("with 2 values outside its open enumerations");
  });

  it("counts the findings the project's rules leave to check", () => {
    // FindingsToCheckAreCounted
    renderItem(toolItem({ profile: "acme/requirements", state: "conforms", openValues: 0, findings: 2 }));
    expect(screen.getByTestId("structured-conformance").textContent).toBe(
      'Conforms to this project\'s profile "acme/requirements", with 2 findings to check.',
    );
    expect(textEquivalent()).toContain("with 2 findings to check");
  });

  it("joins open values and findings in one sentence", () => {
    renderItem(toolItem({ profile: "acme/requirements", state: "conforms", openValues: 1, findings: 1 }));
    expect(screen.getByTestId("structured-conformance").textContent).toBe(
      'Conforms to this project\'s profile "acme/requirements", with 1 value outside its open enumerations and 1 finding to check.',
    );
  });

  it("says a document no longer conforms when the profile has changed under it", () => {
    // ARestoredDocumentIsCheckedAgainstTheProfileAsItIsNow, as the reader reads it
    renderItem(toolItem({ profile: "acme/requirements", state: "strays", openValues: 0 }));
    const statement = screen.getByTestId("structured-conformance");
    expect(statement.textContent).toBe('Does not conform to this project\'s profile "acme/requirements" as it stands now.');
    expect(statement.getAttribute("data-state")).toBe("strays");
    expect(textEquivalent()).toContain("Conformance: Does not conform");
  });

  it("says when the document could not be checked", () => {
    renderItem(toolItem({ state: "unchecked", openValues: 0 }));
    expect(screen.getByTestId("structured-conformance").textContent).toBe(
      "Could not be checked against this project's profile: the project's profile registry cannot be used right now.",
    );
  });

  it("claims nothing for a document not held to a profile", () => {
    // ADocumentNotHeldToAProfileCarriesNoStatement
    renderItem(toolItem());
    expect(screen.queryByTestId("structured-conformance")).toBeNull();
    // The vocabulary is still named: being held to nothing is not having no profile.
    expect(screen.getByTestId("structured-profile").textContent).toContain("acme/requirements");
    expect(textEquivalent()).not.toContain("Conformance:");
  });

  it("leaves the document exactly as it was validated", () => {
    // TheStatementDoesNotAlterTheDocument
    const item = toolItem({ profile: "acme/requirements", state: "conforms", openValues: 1 });
    renderItem(item);
    // What travels — the value approval hands on — is the item's own string, byte for byte.
    expect(item.structured).toBe(serialized);
    expect(serialized).not.toContain("onforms");
    // The envelope pane lays that document out for reading; it is still the same document.
    fireEvent.click(screen.getByText(/show envelope/));
    expect(JSON.parse(screen.getByTestId("structured-envelope").textContent ?? "")).toEqual(document);
  });
});
