/**
 * Selecting a viewpoint, from the reader's side.
 *
 * What a viewpoint shows is decided and tested under Node, once. What is left for a
 * mounted component is the reader's half: that the choice is offered only where there
 * is one, that selecting narrows and says why, that the key still works on top and the
 * rendering admits it, that "whole document" really is the whole document again — and
 * that none of it touches the document being approved.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ChatItem } from "@pi-outpost/shared";
import { structuredExchangePresentation } from "./StructuredExchangeView";

type ToolItem = Extract<ChatItem, { kind: "tool" }>;

const withStructured = (document: unknown): ToolItem => ({
  kind: "tool",
  toolCallId: "t1",
  toolName: "present_structure",
  args: {},
  output: "presented",
  structured: JSON.stringify(document),
});

const power = {
  id: "power",
  label: "Power distribution",
  concern: "Where energy is stored, converted and consumed",
  elementKinds: ["source", "converter", "load"],
  relationshipKinds: ["power"],
};
const control = {
  id: "control",
  label: "Control",
  concern: "What commands what",
  elementKinds: ["controller", "converter"],
  relationshipKinds: ["signal"],
};

const architecture = (extra: Record<string, unknown> = {}) => ({
  schema: "urn:structured-exchange:2",
  kind: "graph",
  ...extra,
  data: {
    nodes: [
      { id: "battery", label: "Battery", kind: "source" },
      { id: "inverter", label: "Inverter", kind: "converter" },
      { id: "motor", label: "Motor", kind: "load" },
      { id: "ecu", label: "ECU", kind: "controller" },
    ],
    edges: [
      { from: "battery", to: "inverter", kind: "power" },
      { from: "inverter", to: "motor", kind: "power" },
      { from: "ecu", to: "inverter", kind: "signal" },
    ],
  },
});

const renderBody = (item: ToolItem) =>
  render(<structuredExchangePresentation.Expanded item={item} dispatch={vi.fn()} />);

const selector = () => screen.queryByTestId("viewpoint-select") as HTMLSelectElement | null;
const inlineGraph = () =>
  [...document.querySelectorAll('svg[aria-label^="Graph of"]')][0] as SVGSVGElement | undefined;
const drawnElements = () =>
  [...(inlineGraph()?.querySelectorAll("[data-element-id]") ?? [])].map((group) => group.getAttribute("data-element-id")).sort();
const select = (value: string) => fireEvent.change(selector()!, { target: { value } });

/**
 * Toggle a key entry the way a pointer does: press, release, then click.
 *
 * The click goes through `fireEvent`, not a raw `dispatchEvent`: only the former is
 * wrapped in `act`, and a state change React is never told to flush leaves the
 * rendering as it was — which reads exactly like a key that does not respond.
 */
const toggleLegend = (key: string) => {
  const entry = document.querySelector(`[data-legend-entry="${key}"]`)!;
  const target = entry.querySelector("text") ?? entry;
  const at = { clientX: 5, clientY: 5, button: 0, bubbles: true, cancelable: true };
  target.dispatchEvent(Object.assign(new MouseEvent("pointerdown", at), { pointerId: 1 }));
  target.dispatchEvent(Object.assign(new MouseEvent("pointerup", at), { pointerId: 1 }));
  fireEvent.click(target);
};

describe("the selection is offered only where there is one", () => {
  it("offers the whole document and each declared viewpoint, in the producer's order", () => {
    renderBody(withStructured(architecture({ viewpoints: [power, control] })));
    const options = [...selector()!.options].map((option) => [option.value, option.textContent]);
    expect(options).toEqual([
      ["", "Whole document"],
      ["power", "Power distribution"],
      ["control", "Control"],
    ]);
  });

  it("shows the whole document until a viewpoint is selected", () => {
    // TheWholeDocumentIsShownUntilAViewpointIsSelected
    renderBody(withStructured(architecture({ viewpoints: [power, control] })));
    expect(selector()!.value).toBe("");
    expect(drawnElements()).toEqual(["battery", "ecu", "inverter", "motor"]);
    expect(screen.queryByTestId("structured-filtered")).toBeNull();
  });

  it("offers nothing when the document declares no viewpoints", () => {
    // ADocumentWithoutViewpointsOffersNoSelection
    renderBody(withStructured(architecture()));
    expect(selector()).toBeNull();
  });
});

describe("selecting a viewpoint", () => {
  it("narrows the rendering to what it retains", () => {
    // SelectingAViewpointNarrowsToIt
    renderBody(withStructured(architecture({ viewpoints: [power, control] })));
    select("power");
    expect(drawnElements()).toEqual(["battery", "inverter", "motor"]);
    select("control");
    expect(drawnElements()).toEqual(["ecu", "inverter"]);
  });

  it("says which viewpoint is shown and what it is for, on the page and inside the figure", () => {
    // TheRenderingSaysWhichViewpointItShows
    renderBody(withStructured(architecture({ viewpoints: [power, control] })));
    select("power");
    expect(screen.getByTestId("structured-viewpoint").textContent).toContain(
      "Viewpoint: Power distribution — Where energy is stored, converted and consumed",
    );
    const note = inlineGraph()!.querySelector('[data-testid="diagram-filter-note"]');
    expect(note?.textContent).toContain("Viewpoint: Power distribution");
  });

  it("lets the key hide more on top, and says the viewpoint has been adjusted", () => {
    // TheKeyStillAppliesOnTopOfAViewpoint
    renderBody(withStructured(architecture({ viewpoints: [power, control] })));
    select("power");
    expect(screen.getByTestId("structured-viewpoint").textContent).not.toContain("Adjusted");
    toggleLegend("element:load");
    expect(drawnElements()).toEqual(["battery", "inverter"]);
    expect(screen.getByTestId("structured-viewpoint").textContent).toContain("Adjusted with the key");
    expect(inlineGraph()!.querySelector('[data-testid="diagram-filter-note"]')?.textContent).toContain("(adjusted)");
  });

  it("returns to the whole document in one action, from the selector or the banner", () => {
    // ReturningToTheWholeDocument
    renderBody(withStructured(architecture({ viewpoints: [power, control] })));
    select("power");
    select("");
    expect(drawnElements()).toEqual(["battery", "ecu", "inverter", "motor"]);
    expect(screen.queryByTestId("structured-filtered")).toBeNull();

    select("control");
    fireEvent.click(screen.getByText("show everything"));
    expect(drawnElements()).toEqual(["battery", "ecu", "inverter", "motor"]);
    expect(selector()!.value).toBe("");
    expect(inlineGraph()!.querySelector('[data-testid="diagram-filter-note"]')).toBeNull();
  });

  it("leaves the document being approved untouched", () => {
    // SelectingAViewpointDoesNotAlterTheDocument
    const document = architecture({ viewpoints: [power, control] });
    const item = withStructured(document);
    renderBody(item);
    select("power");
    toggleLegend("element:load");
    expect(item.structured).toBe(JSON.stringify(document));
  });
});

describe("what leaves the page carries the viewpoint", () => {
  it("copies markup that states the selected viewpoint", async () => {
    // AnExportedFigureNamesItsViewpoint
    const copied: string[] = [];
    Object.assign(navigator, { clipboard: { writeText: async (text: string) => void copied.push(text) } });
    renderBody(withStructured(architecture({ viewpoints: [power, control] })));
    select("control");
    fireEvent.click(screen.getByText("copy markup"));
    await vi.waitFor(() => expect(copied.length).toBe(1));
    expect(copied[0]).toContain("Viewpoint: Control");
    expect(copied[0]).toContain("What commands what");
  });
});
