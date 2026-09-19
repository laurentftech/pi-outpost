/**
 * A project's rule patterns, as a reader is handed them.
 *
 * Generated here by the same generator the agent's tool and the validator use, not written by
 * hand: a fixture that looks like the patterns proves nothing about the patterns a reader gets.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ChatItem } from "@pi-outpost/shared";
import type { ProfileRule, StructuredExchangeProfile } from "@pi-outpost/shared/structured-exchange/profile";
import { rulePatterns } from "@pi-outpost/shared/structured-exchange/project-views";
import { structuredExchangePresentation } from "./StructuredExchangeView";

type ToolItem = Extract<ChatItem, { kind: "tool" }>;

const profile: StructuredExchangeProfile = {
  schema: "urn:structured-exchange-profile:1",
  id: "acme/requirements",
  label: "ACME requirements",
  elementKinds: [
    { kind: "requirement", attributes: [{ name: "category", type: "enumeration", values: ["derived", "direct"], closed: true }] },
    { kind: "test" },
  ],
  relationshipKinds: [{ kind: "satisfies", from: ["requirement"], to: ["requirement"] }],
};
const rules: ProfileRule[] = [
  { id: "ARP", statement: "Une exigence dérivée ne satisfait pas une exigence amont.", level: "refuse", relationship: "satisfies", when: { from: { category: ["derived"] } }, then: "forbidden" },
  { id: "CAT", statement: "Every requirement is categorised.", level: "report", element: "requirement", then: { category: ["derived", "direct"] } },
];

const generated = rulePatterns(profile, rules, []);
if (!("document" in generated)) throw new Error(generated.refused);

const item: ToolItem = {
  kind: "tool",
  toolCallId: "p1",
  toolName: "present_project_model",
  args: { view: "rule-patterns" },
  output: "Presented the rule patterns",
  structured: JSON.stringify(generated.document),
};

describe("rule patterns in the reader", () => {
  it("render with the structured-exchange presentation: every frame and end drawn, no conformance statement", () => {
    expect(structuredExchangePresentation.match(item)).toBe(true);
    render(<structuredExchangePresentation.Expanded item={item} dispatch={vi.fn()} />);
    const graph = [...document.querySelectorAll('svg[aria-label^="Graph of"]')][0];
    expect(graph).toBeDefined();
    const drawn = [...graph.querySelectorAll("[data-element-id]")].map((element) => element.getAttribute("data-element-id")).sort();
    expect(drawn).toEqual(["rule-1-from", "rule-1-to", "rule-2-item"]);
    const text = graph.textContent ?? "";
    expect(text).toContain("REFUSE · ARP — Une exigence dérivée ne satisfait pas une exigence amont.");
    expect(text).toContain("requirement · when category = derived");
    expect(text).toContain("satisfies ✗ forbidden");
    expect(screen.queryByTestId("structured-conformance")).toBeNull();
  });
});
